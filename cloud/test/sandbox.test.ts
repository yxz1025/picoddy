import assert from "node:assert/strict";
import test from "node:test";

import { Sandbox, SandboxManager } from "@alibaba-group/opensandbox";

import {
  createSandbox,
  mcpRequestPath,
  reconcileRunSandboxes,
  runSandboxMcp,
  sandboxPath,
  type CloudSandbox,
  type McpRunnerRequest,
} from "../src/platform/sandbox.ts";
import type { Config } from "../src/config.ts";

type ReadStream = ReturnType<CloudSandbox["read"]> extends Promise<Uint8Array>
  ? AsyncIterable<Uint8Array>
  : never;

function sandboxConfig(maxUploadBytes = 3): Config {
  return {
    sandboxDomain: "https://sandbox.example.test",
    sandboxApiKey: "test-key",
    sandboxImage: "sandbox:test",
    sandboxTimeoutSeconds: 60,
    maxUploadBytes,
  } as Config;
}

async function withFakeSdk(
  streamFactory: () => ReadStream,
  run: (
    sandbox: CloudSandbox,
    createOptions: Parameters<typeof Sandbox.create>[0],
    reads: Array<{ path: string; options: { limit?: number } | undefined }>,
  ) => Promise<void>,
  signal?: AbortSignal,
): Promise<void> {
  const descriptor = Object.getOwnPropertyDescriptor(Sandbox, "create");
  const reads: Array<{ path: string; options: { limit?: number } | undefined }> = [];
  let createOptions: Parameters<typeof Sandbox.create>[0] | undefined;
  const files = {
    async createDirectories() {},
    async writeFiles() {},
    readBytesStream(path: string, options?: { limit?: number }) {
      reads.push({ path, options });
      return streamFactory();
    },
  };
  const fakeSdk = {
    id: "sandbox-1",
    filesWithIdentity() {
      return files;
    },
    async kill() {},
    async close() {},
  };
  Object.defineProperty(Sandbox, "create", {
    configurable: true,
    writable: true,
    async value(options: Parameters<typeof Sandbox.create>[0]) {
      createOptions = options;
      return fakeSdk as unknown as Awaited<ReturnType<typeof Sandbox.create>>;
    },
  });

  let sandbox: CloudSandbox | undefined;
  try {
    sandbox = await createSandbox(sandboxConfig(), "run-1", signal);
    assert.ok(createOptions);
    await run(sandbox, createOptions, reads);
  } finally {
    await sandbox?.destroy();
    if (descriptor) Object.defineProperty(Sandbox, "create", descriptor);
  }
}

test("sandboxPath accepts only canonical paths inside /workspace", () => {
  assert.equal(sandboxPath("/workspace"), "/workspace");
  assert.equal(sandboxPath("/workspace/input/report.docx"), "/workspace/input/report.docx");

  for (const unsafe of [
    "workspace/file",
    "/tmp/file",
    "/workspace-other/file",
    "/workspace/../etc/passwd",
    "/workspace/./file",
    "/workspace//file",
    "/workspace/file\\name",
    "/workspace/file\0name",
  ]) {
    assert.throws(() => sandboxPath(unsafe), /workspace path/i, unsafe);
  }
});

test("mcpRequestPath accepts UUIDs and cannot escape the workspace", () => {
  assert.equal(
    mcpRequestPath("123e4567-e89b-42d3-a456-426614174000"),
    "/workspace/.mcp-request-123e4567-e89b-42d3-a456-426614174000.json",
  );
  assert.throws(() => mcpRequestPath("../secret"), /UUID/i);
});

test('file uploads use OpenSandbox octal-digit mode values with the workload identity', async()=>{
  const descriptor=Object.getOwnPropertyDescriptor(Sandbox,'create');
  const calls: Array<{path:string;mode:number}>=[];
  Object.defineProperty(Sandbox,'create',{configurable:true,writable:true,value:async()=>({
    id:'permissions-test',
    filesWithIdentity(uid:number,gid:number){
      assert.equal(uid,10001); assert.equal(gid,10001);
      return {async createDirectories(entries:typeof calls){calls.push(...entries);},async writeFiles(entries:typeof calls){calls.push(...entries);}};
    },async kill(){},async close(){},
  })});
  try {
    const sandbox=await createSandbox(sandboxConfig(),'mode-test');
    await sandbox.write('/workspace/work/private.txt',Buffer.from('test'));
    assert.deepEqual(calls.map(({path,mode})=>({path,mode})),[
      {path:'/workspace/work',mode:700},{path:'/workspace/work/private.txt',mode:600},
    ]);
    await sandbox.destroy();
  } finally {if(descriptor)Object.defineProperty(Sandbox,'create',descriptor);}
});

