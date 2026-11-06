# Managed CLI Connector Framework Implementation Plan

> **Superseded on 2026-08-26:** Do not execute this package-bundling plan. The approved on-demand catalog replacement is `docs/superpowers/plans/2026-08-26-on-demand-cli-connector-catalog.md`.

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a generic, app-managed CLI connector runtime and ship DingTalk as its first audited adapter, with real install/auth state, autonomous main-Agent delegation, and a hidden persistent connector subagent.

**Architecture:** Built-in connector packages are validated by a read-only Registry, installed through an isolated `node-npm` Driver, and controlled by a lifecycle service that owns state, authorization, rollback, and cancellation. The main Agent receives only one lightweight delegation tool per ready connector; each connector's full Skill and constrained CLI gateway live in a hidden child session. The renderer reads the same backend state through API/IPC and never treats static configuration as installation or authorization.

**Tech Stack:** Electron 43, Node.js 22, TypeScript, React 19, Zustand, node:sqlite, TypeBox, Node `spawn`/`execFile`, npm 11, `node:test`.

**Design reference:** `docs/superpowers/specs/2026-08-25-managed-cli-connector-framework-design.md`

---

## File map

### Built-in resources and packaging

- Create `resources/builtin-connectors/connector-runtime-lock.json`: audited Node, npm, and connector package integrity roots.
- Create `resources/builtin-connectors/dingtalk/connector.json`: DingTalk product metadata and delegation description.
- Create `resources/builtin-connectors/dingtalk/cli.json`: structured lifecycle commands and policy references.
- Create `resources/builtin-connectors/dingtalk/npm-lock.json`: npm lockfile for the complete `dingtalk-workspace-cli@1.0.59` dependency graph.
- Create `resources/builtin-connectors/dingtalk/skills/`: complete audited official DingTalk CLI Skill and references extracted from `assets/dws-skills.zip`.
- Create `resources/builtin-connectors/dingtalk/schemas/error-map.json`: vendor error mapping.
- Create `resources/builtin-connectors/dingtalk/assets/icon.png`: connector icon copied from the existing frontend asset.
- Create `resources/builtin-connectors/dingtalk/LICENSE` and `NOTICE`: license files extracted from the official bundled CLI archive.
- Modify `package.json` and `package-lock.json`: package exact managed Node/npm versions.
- Modify `electron-builder.yml`: keep connector Markdown and managed Node/npm runtime files in packaged builds.

### Backend connector domain

- Create `src/domains/connector/node/types.ts`: manifests, public state DTOs, operation and command types.
- Create `src/domains/connector/node/errors.ts`: stable connector error codes and HTTP mapping.
- Create `src/domains/connector/node/manifest.ts`: strict JSON parsing and validation.
- Create `src/domains/connector/node/registry.ts`: immutable built-in connector discovery.
- Create `src/domains/connector/node/paths.ts`: platform-neutral private paths and containment checks.
- Create `src/domains/connector/node/state_store.ts`: atomic state persistence.
- Create `src/domains/connector/node/process_runner.ts`: bounded, cancellable, shell-free child processes with line callbacks.
- Create `src/domains/connector/node/node_npm_driver.ts`: exact npm install, verification, staging, and executable resolution.
- Create `src/domains/connector/node/authorization.ts`: allowed-domain URL interception and status verification.
- Create `src/domains/connector/node/command_policy.ts`: schema discovery, risk classification, and argv validation.
- Create `src/domains/connector/node/command_gateway.ts`: connector-bound execution, confirmation, error mapping, and large-output artifacts.
- Create `src/domains/connector/node/lifecycle.ts`: operation locks, state machine, activation, repair, update, logout, cancellation, and uninstall.
- Create `src/domains/connector/node/service.ts`: application-facing singleton facade.
- Create `src/domains/connector/node/agent_session_store.ts`: parent/connector to hidden-child association.
- Create `src/domains/connector/node/agent_manager.ts`: persistent connector-child execution and cleanup.

### Agent runtime

- Create `src/agent/tools/connector_delegate.ts`: dynamic `delegate_to_<connector>` tools.
- Create `src/agent/tools/connector_cli_execute.ts`: the only tool visible inside connector child sessions.
- Create `resources/prompts/v2/categories/connector-agent.md`: connector-child system contract.
- Modify `src/infra/context.ts`: connector-bound child context.
- Modify `src/infra/db.ts`: connector child association table.
- Modify `src/domains/session/node/store.ts`: hide child conversations and delete children safely.
- Modify `src/agent/prompt-runtime/types.ts`, `category-policy.ts`, `session-intent.ts`, `prompt-packs.ts`, `runtime-profile.ts`, and `tool-policy.ts`: dedicated connector-child category and dynamic delegation tool pack.
- Modify `src/agent/provider.ts`: load ready delegation tools for main sessions and connector-only resources/tools for child sessions.
- Modify `src/agent/session_cleanup.ts`: dispose connector children with their parent.

### API, IPC, and frontend

- Modify `application.electron.ts`: connector routes and confirmation bridge.
- Modify `src/electron/ipc-handlers.ts`, `src/electron/preload.cjs`, and `frontend/src/api/client.ts`: synchronized connector IPC routes.
- Create `frontend/src/components/connectorModel.ts`: frontend DTOs, labels, and action availability.
- Modify `frontend/src/store/useSkillStore.ts`: real connector catalog, polling, and lifecycle actions.
- Modify `frontend/src/components/ExpertPanel.tsx` and `ExpertPanel.css`: backend-driven connector cards and action menu.

---

### Task 1: Define and validate the built-in connector package protocol

**Files:**
- Create: `src/domains/connector/node/types.ts`
- Create: `src/domains/connector/node/errors.ts`
- Create: `src/domains/connector/node/manifest.ts`
- Create: `src/domains/connector/node/registry.ts`
- Create: `test/src/domains/connector/node/manifest.test.ts`
- Create: `test/src/domains/connector/node/registry.test.ts`

- [ ] **Step 1: Write manifest validation tests**

Cover a valid connector, unknown top-level fields, mismatched directory/ID, path escape, symlink, invalid delegate tool name, non-HTTPS authorization, and an authorization host outside `allowedDomains`.

