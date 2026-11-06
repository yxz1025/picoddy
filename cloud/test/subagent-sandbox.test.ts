import assert from "node:assert/strict";
import test from "node:test";

import { Sandbox } from "@alibaba-group/opensandbox";

import * as sandboxModule from "../src/platform/sandbox.ts";
import { createSubagentTool } from "../src/agent/tools/subagent.ts";
import { validateManifest } from "../src/domains/workspace/node/sync.ts";
import type { Config } from "../src/config.ts";
import type { Run } from "../src/cloud/runs/types.ts";
import type { Database } from "../src/infra/db.ts";
import type { Storage } from "../src/platform/storage.ts";
import type { CloudSandbox } from "../src/platform/sandbox.ts";

function config(): Config {
  return {
    sandboxDomain: "https://sandbox.example.test",
    sandboxApiKey: "test-key",
    sandboxImage: "sandbox:test",
    sandboxTimeoutSeconds: 600,
    maxUploadBytes: 1024,
  } as Config;
}

test("subagent contract names only the persistent work and output snapshot roots", () => {
  const tool = createSubagentTool({
    database: {} as Database,
    storage: {} as Storage,
    sandbox: {} as CloudSandbox,
    run: {} as Run,
    maxBytes: 1024,
    runChild: async () => undefined,
    guard: async () => undefined,
  });

  assert.match(tool.description, /persistent \/workspace\/work and \/workspace\/output/i);
  assert.match(tool.description, /includeAttachments/i);
  assert.doesNotMatch(tool.description, /current workspace/i);

  assert.deepEqual(validateManifest([
    { path: "work/source.txt", size: 1, sha256: "a".repeat(64) },
    { path: "output/report.txt", size: 1, sha256: "b".repeat(64) },
  ]).map((file) => file.path), ["output/report.txt", "work/source.txt"]);
  assert.throws(
    () => validateManifest([{ path: "src/omitted.txt", size: 1, sha256: "c".repeat(64) }]),
    /workspace path/i,
  );
});

test("subagent sandbox creation has a bounded timeout without timing the child execution", async () => {
  const withSandboxCreateTimeout = (
    sandboxModule as typeof sandboxModule & {
      withSandboxCreateTimeout?: <T>(timeoutMs: number, operation: () => Promise<T>) => Promise<T>;
    }
  ).withSandboxCreateTimeout;
  assert.equal(typeof withSandboxCreateTimeout, "function");

  const descriptor = Object.getOwnPropertyDescriptor(Sandbox, "create");
  let createSignal: AbortSignal | undefined;
  Object.defineProperty(Sandbox, "create", {
    configurable: true,
    writable: true,
    value(options: Parameters<typeof Sandbox.create>[0]) {
      createSignal = options.signal;
      return new Promise((_resolve, reject) => {
        const abort = () => reject(options.signal?.reason);
        options.signal?.addEventListener("abort", abort, { once: true });
        if (options.signal?.aborted) abort();
      });
    },
  });

  try {
    await assert.rejects(
      withSandboxCreateTimeout!(10, () => sandboxModule.createSandbox(config(), "child-run")),
      /sandbox creation exceeded 10ms/i,
    );
    assert.equal(createSignal?.aborted, true);
  } finally {
    if (descriptor) Object.defineProperty(Sandbox, "create", descriptor);
  }

  let signalAfterCreate: AbortSignal | undefined;
  const successfulDescriptor = Object.getOwnPropertyDescriptor(Sandbox, "create");
  const fakeSdk = {
    id: "sandbox-1",
    filesWithIdentity() {
      return {};
    },
    async kill() {},
    async close() {},
  };
  Object.defineProperty(Sandbox, "create", {
    configurable: true,
    writable: true,
    async value(options: Parameters<typeof Sandbox.create>[0]) {
      signalAfterCreate = options.signal;
      return fakeSdk as unknown as Awaited<ReturnType<typeof Sandbox.create>>;
    },
  });

  let created: CloudSandbox | undefined;
  try {
    created = await withSandboxCreateTimeout!(10, () =>
      sandboxModule.createSandbox(config(), "child-run-success")
    );
    await new Promise((resolve) => setTimeout(resolve, 25));
    assert.equal(signalAfterCreate?.aborted, false);
  } finally {
    await created?.destroy();
    if (successfulDescriptor) Object.defineProperty(Sandbox, "create", successfulDescriptor);
  }
});