test("read enforces its byte limit while consuming the SDK stream", async () => {
  let closed = false;
  await withFakeSdk(
    async function* () {
      try {
        yield new Uint8Array([1, 2]);
        yield new Uint8Array([3, 4]);
        yield new Uint8Array([5]);
      } finally {
        closed = true;
      }
    },
    async (sandbox, _createOptions, reads) => {
      await assert.rejects(sandbox.read("/workspace/output/large.bin"), /3-byte read limit/i);
      // Download raw bytes; Execd's limit query uses text slicing and can strip newlines.
      assert.deepEqual(reads, [{ path: "/workspace/output/large.bin", options: undefined }]);
      await Promise.resolve();
      assert.equal(closed, true);
    },
  );
});

test("raw reads preserve binary bytes and trailing newlines across chunks", async () => {
  const bytes = new Uint8Array([0, 255, 13, 10, 228, 184, 173, 10, 10]);
  await withFakeSdk(async function* () {
    yield bytes.subarray(0, 5);
    yield bytes.subarray(5);
  }, async (sandbox, _options, reads) => {
    assert.deepEqual(await sandbox.read('/workspace/work/file.bin', bytes.length), bytes);
    assert.equal(reads[0].options, undefined);
  });
});

test("read aborts stream consumption and createSandbox forwards the signal", async () => {
  let returned = false;
  const stream: AsyncIterable<Uint8Array> = {
    [Symbol.asyncIterator]() {
      return {
        next: () => new Promise<IteratorResult<Uint8Array>>(() => {}),
        async return() {
          returned = true;
          return { done: true, value: undefined };
        },
      };
    },
  };
  const controller = new AbortController();
  const reason = new Error("stop reading");

  await withFakeSdk(
    () => stream,
    async (sandbox, createOptions) => {
      assert.equal(createOptions.signal, controller.signal);
      const reading = sandbox.read("/workspace/output/pending.bin", 10, controller.signal);
      await Promise.resolve();
      controller.abort(reason);
      await assert.rejects(reading, (error) => error === reason);
      await Promise.resolve();
      assert.equal(returned, true);
    },
    controller.signal,
  );
});

test("reconcileRunSandboxes paginates, kills every live match, and confirms deletion", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(SandboxManager, "create");
  const listCalls: Array<{ metadata?: Record<string, string>; page?: number; pageSize?: number }> = [];
  const killed: string[] = [];
  let closed = 0;
  let listCall = 0;
  const info = (id: string, state: string, runId = "run-1") => ({
    id,
    entrypoint: [],
    metadata: { runId },
    status: { state },
    createdAt: new Date(0),
    expiresAt: null,
  });
  const pages = [
    { items: [info("live-a", "Running"), info("old", "Deleted")], pagination: { page: 1, pageSize: 2, totalItems: 3, totalPages: 2, hasNextPage: true } },
    { items: [info("live-b", "Creating")], pagination: { page: 2, pageSize: 2, totalItems: 3, totalPages: 2, hasNextPage: false } },
    { items: [info("live-a", "Deleted"), info("old", "Deleted")], pagination: { page: 1, pageSize: 2, totalItems: 3, totalPages: 2, hasNextPage: true } },
    { items: [info("live-b", "Deleted")], pagination: { page: 2, pageSize: 2, totalItems: 3, totalPages: 2, hasNextPage: false } },
  ];
  const manager = {
    async listSandboxInfos(filter: { metadata?: Record<string, string>; page?: number; pageSize?: number }) {
      listCalls.push(filter);
      return pages[listCall++]!;
    },
    async killSandbox(id: string) {
      killed.push(id);
    },
    async close() {
      closed += 1;
    },
  };
  Object.defineProperty(SandboxManager, "create", {
    configurable: true,
    writable: true,
    value: () => manager,
  });

  try {
    await reconcileRunSandboxes(sandboxConfig(), "run-1");
    assert.deepEqual(killed, ["live-a", "live-b"]);
    assert.deepEqual(listCalls.map(({ metadata, page }) => ({ metadata, page })), [
      { metadata: { runId: "run-1" }, page: 1 },
      { metadata: { runId: "run-1" }, page: 2 },
      { metadata: { runId: "run-1" }, page: 1 },
      { metadata: { runId: "run-1" }, page: 2 },
    ]);
    assert.equal(closed, 1);
  } finally {
    if (descriptor) Object.defineProperty(SandboxManager, "create", descriptor);
  }
});