```ts
test("validates a structured node-npm connector", async () => {
  const fixtureRoot = (name: string) => join(import.meta.dirname, "fixtures", name);
  const connector = await loadConnectorPackage(fixtureRoot("valid"));
  assert.equal(connector.id, "dingtalk");
  assert.equal(connector.cli.install.package, "dingtalk-workspace-cli");
  assert.deepEqual(connector.cli.auth.argv, ["auth", "login", "-y"]);
});

test("rejects executable policy outside the connector root", async () => {
  await assert.rejects(
    loadConnectorPackage(fixtureRoot("escaped-skill")),
    (error: unknown) => (error as ConnectorError).code === "CONNECTOR_MANIFEST_INVALID",
  );
});
```

- [ ] **Step 2: Run the tests and verify failure**

Run: `npx tsx --test test/src/domains/connector/node/manifest.test.ts test/src/domains/connector/node/registry.test.ts`

Expected: FAIL because `loadConnectorPackage` and `createConnectorRegistry` do not exist.

- [ ] **Step 3: Define the protocol types and stable errors**

Use closed unions and readonly arrays; do not add a generic command string field.

```ts
export type ConnectorLifecycleState =
  | "not_installed" | "installing" | "installed_unauthorized"
  | "authorizing" | "ready" | "auth_expired"
  | "install_failed" | "version_invalid" | "auth_failed"
  | "runtime_broken" | "connector_broken";

export interface ConnectorCliManifest {
  schemaVersion: 1;
  runtime: { type: "node-npm"; version: "22.22.2" };
  install: {
    package: string;
    version: string;
    registry: "https://registry.npmjs.org";
    lockEntry: string;
    postInstall?: { path: string; argv: readonly string[] };
  };
  executable: Partial<Record<"darwin" | "linux" | "win32", string>>;
  versionCheck: { argv: readonly string[]; outputPattern: string };
  auth: { argv: readonly string[]; allowedDomains: readonly string[]; waitForExit: true };
  status: { argv: readonly string[]; format: "json"; jsonMatch: Readonly<Record<string, unknown>> };
  logout: { argv: readonly string[] };
  commandPolicy: { schema: { argv: readonly string[] } };
}

export type ConnectorErrorCode =
  | "CONNECTOR_NOT_FOUND" | "CONNECTOR_MANIFEST_INVALID"
  | "CLI_NOT_INSTALLED" | "CLI_VERSION_INVALID" | "AUTH_REQUIRED"
  | "AUTH_FAILED" | "COMMAND_NOT_ALLOWED" | "CONFIRMATION_REQUIRED"
  | "PERMISSION_DENIED" | "NETWORK_ERROR" | "OUTPUT_TOO_LARGE"
  | "CONNECTOR_TIMEOUT" | "CONNECTOR_BROKEN" | "CONNECTOR_BUSY";
```

- [ ] **Step 4: Implement strict parsing and immutable Registry discovery**

`loadConnectorPackage(root)` must parse only `connector.json` and `cli.json`, reject unknown fields recursively, resolve every resource with `realpath`, reject symbolic links, enforce containment, and return frozen objects. Enforce at most 1024 resource files, 8 MiB per text resource, 256 KiB for icons, and 64 MiB total excluding the audited npm lock. `createConnectorRegistry(root)` must validate `connector-runtime-lock.json`, list ordinary child directories only, reject duplicate IDs or missing lock entries, and expose `list()` plus `get(id)` without mutable internals.

- [ ] **Step 5: Run tests and commit**

Run: `npx tsx --test test/src/domains/connector/node/manifest.test.ts test/src/domains/connector/node/registry.test.ts`

Expected: PASS.

```bash
git add src/domains/connector/node/types.ts src/domains/connector/node/errors.ts src/domains/connector/node/manifest.ts src/domains/connector/node/registry.ts test/src/domains/connector/node/manifest.test.ts test/src/domains/connector/node/registry.test.ts
git commit -m "feat: define managed connector package protocol"
```

### Task 2: Add the audited DingTalk adapter and runtime lock

**Files:**
- Create: `resources/builtin-connectors/connector-runtime-lock.json`
- Create: `resources/builtin-connectors/dingtalk/connector.json`
- Create: `resources/builtin-connectors/dingtalk/cli.json`
- Create: `resources/builtin-connectors/dingtalk/npm-lock.json`
- Create: `resources/builtin-connectors/dingtalk/skills/SKILL.md`
- Create: `resources/builtin-connectors/dingtalk/skills/references/**` (the 598 reference files from the audited `dws-skills.zip` archive)
- Create: `resources/builtin-connectors/dingtalk/schemas/error-map.json`
- Create: `resources/builtin-connectors/dingtalk/assets/icon.png`
- Create: `resources/builtin-connectors/dingtalk/LICENSE`
- Create: `resources/builtin-connectors/dingtalk/NOTICE`
- Create: `test/src/domains/connector/node/dingtalk_package.test.ts`

- [ ] **Step 1: Write the adapter contract test**

```ts
test("DingTalk adapter pins the official CLI and OAuth contract", async () => {
  const registry = await createConnectorRegistry("resources/builtin-connectors");
  const dingtalk = registry.get("dingtalk");
  assert.equal(dingtalk?.cli.install.package, "dingtalk-workspace-cli");
  assert.equal(dingtalk?.cli.install.version, "1.0.59");
  assert.equal(dingtalk?.cli.install.registry, "https://registry.npmjs.org");
  assert.deepEqual(dingtalk?.cli.auth.argv, ["auth", "login", "-y", "--no-browser"]);
  assert.deepEqual(dingtalk?.cli.auth.allowedDomains, ["login.dingtalk.com"]);
  assert.deepEqual(dingtalk?.cli.logout.argv, ["auth", "reset"]);
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npx tsx --test test/src/domains/connector/node/dingtalk_package.test.ts`

Expected: FAIL because the built-in DingTalk package is absent.

- [ ] **Step 3: Add the exact runtime lock and manifests**

Use these audited root entries:

