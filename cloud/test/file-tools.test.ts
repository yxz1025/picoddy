import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import {
  createFileTools,
  fileToolRequestPath,
  resolveFileToolPath,
} from "../src/agent/tools/files.ts";
import type { CloudSandbox } from "../src/platform/sandbox.ts";
import type { Run } from "../src/cloud/runs/types.ts";

const execFileAsync = promisify(execFile);
const runtimeScript = fileURLToPath(new URL("../runtime/files.py", import.meta.url));

async function temporaryRoot(prefix: string): Promise<string> {
  return realpath(await mkdtemp(join(tmpdir(), prefix)));
}

function run(): Run {
  return {
    id: "run-1",
    owner_id: "owner-1",
    conversation_id: "conversation-1",
    prompt: "test",
    status: "running",
    lease_token: "lease-1",
    sandbox_id: "sandbox-1",
    selection: {
      workspace: { scopeId: 'conversation-1', ownerId: 'owner-1', revision: 0, files: [] },
      runtimeProfile: { mode: 'craft', category: 'assistant' }, permission: 'full',
      settings: { customInstructions: '', language: 'zh-CN' },
      skills: [], connectors: [], files: [], memories: [],
      model: { id: "model-1", name: "Model", data: {} },
    },
  };
}

test("file tools expose the Pi 1.0.4 names and order", () => {
  const sandbox = {} as CloudSandbox;
  const tools = createFileTools(run(), sandbox, { assertLease: async () => undefined });
  assert.deepEqual(tools.map((tool) => tool.name), ["read", "write", "edit", "grep", "find", "ls"]);
  assert.deepEqual(Object.keys((tools[0]!.parameters as { properties: object }).properties), ["path", "offset", "limit"]);
  assert.deepEqual(Object.keys((tools[2]!.parameters as { properties: object }).properties), ["path", "edits"]);
});

test("file tool paths use POSIX workspace semantics on every host", () => {
  assert.equal(resolveFileToolPath("src/main.ts"), "/workspace/src/main.ts");
  assert.equal(resolveFileToolPath("./src/main.ts"), "/workspace/src/main.ts");
  assert.equal(resolveFileToolPath("/workspace/output/report.txt"), "/workspace/output/report.txt");
  assert.equal(resolveFileToolPath("."), "/workspace");
  for (const unsafe of ["", "../secret", "src/../../secret", "/etc/passwd", "C:\\secret", "src\\file", "a\0b"])
    assert.throws(() => resolveFileToolPath(unsafe), /workspace path/i, unsafe);
});

test("file request names are UUID-bound workspace files", () => {
  assert.equal(
    fileToolRequestPath("123e4567-e89b-42d3-a456-426614174000"),
    "/workspace/.file-request-123e4567-e89b-42d3-a456-426614174000.json",
  );
  assert.throws(() => fileToolRequestPath("../request"), /UUID/i);
});

test("tool execution sends content through a request file and cleans it up", async () => {
  const writes: Array<{ path: string; data: Uint8Array }> = [];
  const commands: string[] = [];
  const sandbox: CloudSandbox = {
    id: "sandbox-1",
    async write(path, data) { writes.push({ path, data }); },
    async exec(command) {
      commands.push(command);
      if (command.includes(" --cleanup ")) return { stdout: "", stderr: "", exitCode: 0 };
      return {
        stdout: JSON.stringify({ ok: true, result: { kind: "text", text: "hello", details: { totalLines: 1 } } }),
        stderr: "",
        exitCode: 0,
      };
    },
    async read() { throw new Error("not used"); },
    async destroy() {},
  };
  const [read] = createFileTools(run(), sandbox, {
    assertLease: async () => undefined,
    randomUUID: () => "123e4567-e89b-42d3-a456-426614174000",
  });

  const result = await read!.execute("call-1", { path: "notes.txt", offset: 2, limit: 3 });

  assert.equal(writes.length, 1);
  assert.deepEqual(JSON.parse(Buffer.from(writes[0]!.data).toString("utf8")), {
    operation: "read", path: "/workspace/notes.txt", offset: 2, limit: 3,
  });
  assert.equal(commands.length, 2);
  assert.doesNotMatch(commands[0]!, /hello|notes\.txt/);
  assert.match(commands[0]!, /files\.py \/workspace\/\.file-request-/);
  assert.match(commands[1]!, /files\.py --cleanup/);
  assert.deepEqual(result.content, [{ type: "text", text: "hello" }]);
});

async function invokeRuntime(
  root: string,
  request: Record<string, unknown>,
): Promise<Record<string, any>> {
  const requestPath = join(root, ".file-request-123e4567-e89b-42d3-a456-426614174000.json");
  await writeFile(requestPath, JSON.stringify(request));
  const { stdout } = await execFileAsync("python3", [runtimeScript, requestPath], {
    env: { ...process.env, PICODDY_FILE_ROOT: root },
    maxBuffer: 2 * 1024 * 1024,
  });
  return JSON.parse(stdout);
}

test("runtime rejects symlink traversal outside the workspace", async () => {
  const root = await temporaryRoot("picoddy-files-root-");
  const outside = await temporaryRoot("picoddy-files-outside-");
  await writeFile(join(outside, "secret.txt"), "secret");
  await symlink(outside, join(root, "linked"));

  const response = await invokeRuntime(root, {
    operation: "read", path: `${root}/linked/secret.txt`,
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, "SYMLINK_FORBIDDEN");
});

test("runtime edits unique text atomically and rejects duplicate matches", async () => {
  const root = await temporaryRoot("picoddy-files-edit-");
  await mkdir(join(root, "src"));
  await writeFile(join(root, "src", "one.txt"), "alpha\nbeta\n");
  const changed = await invokeRuntime(root, {
    operation: "edit", path: `${root}/src/one.txt`,
    edits: [{ oldText: "beta", newText: "gamma" }],
  });
  assert.equal(changed.ok, true);
  assert.equal(await readFile(join(root, "src", "one.txt"), "utf8"), "alpha\ngamma\n");

  await writeFile(join(root, "src", "many.txt"), "same\nsame\n");
  const duplicate = await invokeRuntime(root, {
    operation: "edit", path: `${root}/src/many.txt`,
    edits: [{ oldText: "same", newText: "other" }],
  });
  assert.equal(duplicate.ok, false);
  assert.equal(duplicate.error.code, "EDIT_MATCH_NOT_UNIQUE");
});

test("runtime bounds regex execution time", async () => {
  const root = await temporaryRoot("picoddy-files-grep-");
  await writeFile(join(root, "input.txt"), `${"a".repeat(30_000)}!\n`);
  const response = await invokeRuntime(root, {
    operation: "grep", path: `${root}/input.txt`, pattern: "(a+)+$", limit: 10,
  });
  assert.equal(response.ok, false);
  assert.equal(response.error.code, "REGEX_TIMEOUT");
});