test("reconcileRunSandboxes rejects when the final scan still has a live sandbox", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(SandboxManager, "create");
  let closed = 0;
  let listed = 0;
  const live = {
    id: "live-a",
    entrypoint: [],
    metadata: { runId: "run-1" },
    status: { state: "Running" },
    createdAt: new Date(0),
    expiresAt: null,
  };
  const manager = {
    async listSandboxInfos() {
      listed += 1;
      return { items: [live], pagination: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1, hasNextPage: false } };
    },
    async killSandbox() {},
    async close() {
      closed += 1;
    },
  };
  Object.defineProperty(SandboxManager, "create", {
    configurable: true,
    writable: true,
    value: () => manager,
  });

  try {
    await assert.rejects(reconcileRunSandboxes(sandboxConfig(), "run-1"), /still active/i);
    assert.equal(listed, 2);
    assert.equal(closed, 1);
  } finally {
    if (descriptor) Object.defineProperty(SandboxManager, "create", descriptor);
  }
});

test("reconcileRunSandboxes rejects uncertain listing and still closes the manager", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(SandboxManager, "create");
  let closed = 0;
  const manager = {
    async listSandboxInfos() {
      throw new Error("list unavailable");
    },
    async killSandbox() {},
    async close() {
      closed += 1;
    },
  };
  Object.defineProperty(SandboxManager, "create", {
    configurable: true,
    writable: true,
    value: () => manager,
  });

  try {
    await assert.rejects(reconcileRunSandboxes(sandboxConfig(), "run-1"), /list unavailable/i);
    assert.equal(closed, 1);
  } finally {
    if (descriptor) Object.defineProperty(SandboxManager, "create", descriptor);
  }
});

test("reconcileRunSandboxes rejects an unconfirmed kill and still closes the manager", async () => {
  const descriptor = Object.getOwnPropertyDescriptor(SandboxManager, "create");
  let closed = 0;
  const manager = {
    async listSandboxInfos() {
      return {
        items: [{
          id: "live-a",
          entrypoint: [],
          metadata: { runId: "run-1" },
          status: { state: "Running" },
          createdAt: new Date(0),
          expiresAt: null,
        }],
        pagination: { page: 1, pageSize: 100, totalItems: 1, totalPages: 1, hasNextPage: false },
      };
    },
    async killSandbox() {
      throw new Error("kill unavailable");
    },
    async close() {
      closed += 1;
    },
  };
  Object.defineProperty(SandboxManager, "create", {
    configurable: true,
    writable: true,
    value: () => manager,
  });

  try {
    await assert.rejects(reconcileRunSandboxes(sandboxConfig(), "run-1"), /kill unavailable/i);
    assert.equal(closed, 1);
  } finally {
    if (descriptor) Object.defineProperty(SandboxManager, "create", descriptor);
  }
});

test("runSandboxMcp uploads secrets in a request file and keeps them out of the command", async () => {
  const writes: Array<{ path: string; data: Uint8Array }> = [];
  const commands: string[] = [];
  const request: McpRunnerRequest = {
    connector: {
      transport: "http",
      url: "https://mcp.example.test/api",
      headers: { authorization: "Bearer super-secret" },
    },
    operation: "call",
    name: "lookup",
    arguments: { query: "secret-query" },
  };
  const fake: CloudSandbox = {
    id: "sandbox-1",
    async exec(command) {
      commands.push(command);
      return { stdout: '{"content":[{"type":"text","text":"ok"}]}', stderr: "", exitCode: 0 };
    },
    async write(path, data) {
      writes.push({ path, data });
    },
    async read() {
      return new Uint8Array();
    },
    async destroy() {},
  };

  const result = await runSandboxMcp(fake, request, undefined, () =>
    "123e4567-e89b-42d3-a456-426614174000"
  );

  assert.deepEqual(result, { content: [{ type: "text", text: "ok" }] });
  assert.equal(writes.length, 1);
  assert.match(writes[0]!.path, /^\/workspace\/\.mcp-request-[0-9a-f-]+\.json$/);
  assert.deepEqual(JSON.parse(new TextDecoder().decode(writes[0]!.data)), request);
  assert.equal(commands.length, 1);
  assert.equal(
    commands[0],
    "node /opt/picoddy/mcp-runner.mjs /workspace/.mcp-request-123e4567-e89b-42d3-a456-426614174000.json",
  );
  assert.doesNotMatch(commands[0]!, /super-secret|secret-query|authorization/i);
});

test("runSandboxMcp rejects non-zero and non-JSON runner responses", async () => {
  const makeSandbox = (stdout: string, stderr: string, exitCode: number): CloudSandbox => ({
    id: "sandbox-1",
    async exec() {
      return { stdout, stderr, exitCode };
    },
    async write() {},
    async read() {
      return new Uint8Array();
    },
    async destroy() {},
  });
  const request: McpRunnerRequest = {
    connector: { transport: "http", url: "https://mcp.example.test" },
    operation: "list",
  };

  await assert.rejects(
    runSandboxMcp(makeSandbox("{}", "connection failed", 1), request),
    /Sandbox MCP runner failed \(exit code 1\)/,
  );
  await assert.rejects(
    runSandboxMcp(makeSandbox("diagnostic\n{}", "", 0), request),
    /valid JSON/i,
  );
});