```json
{
  "schemaVersion": 1,
  "node": {
    "version": "22.22.2",
    "package": "node",
    "integrity": "sha512-uCQMMuaVCiljJoMqEWAvmErZBtomwJnRA6xXQksO6VbjQhizdjQkLS9Oje57RvbODBm/Kqb0Nt+8fX7Ng4gHFg=="
  },
  "npm": {
    "version": "11.7.0",
    "package": "npm",
    "integrity": "sha512-wiCZpv/41bIobCoJ31NStIWKfAxxYyD1iYnWCtiyns8s5v3+l8y0HCP/sScuH6B5+GhIfda4HQKiqeGZwJWhFw=="
  },
  "packages": {
    "dingtalk-workspace-cli@1.0.59": {
      "integrity": "sha512-f/dqjtpeUF9lz/uunqkgLerB1YoiXBVeM69QocjlFQeNhBYDdWI2isCRG6lzfilSVGDfm5Xp5IZvcrrsweUM3g=="
    }
  }
}
```

`connector.json` must declare ID `dingtalk`, version `1.0.0`, `delegate_to_dingtalk`, the local Skill path, and the local icon. `cli.json` must use `auth login -y --no-browser`, status JSON match `{ "authenticated": true }`, and version pattern `^dws version v1\\.0\\.59\\b`. It must declare the audited root postinstall as `{ "path": "install.js", "argv": [] }` so dependency lifecycle scripts stay disabled.

- [ ] **Step 4: Generate and audit the complete npm lock and official Skill**

Run:

```bash
npm pack dingtalk-workspace-cli@1.0.59 --pack-destination /private/tmp
mkdir -p /private/tmp/pi-a-dingtalk-audit
tar -xzf /private/tmp/dingtalk-workspace-cli-1.0.59.tgz -C /private/tmp/pi-a-dingtalk-audit --strip-components=1
npm install --package-lock-only --ignore-scripts --prefix /private/tmp/pi-a-dingtalk-lock dingtalk-workspace-cli@1.0.59
```

Copy the generated lock to `resources/builtin-connectors/dingtalk/npm-lock.json`. Extract `assets/dws-skills.zip` into `resources/builtin-connectors/dingtalk/skills/`, preserving `SKILL.md` and the complete `references/` tree. Extract the platform archive's `LICENSE` and `NOTICE` into the connector root. Confirm every package entry in the lock has an integrity and that the root package version is `1.0.59`.

- [ ] **Step 5: Add the error map and icon**

The error map must map authentication failures to `AUTH_REQUIRED` or `AUTH_FAILED`, timeout/network failures to their stable codes, and leave unknown non-zero exits as `CONNECTOR_BROKEN`. Copy `frontend/public/logos/dingtalk.png` to the adapter asset path so the backend catalog owns its presentation resource.

- [ ] **Step 6: Run tests and commit**

Run: `npx tsx --test test/src/domains/connector/node/dingtalk_package.test.ts`

Expected: PASS.

```bash
git add resources/builtin-connectors test/src/domains/connector/node/dingtalk_package.test.ts
git commit -m "feat: add audited DingTalk connector package"
```

### Task 3: Implement private paths and atomic connector state

**Files:**
- Create: `src/domains/connector/node/paths.ts`
- Create: `src/domains/connector/node/state_store.ts`
- Create: `test/src/domains/connector/node/state_store.test.ts`
- Modify: `src/platform/paths.ts`

- [ ] **Step 1: Write path and state tests**

```ts
test("creates one isolated prefix per connector and version", () => {
  const paths = createConnectorPaths("/app-data", "dingtalk", "1.0.59", posix);
  assert.equal(paths.versionRoot, "/app-data/connectors/packages/dingtalk/versions/1.0.59");
  assert.equal(paths.npmPrefix, "/app-data/connectors/packages/dingtalk/versions/1.0.59/npm-prefix");
});

test("atomic state write never exposes partial JSON", async () => {
  const store = createConnectorStateStore(tempRoot);
  await store.write("dingtalk", { state: "installing", operationId: "op-1" });
  assert.deepEqual(await store.read("dingtalk"), {
    state: "installing",
    operationId: "op-1",
  });
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npx tsx --test test/src/domains/connector/node/state_store.test.ts`

Expected: FAIL because connector paths and state store are undefined.

- [ ] **Step 3: Implement paths and state persistence**

Add `connectorsDir` to `PlatformPaths` as `<appDataDir>/connectors`. `createConnectorPaths` must validate connector ID and version before joining paths. `state_store.ts` must write `<id>/state.json.tmp-<uuid>`, fsync/close, then rename to `state.json`; reads must validate the stored state object and map malformed JSON to `CONNECTOR_BROKEN`.

The public state DTO must omit CLI stdout, authorization URLs, environment values, and credentials:

```ts
export interface ConnectorPublicState {
  id: string;
  state: ConnectorLifecycleState;
  connectorVersion: string;
  installedCliVersion: string | null;
  operationId: string | null;
  lastCheckedAt: number | null;
  error: { code: ConnectorErrorCode; message: string } | null;
  updateAvailable: boolean;
}
```

- [ ] **Step 4: Run tests and commit**

Run: `npx tsx --test test/src/domains/connector/node/state_store.test.ts test/src/platform/cli/runtime.test.ts`

Expected: PASS.

```bash
git add src/platform/paths.ts src/domains/connector/node/paths.ts src/domains/connector/node/state_store.ts test/src/domains/connector/node/state_store.test.ts
git commit -m "feat: persist managed connector lifecycle state"
```

### Task 4: Package the managed Node/npm runtime and implement shell-free process execution

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Create: `src/domains/connector/node/process_runner.ts`
- Create: `test/src/domains/connector/node/process_runner.test.ts`
- Modify: `src/platform/cli/runtime.ts`
- Modify: `test/src/platform/cli/runtime.test.ts`

- [ ] **Step 1: Add exact managed runtime dependencies**

Run: `npm install --save-exact node@22.22.2 npm@11.7.0`

Add the exact packages to the project's script allowlist so their audited install steps run during application dependency installation. Do not resolve `node` or `npm` from the user's `PATH`.

- [ ] **Step 2: Write process runner tests**

```ts
test("runs an executable with argv, no shell, bounded output, and sanitized env", async () => {
  const call = captureSpawn();
  await runManagedProcess({
    executable: "/app/node",
    argv: ["/app/npm-cli.js", "--version"],
    timeoutMs: 1000,
    maxOutputBytes: 1024,
  }, call.spawn);
  assert.equal(call.options.shell, false);
  assert.equal(call.options.env.NODE_OPTIONS, undefined);
  assert.deepEqual(call.argv, ["/app/npm-cli.js", "--version"]);
});

test("aborts the child process and returns CONNECTOR_TIMEOUT", async () => {
  await assert.rejects(runNeverEndingProcess({ timeoutMs: 5 }),
    (error: unknown) => (error as ConnectorError).code === "CONNECTOR_TIMEOUT");
});
```

- [ ] **Step 3: Run tests and verify failure**

Run: `npx tsx --test test/src/domains/connector/node/process_runner.test.ts test/src/platform/cli/runtime.test.ts`

Expected: FAIL because `runManagedProcess` is absent.

- [ ] **Step 4: Implement the managed runtime locator and runner**

Expose one locator:

```ts
export interface ManagedNodeRuntime {
  node: string;
  npmCli: string;
  version: "22.22.2";
}

export function resolveManagedNodeRuntime(): ManagedNodeRuntime;
```

Resolve `node/bin/node` or `node/bin/node.exe` and `npm/bin/npm-cli.js` using `createRequire(import.meta.url)`. Verify `node --version` equals `v22.22.2` before first connector operation and cache only successful verification.

`runManagedProcess` must use `spawn`, `shell: false`, `windowsHide: true`, the existing secret-filtering environment logic, separate stdout/stderr byte budgets, line callbacks for authorization URLs, timeout, and `AbortSignal`. On Windows terminate the process tree through the existing platform process abstraction.

- [ ] **Step 5: Run tests and commit**

Run: `npx tsx --test test/src/domains/connector/node/process_runner.test.ts test/src/platform/cli/runtime.test.ts`

Expected: PASS.

```bash
git add package.json package-lock.json src/platform/cli/runtime.ts src/domains/connector/node/process_runner.ts test/src/platform/cli/runtime.test.ts test/src/domains/connector/node/process_runner.test.ts
git commit -m "feat: add managed Node runtime for connectors"
```

### Task 5: Implement the isolated node-npm Driver with staging and rollback

**Files:**
- Create: `src/domains/connector/node/node_npm_driver.ts`
- Create: `test/src/domains/connector/node/node_npm_driver.test.ts`

- [ ] **Step 1: Write Driver tests with a fake process runner**

Cover exact npm args, private prefix, lockfile copy, dependency scripts disabled, audited root postinstall, executable containment, version verification, atomic `current.json`, and preservation of the old current version after a failed upgrade.

```ts
assert.deepEqual(installCall.argv, [
  npmCli,
  "ci",
  "--prefix", stagingRoot,
  "--registry", "https://registry.npmjs.org",
  "--ignore-scripts",
  "--no-audit",
  "--no-fund",
]);
assert.deepEqual(postInstallCall.argv, [resolvedRootInstallJs]);
assert.equal(await readCurrentVersion("dingtalk"), "1.0.59");
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npx tsx --test test/src/domains/connector/node/node_npm_driver.test.ts`

Expected: FAIL because `createNodeNpmDriver` is absent.

- [ ] **Step 3: Implement install and verification**

The Driver must:

1. Create a unique staging directory beneath the connector's versions root.
2. Generate a minimal `package.json` containing only the exact package/version and copy the audited `npm-lock.json` as `package-lock.json`.
3. Run managed npm `ci` with dependency scripts disabled.
4. Verify the root package name, exact version, integrity lock, regular-file tree, and declared bin.
5. If declared, execute only the audited root `postInstall.path` with managed Node and fixed argv.
6. Resolve JavaScript bin entries as managed Node plus an absolute script prefix; resolve native bin entries as the fixed native file. Execute `versionCheck.argv` and require the complete output to match the trusted `outputPattern`.
7. Rename staging to the version root and atomically replace `current.json`.
8. Leave the previous current file unchanged on every failure.

Never call a shell, `npx`, system `npm`, or an executable path received from the renderer/model.

- [ ] **Step 4: Run tests and commit**

Run: `npx tsx --test test/src/domains/connector/node/node_npm_driver.test.ts`

Expected: PASS.

```bash
git add src/domains/connector/node/node_npm_driver.ts test/src/domains/connector/node/node_npm_driver.test.ts
git commit -m "feat: install connector CLIs with atomic rollback"
```

### Task 6: Implement authorization, lifecycle operations, and cancellation

**Files:**
- Create: `src/domains/connector/node/authorization.ts`
- Create: `src/domains/connector/node/lifecycle.ts`
- Create: `test/src/domains/connector/node/authorization.test.ts`
- Create: `test/src/domains/connector/node/lifecycle.test.ts`

- [ ] **Step 1: Write authorization tests**

```ts
test("opens only an allowed HTTPS authorization URL", async () => {
  const opened: string[] = [];
  await authorizeConnector(dingtalk, {
    run: fakeAuthOutput("https://login.dingtalk.com/oauth/device"),
    openExternal: async (url) => { opened.push(url); },
    probeStatus: async () => ({ authenticated: true }),
  });
  assert.deepEqual(opened, ["https://login.dingtalk.com/oauth/device"]);
});

test("rejects a lookalike or non-HTTPS authorization host", async () => {
  for (const url of [
    "https://login.dingtalk.com.evil.test/oauth",
    "http://login.dingtalk.com/oauth",
  ]) {
    await assert.rejects(authorizeWithUrl(url),
      (error: unknown) => (error as ConnectorError).code === "AUTH_FAILED");
  }
});
```

- [ ] **Step 2: Write lifecycle transition and concurrency tests**

Test `activate`, `reauthorize`, `logout`, `repair`, `update`, `cancel`, and `uninstall`; verify a second mutating operation returns `CONNECTOR_BUSY`, authorization is entered automatically after a successful first install, status probing—not auth exit code—sets `ready`, stale operations become stable failure states, and cancellation aborts the active child process.

- [ ] **Step 3: Run tests and verify failure**

Run: `npx tsx --test test/src/domains/connector/node/authorization.test.ts test/src/domains/connector/node/lifecycle.test.ts`

Expected: FAIL because lifecycle and authorization modules are absent.

- [ ] **Step 4: Implement Authorization Broker**

Parse complete URL tokens from stdout/stderr line callbacks, validate with `new URL`, require `https:`, and compare `url.hostname` exactly against the manifest allowlist. Open the first valid URL once. After the auth process exits, run status independently and deep-match the declared JSON keys.

- [ ] **Step 5: Implement Lifecycle Runner**

Use an in-process `Map<connectorId, Operation>` plus `<connectorsDir>/locks/<id>.lock`. Every operation writes state before and after each phase. `activate` installs or updates when necessary and then authorizes automatically. `reauthorize` keeps the CLI, runs the declared logout command to replace the single account/company binding, and then starts authorization. `logout` runs the declared logout argv, destroys connector children, and sets `installed_unauthorized`. `uninstall` logs out first, aborts active work, removes only the resolved connector package/cache paths, and writes `not_installed`.

Do not auto-open authorization after an expired token is detected during a command; return `AUTH_REQUIRED` and wait for a user action.

- [ ] **Step 6: Run tests and commit**

Run: `npx tsx --test test/src/domains/connector/node/authorization.test.ts test/src/domains/connector/node/lifecycle.test.ts`

Expected: PASS.

```bash
git add src/domains/connector/node/authorization.ts src/domains/connector/node/lifecycle.ts test/src/domains/connector/node/authorization.test.ts test/src/domains/connector/node/lifecycle.test.ts
git commit -m "feat: manage connector authorization lifecycle"
```

### Task 7: Implement schema-bound command execution, permissions, and artifacts

**Files:**
- Create: `src/domains/connector/node/command_policy.ts`
- Create: `src/domains/connector/node/command_gateway.ts`
- Create: `src/agent/tools/connector_cli_execute.ts`
- Create: `test/src/domains/connector/node/command_gateway.test.ts`
- Modify: `src/infra/context.ts`
- Modify: `src/agent/permissions.ts`

- [ ] **Step 1: Write command gateway tests**

Cover connector ID binding, missing child context, shell metacharacters as literal argv values, schema-disallowed commands, L1 rejection, L2 write confirmation, L3 high-risk confirmation, confirmation parameter replay, no write retry, read-only network retry, redaction, timeout mapping, and large output artifact creation.

```ts
test("uses connector identity from AsyncLocalStorage, not model input", async () => {
  await connectorSessionContext.run({
    parentSessionId: "parent-1",
    childSessionId: "child-1",
    connectorId: "dingtalk",
    permission: "L2",
  }, async () => {
    const result = await connectorCliExecute({ argv: ["calendar", "list"] });
    assert.equal(result.connectorId, "dingtalk");
  });
});

test("high-risk commands execute once only after parent confirmation", async () => {
  const result = await executeWithConfirmation(["chat", "send", "--text", "hello"]);
  assert.equal(result.confirmationCount, 1);
  assert.equal(result.executionCount, 1);
  assert.deepEqual(result.executedArgv, ["chat", "send", "--text", "hello", "--yes"]);
});
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npx tsx --test test/src/domains/connector/node/command_gateway.test.ts`

Expected: FAIL because the command policy and gateway are absent.

- [ ] **Step 3: Implement command discovery and policy**

Run the manifest's schema argv after installation, parse JSON with a 2 MiB limit, and cache it by connector ID plus installed CLI version. Normalize each command to:

```ts
export interface ConnectorCommandRule {
  path: readonly string[];
  effect: "read" | "write";
  risk: "normal" | "high";
  confirmationArgv: readonly string[];
  retry: "none" | "read-network-once";
}
```

Reject command paths absent from current schema. The audited adapter may supply risk overrides for delete, approval, message-send, permission-change, and identity-management paths; overrides may increase but never lower vendor risk.

- [ ] **Step 4: Implement Gateway and connector-only tool**

`connector_cli_execute` accepts only `{ argv: string[], attachmentIds?: string[] }`. Resolve the executable from the active Driver and connector ID from `connectorSessionContext`. Map permission as follows: Ask/Plan unavailable; L1 read only; L2 all writes confirm; L3 normal writes proceed while high-risk writes confirm. Send confirmation through the parent session handler with a redacted operation summary.

Export `requestToolConfirmation(sessionId, toolName, args)` from `src/agent/permissions.ts` as the single bridge to the existing private confirmation-handler map. The Gateway must call it with the parent session ID; it must not create a second renderer confirmation system.

Outputs above 1 MiB must be written to the parent session artifact directory and returned as a bounded summary plus path. Logs may retain command identity, risk, exit code, duration, stable error code, and trace ID only.

- [ ] **Step 5: Run tests and commit**

Run: `npx tsx --test test/src/domains/connector/node/command_gateway.test.ts test/src/agent/prompt-runtime/permission-policy.test.ts`

Expected: PASS.

```bash
git add src/infra/context.ts src/agent/permissions.ts src/domains/connector/node/command_policy.ts src/domains/connector/node/command_gateway.ts src/agent/tools/connector_cli_execute.ts test/src/domains/connector/node/command_gateway.test.ts
git commit -m "feat: secure connector CLI command execution"
```

### Task 8: Add dedicated connector-child prompt and tool isolation

**Files:**
- Create: `resources/prompts/v2/categories/connector-agent.md`
- Modify: `src/agent/prompt-runtime/types.ts`
- Modify: `src/agent/prompt-runtime/category-policy.ts`
- Modify: `src/agent/prompt-runtime/session-intent.ts`
- Modify: `src/agent/prompt-runtime/prompt-packs.ts`
- Modify: `src/agent/prompt-runtime/runtime-profile.ts`
- Modify: `src/agent/prompt-runtime/tool-policy.ts`
- Modify: `src/agent/tools/index.ts`
- Create: `test/src/agent/prompt-runtime/connector-agent.test.ts`

- [ ] **Step 1: Write prompt/runtime isolation tests**

```ts
test("connector child receives only connector_cli_execute", async () => {
  const profile = await resolveConnectorChildProfile("dingtalk");
  assert.deepEqual(profile.activeToolNames, ["connector_cli_execute"]);
  assert.equal(profile.category.promptPackId, "category/connector-agent");
  assert.deepEqual(profile.resources.skills?.map((skill) => skill.name), ["dws"]);
});

test("connector child cannot receive shell, files, MCP, or another connector", async () => {
  const profile = await resolveConnectorChildProfile("dingtalk");
  for (const forbidden of ["bash", "read", "write", "call_subagent", "mcp_demo"])
    assert.equal(profile.activeToolNames.includes(forbidden), false);
});
```

- [ ] **Step 2: Run the test and verify failure**

Run: `npx tsx --test test/src/agent/prompt-runtime/connector-agent.test.ts`

Expected: FAIL because `connector_agent` is not a session category/tool pack.

- [ ] **Step 3: Add the dedicated category and prompt**

Extend `SessionCategory` with `connector_agent`, add a `connector_agent` tool pack, force Craft mode, and add a category prompt stating that the child must use only its injected Skill and `connector_cli_execute`, must not claim an action succeeded without CLI output, and must return a concise concrete result to its parent.

- [ ] **Step 4: Add connector-specific resource loading**

For a connector child, load only the adapter's Skill and no global user/built-in skills or prompt templates. Keep ordinary assistant/expert/skill-creator resource loading unchanged. Include `connectorId` and installed CLI version in the structural hash so repair/update invalidates stale profiles.

- [ ] **Step 5: Run tests and commit**

Run: `npx tsx --test test/src/agent/prompt-runtime/connector-agent.test.ts test/src/agent/prompt-runtime/prompt-runtime.integration.test.ts test/src/agent/prompt-runtime/tool-policy.test.ts`

Expected: PASS.

```bash
git add resources/prompts/v2/categories/connector-agent.md src/agent/prompt-runtime src/agent/tools/index.ts test/src/agent/prompt-runtime/connector-agent.test.ts
git commit -m "feat: isolate connector child agent runtime"
```

### Task 9: Implement persistent hidden connector subagents and autonomous delegation

**Files:**
- Modify: `src/infra/db.ts`
- Modify: `src/domains/session/node/store.ts`
- Create: `src/domains/connector/node/agent_session_store.ts`
- Create: `src/domains/connector/node/agent_manager.ts`
- Create: `src/agent/tools/connector_delegate.ts`
- Modify: `src/agent/provider.ts`
- Modify: `src/agent/prompt-runtime/runtime-profile.ts`
- Modify: `src/agent/prompt-runtime/tool-policy.ts`
- Modify: `src/agent/session_cleanup.ts`
- Create: `test/src/domains/connector/node/agent_manager.test.ts`
- Create: `test/src/agent/prompt-runtime/connector-delegation.test.ts`

- [ ] **Step 1: Add the association table and tests**

```sql
CREATE TABLE IF NOT EXISTS connector_agent_sessions (
  parent_session_id TEXT NOT NULL,
  connector_id TEXT NOT NULL,
  child_session_id TEXT NOT NULL UNIQUE,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (parent_session_id, connector_id),
  FOREIGN KEY (parent_session_id) REFERENCES conversations(id) ON DELETE CASCADE,
  FOREIGN KEY (child_session_id) REFERENCES conversations(id) ON DELETE CASCADE
);
```

Test that two delegations from the same parent reuse one child, a different parent gets a different child, normal conversation listing excludes `parent_id IS NOT NULL`, and deleting a parent disposes and deletes all connector children.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx tsx --test test/src/domains/connector/node/agent_manager.test.ts test/src/agent/prompt-runtime/connector-delegation.test.ts`

Expected: FAIL because connector child persistence/delegation does not exist.

- [ ] **Step 3: Implement the Agent Manager**

`delegate(parentSessionId, connectorId, task, attachmentIds, permission, signal)` must require connector state `ready`, get or create a `connector_agent` child with the parent's model/workspace, attach persistence, explicitly resolve only the passed attachment IDs, and call `provider.prompt` with connector-child context. It must wait for the child result without polling SQLite: subscribe to provider events, resolve on `agent_end`, then read the last assistant message as the durable result. Abort from the parent must abort the child.

The delegation tool must intersect model-supplied attachment IDs with the attachment IDs already present in the parent `sessionContext`; an ID outside that set is rejected before the child is created. `provider.ts` must place the normalized parent permission into `sessionContext` so the child cannot raise its own permission level.

On `AUTH_REQUIRED`, update lifecycle state, return the stable error to the main Agent, and keep authorization user-driven. On logout/uninstall/delete-parent, dispose the provider child, delete its Core session, messages, artifacts, working memory, conversation row, and association row.

- [ ] **Step 4: Implement dynamic main-Agent delegation tools**

Create one tool per ready connector:

```ts
{
  name: "delegate_to_dingtalk",
  label: "使用钉钉",
  description: "当用户需要查询或操作钉钉办公数据时，将任务委派给已授权的钉钉连接器。",
  parameters: Type.Object({
    task: Type.String(),
    attachmentIds: Type.Optional(Type.Array(Type.String())),
  }),
}
```

The execute function must take `parentSessionId`, attachments, and permission from `sessionContext`, not model-supplied connector identity. Add ready delegation tools only to ordinary Craft sessions. Ask/Plan, connector children, skill creator, and expert creator must receive none.

- [ ] **Step 5: Run tests and commit**

Run: `npx tsx --test test/src/domains/connector/node/agent_manager.test.ts test/src/agent/prompt-runtime/connector-delegation.test.ts test/src/agent/provider_prompt_runtime.test.ts`

Expected: PASS.

```bash
git add src/infra/db.ts src/domains/session/node/store.ts src/domains/connector/node/agent_session_store.ts src/domains/connector/node/agent_manager.ts src/agent/tools/connector_delegate.ts src/agent/provider.ts src/agent/prompt-runtime/runtime-profile.ts src/agent/prompt-runtime/tool-policy.ts src/agent/session_cleanup.ts test/src/domains/connector/node/agent_manager.test.ts test/src/agent/prompt-runtime/connector-delegation.test.ts
git commit -m "feat: add persistent connector delegation agents"
```

### Task 10: Expose the connector service through HTTP and synchronized IPC

**Files:**
- Create: `src/domains/connector/node/service.ts`
- Modify: `application.electron.ts`
- Modify: `src/electron/ipc-handlers.ts`
- Modify: `src/electron/preload.cjs`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/api/client.test.ts`
- Create: `test/src/domains/connector/node/service.test.ts`

- [ ] **Step 1: Write service and route-contract tests**

Test the following routes and payload mapping:

```text
GET    /api/connectors
POST   /api/connectors/:id/activate
POST   /api/connectors/:id/reauthorize
POST   /api/connectors/:id/logout
POST   /api/connectors/:id/update
POST   /api/connectors/:id/repair
DELETE /api/connectors/:id/operation
DELETE /api/connectors/:id
```

```ts
assert.deepEqual(
  resolveIPCRouteForTest("POST", "/api/connectors/dingtalk/activate"),
  { invoke: "connector.activate", payload: { id: "dingtalk" } },
);
```

- [ ] **Step 2: Run tests and verify failure**

Run: `npx tsx --test test/src/domains/connector/node/service.test.ts frontend/src/api/client.test.ts`

Expected: FAIL because connector service and IPC routes are absent.

- [ ] **Step 3: Implement the application facade**

Initialize one service from the built-in Registry, lifecycle runner, Driver, Authorization Broker, Command Gateway, and Agent Manager. `list()` must probe cheap local install/version state and return catalog metadata plus public state. The response item is `{ id, displayName, description, iconDataUrl, delegateToolName, state }`; `iconDataUrl` is produced from the validated local PNG with a 256 KiB limit, so the renderer never receives a filesystem path. Mutating methods must start a tracked background operation and immediately return `{ operationId, state }`; duplicate operations return HTTP 409 with `CONNECTOR_BUSY`.

- [ ] **Step 4: Add HTTP routes and error mapping**

Parse connector IDs as one decoded path segment and never accept manifest/command data in request bodies. Map stable connector errors to 400/401/403/404/409/422/500/504 as defined in `errors.ts`. Route DELETE uninstall separately from DELETE operation cancellation.

- [ ] **Step 5: Add IPC in all three required layers**

Register `connector.list`, `connector.activate`, `connector.reauthorize`, `connector.logout`, `connector.update`, `connector.repair`, `connector.cancel`, and `connector.uninstall` in `ipc-handlers.ts`; expose the same methods in `preload.cjs`; add all names to the `client-invoke` allowlist; and map each frontend API route in `client.ts`.

- [ ] **Step 6: Run tests and commit**

Run: `npx tsx --test test/src/domains/connector/node/service.test.ts frontend/src/api/client.test.ts test/src/electron/api-response.test.ts`

Expected: PASS.

```bash
git add src/domains/connector/node/service.ts application.electron.ts src/electron/ipc-handlers.ts src/electron/preload.cjs frontend/src/api/client.ts frontend/src/api/client.test.ts test/src/domains/connector/node/service.test.ts
git commit -m "feat: expose managed connector lifecycle APIs"
```

### Task 11: Replace static connector UI state with the backend catalog

**Files:**
- Create: `frontend/src/components/connectorModel.ts`
- Create: `frontend/src/components/connectorModel.test.ts`
- Modify: `frontend/src/store/useSkillStore.ts`
- Modify: `frontend/src/components/ExpertPanel.tsx`
- Modify: `frontend/src/components/ExpertPanel.css`

- [ ] **Step 1: Write connector presentation tests**

```ts
test("maps every lifecycle state to one visible label and primary action", () => {
  const state = (value: ConnectorLifecycleState): ConnectorPublicState => ({
    id: "dingtalk", state: value, connectorVersion: "1.0.0",
    installedCliVersion: null, operationId: null, lastCheckedAt: null,
    error: null, updateAvailable: false,
  });
  assert.deepEqual(presentConnector(state("not_installed")), {
    label: "未安装", action: "activate", actionLabel: "安装并授权", busy: false,
  });
  assert.equal(presentConnector(state("installing")).action, "cancel");
  assert.equal(presentConnector(state("auth_expired")).action, "reauthorize");
  assert.equal(presentConnector(state("connector_broken")).action, "repair");
});
```

Cover all states from `ConnectorLifecycleState`, including update available and operation failure.

- [ ] **Step 2: Run the test and verify failure**

Run: `npx tsx --test frontend/src/components/connectorModel.test.ts`

Expected: FAIL because `connectorModel.ts` is absent.

- [ ] **Step 3: Implement frontend DTOs and Zustand actions**

Replace `mcpConfig`-based preset install state for built-in connectors with:

```ts
connectors: ConnectorCatalogItem[];
connectorsLoading: boolean;
connectorActionId: string | null;
connectorError: string | null;
loadConnectors(): Promise<void>;
activateConnector(id: string): Promise<void>;
reauthorizeConnector(id: string): Promise<void>;
logoutConnector(id: string): Promise<void>;
updateConnector(id: string): Promise<void>;
repairConnector(id: string): Promise<void>;
cancelConnectorOperation(id: string): Promise<void>;
uninstallConnector(id: string): Promise<void>;
```

After a mutation starts, poll `GET /api/connectors` every second while any connector is `installing` or `authorizing`; stop on a terminal state or component/store teardown. Preserve the advanced custom MCP configuration view as a separate section; do not convert arbitrary `mcp.json` entries into managed connector state.

- [ ] **Step 4: Replace `PRESET_CONNECTORS` and implement actions**

Delete `PresetConnector`, `PRESET_CONNECTORS`, `isMcpInstalled`, and `handleToggleMcpInstall`. Render backend catalog items and show the actual status. On first activation, display “首次使用或更新需要安装连接器依赖，正在安装中，请稍后”; installation completion flows automatically into `authorizing` while the backend opens the official page.

For ready connectors provide menu actions: 重新授权、退出登录、检查更新、修复依赖、卸载连接器. `auth_expired` restores the plus/reauthorize action. Uninstall requires the existing danger confirmation. Errors display the stable message without exposing CLI stderr.

- [ ] **Step 5: Style status, progress, and action menu**

Keep the existing card grid and visual language. Add styles for neutral/installing/authorizing/ready/warning/error states, a disabled spinner button, cancel action, and keyboard-focusable menu. Do not add Client ID, Agent Code, token, or secret inputs.

- [ ] **Step 6: Run tests, build, and commit**

Run:

```bash
npx tsx --test frontend/src/components/connectorModel.test.ts frontend/src/api/client.test.ts
cd frontend && npx tsc -b --pretty false
```

Expected: tests PASS and TypeScript exits 0.

```bash
git add frontend/src/components/connectorModel.ts frontend/src/components/connectorModel.test.ts frontend/src/store/useSkillStore.ts frontend/src/components/ExpertPanel.tsx frontend/src/components/ExpertPanel.css
git commit -m "feat: show real managed connector state"
```

### Task 12: Package connector resources and verify end-to-end behavior

**Files:**
- Modify: `electron-builder.yml`
- Modify: `src/agent/startup.ts`
- Create: `test/src/domains/connector/node/packaging.test.ts`
- Create: `test/src/domains/connector/node/e2e.test.ts`

- [ ] **Step 1: Write packaging and simulated E2E tests**

Packaging test must assert that builder rules include connector JSON, connector Skill Markdown, icon, npm lock, managed `node`, and managed `npm`. E2E must use temporary appData and fake process/browser adapters to verify:

```text
not_installed -> installing -> installed_unauthorized -> authorizing -> ready
ready -> auth_expired after CLI auth failure
auth_expired -> authorizing -> ready after user reauthorization
ready -> installed_unauthorized after logout
ready -> not_installed after uninstall
```

Also verify install rollback, cancellation, concurrent-operation rejection, delegation child reuse, attachment allowlisting, confirmation routing, hidden child listing, and parent deletion cleanup.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx tsx --test test/src/domains/connector/node/packaging.test.ts test/src/domains/connector/node/e2e.test.ts`

Expected: FAIL until packaging and startup initialization are complete.

- [ ] **Step 3: Update packaging and startup**

Ensure `resources/builtin-connectors/**/*` is included despite the global Markdown exclusion. Ensure exact `node` and `npm` dependencies are packaged. At startup validate the Registry and runtime lock, recover stale staging/locks, but do not install, authorize, open a browser, or contact npm until the user activates a connector.

- [ ] **Step 4: Run focused and full verification**

Run:

```bash
npx tsx --test test/src/domains/connector/node/*.test.ts test/src/agent/prompt-runtime/connector-agent.test.ts test/src/agent/prompt-runtime/connector-delegation.test.ts frontend/src/components/connectorModel.test.ts frontend/src/api/client.test.ts
npx tsc --project tsconfig.electron.json --noEmit
cd frontend && npx tsc -b --pretty false
npm run test:backend
npm run build:frontend
git diff --check
```

Expected: all focused tests PASS; backend suite has zero failures; both TypeScript checks exit 0; frontend build succeeds; diff check is clean.

- [ ] **Step 5: Perform a real DingTalk smoke test**

On a clean test appData directory:

1. Start Electron and open 专家 → 连接器.
2. Click 钉钉 “＋”.
3. Verify the install notice appears and every installed file stays under `<test-appData>/connectors`.
4. Verify the official `https://login.dingtalk.com` page opens automatically after install.
5. Complete authorization and verify the card becomes 已连接.
6. Ask the main Agent to query a read-only DingTalk capability and verify it autonomously calls `delegate_to_dingtalk`.
7. Send a second related message and verify the same hidden child session is reused.
8. Trigger a message-send operation and verify the parent confirmation card appears before one execution.
9. Revoke/reset authorization and verify the next command reports authorization expiry without auto-opening a page.
10. Click “＋” to reauthorize, then verify logout and uninstall remove authorization/session/install state.

- [ ] **Step 6: Commit packaging and end-to-end verification**

```bash
git add electron-builder.yml src/agent/startup.ts test/src/domains/connector/node/packaging.test.ts test/src/domains/connector/node/e2e.test.ts
git commit -m "test: verify managed connector integration"
```

---

## Design traceability

| Design requirement | Implemented by |
|---|---|
| Audited built-in package protocol and no remote marketplace | Tasks 1–2 |
| Private paths, real lifecycle state, atomic state and stale-lock recovery | Tasks 3, 6, 12 |
| Built-in Node/npm, exact versions, integrity, isolated prefix, rollback | Tasks 2, 4–5 |
| Automatic first authorization, domain restriction, reauthorization/logout | Task 6 |
| Schema-bound CLI, L1/L2/L3, confirmation, errors, redaction, artifacts | Task 7 |
| Full Skill/tools isolated from the main Agent | Task 8 |
| Autonomous lightweight delegation and persistent hidden child | Task 9 |
| Real backend API/IPC catalog and state-driven connector cards | Tasks 10–11 |
| Packaging, cross-platform paths, simulated E2E and real DingTalk smoke test | Task 12 |

## Delivery checkpoints

- After Task 5: a locked CLI can be installed privately and rolled back, but no UI or Agent access exists.
- After Task 7: lifecycle, authorization, command security, permission, and artifact behavior are testable through backend ports.
- After Task 9: the main Agent can autonomously delegate to a connector while the full CLI Skill/tools remain isolated in a persistent hidden child.
- After Task 11: users can install, authorize, repair, update, logout, and uninstall through real backend state.
- After Task 12: packaged application behavior and DingTalk end-to-end flow are verified.

## Non-negotiable acceptance checks

- No built-in connector uses `npx` or the user's global Node/npm/PATH.
- No renderer request or model argument chooses package name, executable path, connector identity, authorization domain, or lifecycle command.
- No ordinary main-Agent context contains the full DingTalk Skill or CLI schema.
- No connector child receives shell, filesystem mutation, MCP, expert-management, or another connector's tools.
- No third-party token, cookie, authorization code, AppSecret, business response body, or full environment is persisted or logged.
- No update can replace a verified current version before install, integrity, bin, postinstall, and version checks all pass.
- No expired authorization opens a browser until the user explicitly requests reauthorization.
- No high-risk write executes without confirmation, and confirmed business parameters execute exactly once.
- Adding another audited `node-npm` connector requires only a connector package and vendor error/risk mappings, not a branch in the generic runtime, lifecycle, Agent manager, API, or UI.
