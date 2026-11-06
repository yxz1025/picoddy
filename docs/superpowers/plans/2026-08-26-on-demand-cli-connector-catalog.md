# On-Demand CLI Connector Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace bundled vendor connector trees with a lightweight built-in JSON catalog that downloads an audited official CLI and extracts its Skill only after the user clicks “＋”, then complete the generic install, authorization, delegation, and UI lifecycle with DingTalk as the first entry.

**Architecture:** `ConnectorRegistry` reads only `connector-catalog.json` and the managed runtime lock; catalog reads are bounded, immutable, offline, and side-effect free. Activation materializes a complete npm lock from the selected entry, installs into an isolated staging prefix with lifecycle scripts disabled, validates the package, extracts the declared Skill archive safely, and atomically switches `current`. Only ready connectors expose a lightweight main-Agent delegate; the extracted Skill and constrained CLI gateway remain in a hidden persistent connector child session.

**Tech Stack:** Electron 43, Node.js 22, TypeScript, React 19, Zustand, node:sqlite, TypeBox, npm 11, PizZip, Node `spawn`/`execFile`, `node:test`.

**Design reference:** `docs/superpowers/specs/2026-08-25-managed-cli-connector-framework-design.md`

## Execution status (2026-08-27)

This document is the authoritative implementation plan. Execution is performed
directly on `master` as previously confirmed by the user.

- **Completed:** Task 1, strict offline catalog loading and registry hardening.
- **Completed:** Task 2, DingTalk converted to an on-demand catalog entry; the
  bundled DingTalk resource tree and package test fixture were removed.
- **Completed:** Task 3, private connector paths and atomic lifecycle state.
- **Completed:** Task 4, bundled npm runtime, managed runtime resolution, and
  shell-free bounded connector process execution.
- **Completed:** Task 5, on-demand CLI install and Skill extraction.
- **Completed:** Task 6, connector lifecycle state machine, file locks, startup
  recovery, URL-whitelisted authorization, and independent status verification.
- **Completed:** Task 7, catalog-schema-bound command validation, high-risk
  confirmation replay, catalog error mapping, and artifact-ref large output.
- **Completed:** Task 8, connector-child prompt category and tool isolation.
- **Completed:** Task 9, persistent hidden connector children and autonomous
  delegation.
- **Completed:** Task 10, one managed connector service exposed through HTTP and
  IPC, plus a state-store round-trip fix for `not_installed` uninstall.
- **Completed:** Task 11, static `PRESET_CONNECTORS` cards replaced with
  catalog-driven cards driven by `connector.list` lifecycle state.
- **Completed:** Task 12, packaging excludes connector vendor trees, startup
  validates catalog/runtime and recovers stale locks/staging, and packaged /
  on-demand-flow tests were added.
- **Next:** none — all 12 tasks complete; the design spec's remaining closure
  items are tracked in its "尚未完成，不能宣称首期闭环" section.
- **Verification policy:** per the user's explicit instruction, do not run
  automated tests or test suites. For each task, only run TypeScript/JSON syntax
  validation and `git diff --check`; reviewers must follow the same restriction.
- **Design boundary:** `pi-mcp-adapter` was researched only as reference. It is
  not integrated into this implementation and does not replace the catalog,
  installer, authorization, Skill extraction, or hidden connector-session
  design described below.

### Task completion records

| Task | Commit(s) | Result |
| --- | --- | --- |
| 1 | `c1cf217`, `2a62a0a`, `fa1ede4`, `1ea95a7`, `2319e46` | Strict catalog and registry protocol implemented and hardened. |
| 2 | `f209ede` | DingTalk is represented by JSON metadata and installed on demand; old bundled resources removed. |
| 3 | `dcd019d` | Private connector paths and atomic lifecycle state implemented. |
| 4 | `af04387` | Bundled npm@11.7.0 dependency, managed runtime resolution, and shell-free process runner implemented. |
| 5 | `3f7e136` | On-demand install driver and safe Skill extraction implemented. |
| 6 | `169e313` | Authorization, lifecycle orchestration, in-process/file locks, and startup recovery implemented. |
| 7 | `f56858b` | Schema-bound CLI execution gateway, confirmation replay, error mapping, and artifact refs implemented. |
| 8 | `e23fd93` | Connector-child category, gateway-only tool pack, connector identity in the runtime-profile hash, and isolation prompt implemented. |
| 9 | `580fdef`, `6be01b9` | Persistent `(parent, connector)` hidden children, reuse with version-based invalidation, delegate tools refreshed per turn, and child cleanup on parent deletion. `6be01b9` adds the delegate-tool wiring in `src/agent/tools/index.ts` omitted from the first commit. `runtime-profile.ts` was intentionally not modified: Task 8 already includes connector identity in the runtime-profile hash and `activeToolNames` already captures delegate tools. |
| 10 | `19e666e` | `src/domains/connector/node/service.ts` exposes catalog metadata + lifecycle state DTOs; `application.electron.ts` holds the lazy HTTP/IPC-shared singleton (per-entry driver map, managed runtime, `electronShell.openExternal`), `/api/connectors` route blocks, and a `ConnectorError` branch in the handleApi catch. IPC handlers `connector.list/get/activate/cancel/reauthorize/logout/repair/update/uninstall` proxy through handleApi; `client.ts` IPC_ROUTES + route assertions added. `preload.cjs` needed no change — its `call` forwarder is generic. `state_store.ts` fix: `store.write` rejected `catalogVersion: ""`, which made `lifecycle.uninstall` throw `CONNECTOR_BROKEN`; the store now accepts empty `catalogVersion` for the `not_installed` state so uninstall round-trips. Test adaptation: the "HTTP and IPC return the same DTO" sketch is asserted at the shared serialization boundary (`decodeApiResponse` vs `Response` JSON) since both transports converge on the single handleApi. |
| 11 | `d0a30e3` | `frontend/src/components/connectorModel.ts` + tests implement the plan's renderer-model sketch: `actionsFor` (busy→cancel, not_installed→activate, failure→repair+uninstall, installed→update/reauthorize/logout/uninstall by state+version) and `viewFor` (labels, busy, cancellable, `auth_expired` primary action "reauthorize"). Service DTO gained `installedCatalogVersion` (from state record; `""` = not installed) so the renderer can detect update-needed. `useSkillStore.ts` gained a connector slice (`loadConnectors` + 7 ops via IPC routes, errors rethrown for UI alerts); `installPresetMcp` deleted (no other callers). `ExpertPanel.tsx` deleted `PRESET_CONNECTORS`/`PresetConnector`/`isMcpInstalled`/`isMcpConnected`/`handleToggleMcpInstall`; cards render catalog icon/name/description with backend state authoritative, "＋" shows the plan's install-progress message and calls `activate` with duplicate-click suppression (local `runningConnectorOps`), 1.5s polling while any card is busy, retry on failure states, cancel while busy, logout/uninstall behind `requestUiConfirm`, MCP modal and "服务配置" button kept as the independent MCP-management feature. `ComposerPlusMenu.tsx` loads connectors in its data bootstrap. Deviation: the catalog has no `examples` field (type and JSON both lack it), so there is nothing to preserve; the renderer model types its own DTO instead of importing the main-process type, keeping the renderer/main-process type boundary intact. |
| 12 | `500cce1` | Packaging now ships exactly the two catalog JSONs and excludes `resources/builtin-connectors/<connector-id>/` vendor directories even if one exists locally (`electron-builder.yml` `!resources/builtin-connectors/*/**`; `git ls-files` confirms `dingtalk/` was never tracked). `src/agent/startup.ts` gained the `initializeConnectors` phase (skills → models → connectors → startService); the `connectorsReady` hook runs `recoverStartup()` (stale lock + staging cleanup only — no network, install, Skill extraction, package script, authorization, or delegate registration for non-ready connectors). `test/src/domains/connector/node/packaging.test.ts` (fixture + real repo root + builder glob) and `e2e.test.ts` (fake driver/runProcess; asserts zero network and no installed Skill before `activate`, tarball URL + Skill text + `ready` state after) implement the plan's sketches. Deviations: the plan's file list omitted the required glue — `src/domains/connector/node/service.ts` (`recoverStartup` pass-through on the service) and `application.electron.ts` (connector singleton block moved above `initDb()` so the eager `connectorService()` in `connectorsReady` avoids a module-evaluation TDZ) — both included in this commit. Plan Step 4's `npx tsx --test …` and `npm run test:backend` suites were not run per the user's verification policy (syntax/type checks only); the policy-respecting subset ran clean. |

---

## File map

- `resources/builtin-connectors/connector-catalog.json`: the only vendor-specific built-in connector configuration.
- `resources/builtin-connectors/connector-runtime-lock.json`: exact Node/npm runtime roots only.
- `src/domains/connector/node/catalog.ts`: strict catalog parsing, URL/SRI/path validation, and deep freeze.
- `src/domains/connector/node/registry.ts`: immutable catalog lookup with no network or package reads.
- `src/domains/connector/node/paths.ts`: private runtime, staging, version, cache, log, and lock paths.
- `src/domains/connector/node/state_store.ts`: atomic lifecycle state persistence.
- `src/domains/connector/node/process_runner.ts`: shell-free bounded child processes.
- `src/domains/connector/node/skill_extractor.ts`: safe extraction of the declared ZIP from a verified package.
- `src/domains/connector/node/node_npm_driver.ts`: lock materialization, `npm ci --ignore-scripts`, explicit root post-install, package verification, Skill extraction, and atomic activation.
- `src/domains/connector/node/authorization.ts`: allowed-domain authorization and independent status verification.
- `src/domains/connector/node/lifecycle.ts`: operation lock, cancellation, rollback, repair, update, logout, and uninstall.
- `src/domains/connector/node/command_policy.ts` and `command_gateway.ts`: connector-bound command validation, risk, errors, artifacts, and confirmation.
- `src/domains/connector/node/agent_session_store.ts` and `agent_manager.ts`: persistent hidden connector children.
- `src/domains/connector/node/service.ts`: shared HTTP/IPC application facade.
- `frontend/src/components/connectorModel.ts`: renderer DTO and state/action mapping.

---

### Task 1: Replace package discovery with a strict lightweight catalog

**Files:**
- Modify: `src/domains/connector/node/types.ts`
- Modify: `src/domains/connector/node/errors.ts`
- Create: `src/domains/connector/node/catalog.ts`
- Delete: `src/domains/connector/node/manifest.ts`
- Modify: `src/domains/connector/node/registry.ts`
- Create: `test/src/domains/connector/node/catalog.test.ts`
- Modify: `test/src/domains/connector/node/registry.test.ts`
- Delete: `test/src/domains/connector/node/manifest.test.ts`

- [ ] **Step 1: Write failing catalog tests**

```ts
test("loads a frozen catalog without touching package resources", async () => {
  const catalog = await loadConnectorCatalog(fixturePath("valid.json"));
  assert.equal(catalog.connectors[0]?.id, "dingtalk");
  assert.equal(catalog.connectors[0]?.install.package, "dingtalk-workspace-cli");
  assert.equal(Object.isFrozen(catalog.connectors[0]?.install), true);
});

test("rejects unsafe catalog entries", async () => {
  for (const name of ["unknown-field", "duplicate-id", "version-range", "http-tarball", "foreign-registry", "escaped-skill", "missing-integrity"]) {
    await assert.rejects(loadConnectorCatalog(fixturePath(`${name}.json`)), hasCode("CONNECTOR_CATALOG_INVALID"));
  }
});
```

- [ ] **Step 2: Run RED**

Run: `npx tsx --test test/src/domains/connector/node/catalog.test.ts test/src/domains/connector/node/registry.test.ts`

Expected: FAIL because `loadConnectorCatalog` does not exist and Registry still scans package directories.

- [ ] **Step 3: Define closed readonly types**

```ts
export interface ConnectorLockedPackage {
  readonly resolved: string;
  readonly integrity: string;
}

export interface ConnectorCatalogEntry {
  readonly id: string;
  readonly version: string;
  readonly displayName: string;
  readonly description: string;
  readonly presentation: { readonly icon: string };
  readonly delegate: { readonly toolName: string; readonly description: string };
  readonly runtime: { readonly type: "node-npm"; readonly version: "22.22.2" };
  readonly install: {
    readonly package: string;
    readonly version: string;
    readonly registry: "https://registry.npmjs.org";
    readonly tarball: string;
    readonly integrity: string;
    readonly postInstall?: { readonly path: string; readonly argv: readonly string[] };
  };
  readonly skill: { readonly source: "package-archive"; readonly archive: string; readonly entry: string };
  readonly executable: Partial<Readonly<Record<"darwin" | "linux" | "win32", string>>>;
  readonly versionCheck: { readonly argv: readonly string[]; readonly outputPattern: string };
  readonly auth: { readonly argv: readonly string[]; readonly allowedDomains: readonly string[]; readonly waitForExit: true };
  readonly status: { readonly argv: readonly string[]; readonly format: "json"; readonly jsonMatch: Readonly<Record<string, unknown>> };
  readonly logout: { readonly argv: readonly string[] };
  readonly commandPolicy: { readonly schema: { readonly argv: readonly string[] } };
  readonly errors: Readonly<Record<string, readonly string[] | string>>;
  readonly packages: Readonly<Record<string, ConnectorLockedPackage>>;
}
```

Add `CONNECTOR_CATALOG_INVALID`, `PACKAGE_INTEGRITY_INVALID`, and `SKILL_ARCHIVE_INVALID` to the stable error union and HTTP mapping.

- [ ] **Step 4: Implement bounded parsing and Registry lookup**

`loadConnectorCatalog(path)` must use the existing descriptor-safe read pattern, cap JSON at 1 MiB and 128 entries, reject unknown fields recursively, reject duplicate IDs, and deep-freeze its result. Enforce exact semver, canonical SHA-512 SRI round-trip, HTTPS `registry.npmjs.org` URLs, canonical npm coordinate keys, complete `{resolved, integrity}` package entries, bounded argv/regex/string counts, and safe relative Skill paths. Require the root package coordinate to equal `install.package@install.version` and its SRI/URL to equal `install.integrity`/`install.tarball`.

`createConnectorRegistry(root)` must read exactly `connector-catalog.json` plus `connector-runtime-lock.json`, preserve the hardened bounded runtime-lock read, and return immutable `list()`/`get(id)` values. It must not enumerate child directories, call `fetch`, run npm, or read Skill files.

- [ ] **Step 5: Run GREEN and commit**

Run: `npx tsx --test test/src/domains/connector/node/catalog.test.ts test/src/domains/connector/node/registry.test.ts`

Expected: PASS.

```bash
git add src/domains/connector/node/types.ts src/domains/connector/node/errors.ts src/domains/connector/node/catalog.ts src/domains/connector/node/registry.ts test/src/domains/connector/node/catalog.test.ts test/src/domains/connector/node/registry.test.ts
git add -u src/domains/connector/node/manifest.ts test/src/domains/connector/node/manifest.test.ts
git commit -m "refactor: load connectors from catalog json"
```

### Task 2: Replace the bundled DingTalk tree with one catalog entry

**Files:**
- Create: `resources/builtin-connectors/connector-catalog.json`
- Modify: `resources/builtin-connectors/connector-runtime-lock.json`
- Delete: `resources/builtin-connectors/dingtalk/**`
- Create: `test/src/domains/connector/node/dingtalk_catalog.test.ts`
- Delete: `test/src/domains/connector/node/dingtalk_package.test.ts`

- [ ] **Step 1: Write the failing resource-boundary test**

```ts
test("DingTalk is catalog-only before explicit installation", async () => {
  const registry = await createConnectorRegistry(CONNECTORS_ROOT);
  const dingtalk = registry.get("dingtalk");
  assert.equal(dingtalk?.install.package, "dingtalk-workspace-cli");
  assert.equal(dingtalk?.install.version, "1.0.59");
  assert.equal(dingtalk?.install.integrity, DINGTALK_SRI);
  assert.deepEqual(dingtalk?.skill, {
    source: "package-archive",
    archive: "assets/dws-skills.zip",
    entry: "SKILL.md",
  });
  await assert.rejects(access(join(CONNECTORS_ROOT, "dingtalk")), { code: "ENOENT" });
});
```

Also assert exact auth/status/logout/schema argv, `login.dingtalk.com`, `delegate_to_dingtalk`, `/logos/dingtalk.png`, error mappings, and zero calls through an injected download sentinel during catalog load.

- [ ] **Step 2: Run RED**

Run: `npx tsx --test test/src/domains/connector/node/dingtalk_catalog.test.ts`

Expected: FAIL because `connector-catalog.json` is absent and the old DingTalk tree exists.

- [ ] **Step 3: Create the exact catalog entry**

Use:

```ts
const DINGTALK_TARBALL = "https://registry.npmjs.org/dingtalk-workspace-cli/-/dingtalk-workspace-cli-1.0.59.tgz";
const DINGTALK_SRI = "sha512-f/dqjtpeUF9lz/uunqkgLerB1YoiXBVeM69QocjlFQeNhBYDdWI2isCRG6lzfilSVGDfm5Xp5IZvcrrsweUM3g==";
```

The JSON entry must use connector version `1.0.0`, runtime `22.22.2`, post-install `{ "path": "install.js", "argv": [] }`, version pattern `^dws version v1\\.0\\.59\\b`, `auth login -y --no-browser`, `auth status`, `auth reset`, and `schema --compact --format json`. Its only package graph entry is `dingtalk-workspace-cli@1.0.59` with `resolved` equal to the tarball above and the same SRI. Inline bounded mappings for `AUTH_REQUIRED`, `AUTH_FAILED`, `CONNECTOR_TIMEOUT`, `NETWORK_ERROR`, and default `CONNECTOR_BROKEN`.

Remove connector packages from `connector-runtime-lock.json`; it retains only Node `22.22.2` and npm `11.7.0` integrity roots.

- [ ] **Step 4: Delete every bundled DingTalk vendor file**

Delete the tracked `resources/builtin-connectors/dingtalk/` tree and old package test. Do not move Skill, references, scripts, LICENSE, NOTICE, npm lock, install script, or connector icon elsewhere under built-in connector resources. Keep `frontend/public/logos/dingtalk.png` solely as the renderer presentation asset.

- [ ] **Step 5: Verify and commit**

Run:

```bash
npx tsx --test test/src/domains/connector/node/catalog.test.ts test/src/domains/connector/node/registry.test.ts test/src/domains/connector/node/dingtalk_catalog.test.ts
git ls-files resources/builtin-connectors
```

Expected: tests PASS; Git lists only `connector-catalog.json` and `connector-runtime-lock.json` under `resources/builtin-connectors`.

```bash
git add resources/builtin-connectors test/src/domains/connector/node/dingtalk_catalog.test.ts
git add -u test/src/domains/connector/node/dingtalk_package.test.ts
git commit -m "refactor: make DingTalk an on-demand catalog entry"
```

### Task 3: Implement private paths and atomic connector state

**Files:**
- Create: `src/domains/connector/node/paths.ts`
- Create: `src/domains/connector/node/state_store.ts`
- Create: `test/src/domains/connector/node/state_store.test.ts`
- Modify: `src/platform/paths.ts`

- [ ] **Step 1: Write failing containment and atomicity tests**

```ts
test("connector paths stay under appData and reject hostile ids", () => {
  const paths = connectorPaths("/tmp/pi-a", "dingtalk", "1.0.59");
  assert.equal(paths.current, "/tmp/pi-a/connectors/packages/dingtalk/current");
  assert.throws(() => connectorPaths("/tmp/pi-a", "../escape", "1.0.59"), /invalid connector id/);
});

test("failed atomic writes preserve the last valid state", async () => {
  await store.write(readyState);
  await assert.rejects(store.write(nextState, { failBeforeRename: true }));
  assert.deepEqual(await store.read("dingtalk"), readyState);
});
```

- [ ] **Step 2: Run RED**

Run: `npx tsx --test test/src/domains/connector/node/state_store.test.ts`

Expected: FAIL because connector paths and state store do not exist.

- [ ] **Step 3: Implement focused path and state modules**

```ts
export interface ConnectorPaths {
  root: string;
  packageRoot: string;
  versions: string;
  staging: string;
  current: string;
  cache: string;
  logs: string;
  lock: string;
}

export interface ConnectorStateRecord {
  connectorId: string;
  state: ConnectorLifecycleState;
  catalogVersion: string;
  cliVersion?: string;
  operationId?: string;
  updatedAt: string;
  error?: { code: ConnectorErrorCode; message: string; retryable: boolean };
}
```

Resolve all paths from `platformPaths.appDataDir`; reject symlinks and non-contained deletion targets. State writes use a same-directory temporary file, fsync, rename, and parent-directory fsync. Reads enforce a 256 KiB limit and return `not_installed` only for an absent file, not malformed JSON.

- [ ] **Step 4: Run GREEN and commit**

Run: `npx tsx --test test/src/domains/connector/node/state_store.test.ts`

```bash
git add src/platform/paths.ts src/domains/connector/node/paths.ts src/domains/connector/node/state_store.ts test/src/domains/connector/node/state_store.test.ts
git commit -m "feat: persist atomic connector lifecycle state"
```

### Task 4: Package the managed runtime and add shell-free process execution

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Modify: `src/platform/cli/runtime.ts`
- Create: `src/domains/connector/node/process_runner.ts`
- Create: `test/src/domains/connector/node/process_runner.test.ts`
- Modify: `test/src/platform/cli/runtime.test.ts`

- [ ] **Step 1: Write failing process tests**

```ts
test("runs argv without a shell and bounds output", async () => {
  const result = await runConnectorProcess({ executable: process.execPath, argv: [fixture], timeoutMs: 2_000 });
  assert.equal(result.command.shell, false);
  assert.equal(result.stdout, "ok\n");
  await assert.rejects(runConnectorProcess({ executable: process.execPath, argv: [flood], maxOutputBytes: 1024 }), hasCode("OUTPUT_TOO_LARGE"));
});

test("abort terminates the process tree", async () => {
  const controller = new AbortController();
  const pending = runConnectorProcess({ executable: process.execPath, argv: [hanging], signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, hasCode("CONNECTOR_CANCELLED"));
});
```

- [ ] **Step 2: Run RED**

Run: `npx tsx --test test/src/domains/connector/node/process_runner.test.ts test/src/platform/cli/runtime.test.ts`

- [ ] **Step 3: Implement and bind the managed runtime**

Use `spawn(executable, argv, { shell: false, windowsHide: true, env: minimalEnv })`; bound stdout/stderr independently, enforce timeout, stream authorization lines, and terminate the process tree on cancellation. Resolve packaged Node `22.22.2` and npm `11.7.0` by platform/architecture from the runtime lock; never fall back to system Node/npm. Preserve existing Python/runtime consumers.

- [ ] **Step 4: Run GREEN and commit**

Run: `npx tsx --test test/src/domains/connector/node/process_runner.test.ts test/src/platform/cli/runtime.test.ts`

```bash
git add package.json package-lock.json src/platform/cli/runtime.ts src/domains/connector/node/process_runner.ts test/src/domains/connector/node/process_runner.test.ts test/src/platform/cli/runtime.test.ts
git commit -m "feat: add managed connector process runtime"
```

### Task 5: Install the locked official CLI and extract its Skill on demand

**Files:**
- Create: `src/domains/connector/node/skill_extractor.ts`
- Create: `src/domains/connector/node/node_npm_driver.ts`
- Create: `test/src/domains/connector/node/skill_extractor.test.ts`
- Create: `test/src/domains/connector/node/node_npm_driver.test.ts`

- [ ] **Step 1: Write failing install and extraction tests**

```ts
test("activation installs only after an explicit call", async () => {
  const driver = createDriver({ runProcess: fakeNpm, paths });
  assert.equal(fakeNpm.calls.length, 0);
  await driver.install(catalogEntry, operation);
  assert.deepEqual(fakeNpm.calls[0]?.argv, ["ci", "--ignore-scripts", "--no-audit", "--no-fund"]);
});

test("extracts only the declared Skill archive after package verification", async () => {
  const result = await extractConnectorSkill({ packageRoot, archive: "assets/dws-skills.zip", entry: "SKILL.md", destination });
  assert.equal(result.entryPath, join(destination, "SKILL.md"));
  assert.equal(result.fileCount, 599);
});

test("rejects ZIP traversal, duplicate paths, symlinks, depth, count, and inflated-byte overflow", async () => {
  for (const fixture of unsafeZipFixtures) {
    await assert.rejects(extractConnectorSkill(fixture), hasCode("SKILL_ARCHIVE_INVALID"));
  }
});
```

- [ ] **Step 2: Run RED**

Run: `npx tsx --test test/src/domains/connector/node/skill_extractor.test.ts test/src/domains/connector/node/node_npm_driver.test.ts`

- [ ] **Step 3: Materialize the complete npm lock**

Generate staging `package.json` with the exact root dependency and `package-lock.json` from the catalog `packages` map. Every non-root lock entry must include exact version, `resolved`, and integrity; reject any npm output that adds or changes a package coordinate. Invoke managed npm with the fixed registry and `--ignore-scripts`; never build a Shell command.

```ts
await runProcess({
  executable: runtime.npm,
  argv: ["ci", "--ignore-scripts", "--no-audit", "--no-fund"],
  cwd: staging,
  env: { npm_config_registry: entry.install.registry },
  signal,
});
```

- [ ] **Step 4: Verify package identity and run only the audited root script**

After npm succeeds, safely read the installed root `package.json`; require exact name/version/bin. Resolve `postInstall.path` as an ordinary contained file in the verified root package, then execute it with managed Node and declared argv. Dependency lifecycle scripts remain disabled. Run the catalog version check and reject mismatches before activation.

- [ ] **Step 5: Extract the Skill and atomically activate**

Use PizZip only after root package verification. Reject absolute/backslash/drive/`..` paths, directories deeper than 16, more than 1024 files, any file over 8 MiB, total inflated bytes over 64 MiB, duplicate normalized paths, and non-file entries. Write files with exclusive creation beneath staging, require the declared entry, validate its frontmatter, then write metadata with catalog version, CLI version, package graph digest, Skill digest, and install time. Rename staging to the version directory and atomically switch `current`; on failure remove only the resolved staging directory and keep the old current.

- [ ] **Step 6: Run GREEN and commit**

Run: `npx tsx --test test/src/domains/connector/node/skill_extractor.test.ts test/src/domains/connector/node/node_npm_driver.test.ts`

```bash
git add src/domains/connector/node/skill_extractor.ts src/domains/connector/node/node_npm_driver.ts test/src/domains/connector/node/skill_extractor.test.ts test/src/domains/connector/node/node_npm_driver.test.ts
git commit -m "feat: install connector cli and skill on demand"
```

### Task 6: Implement authorization and lifecycle orchestration

**Files:**
- Create: `src/domains/connector/node/authorization.ts`
- Create: `src/domains/connector/node/lifecycle.ts`
- Create: `test/src/domains/connector/node/authorization.test.ts`
- Create: `test/src/domains/connector/node/lifecycle.test.ts`

- [ ] **Step 1: Write failing state-machine tests**

```ts
test("activate installs, authorizes, then independently verifies status", async () => {
  await lifecycle.activate("dingtalk");
  assert.deepEqual(phases, ["installing", "installed_unauthorized", "authorizing", "ready"]);
});

test("offline install failure leaves no current or authorization window", async () => {
  driver.install.rejects(new ConnectorError("NETWORK_ERROR", "offline", true));
  await assert.rejects(lifecycle.activate("dingtalk"), hasCode("NETWORK_ERROR"));
  assert.equal(await currentExists(), false);
  assert.equal(openExternal.calls.length, 0);
});
```

- [ ] **Step 2: Run RED**

Run: `npx tsx --test test/src/domains/connector/node/authorization.test.ts test/src/domains/connector/node/lifecycle.test.ts`

- [ ] **Step 3: Implement authorization boundaries**

Parse candidate URLs from bounded line callbacks, accept only HTTPS and exact/subdomain matches of `allowedDomains`, open at most one URL per operation, wait for auth exit, and run status separately. Auth exit zero without matching status is `AUTH_FAILED`. Never read or persist tokens, cookies, authorization codes, or full command output.

- [ ] **Step 4: Implement lifecycle locking and recovery**

Use an in-process operation map plus `<connectors>/locks/<id>.lock`. `activate` installs only after an explicit user action and then authorizes; `reauthorize` keeps the CLI; `logout` clears authorization and connector children; `uninstall` removes only validated connector package/cache paths. Cancellation terminates process trees and removes staging. Startup recovery clears stale staging/locks but never downloads, installs, opens a browser, or authorizes.

- [ ] **Step 5: Run GREEN and commit**

Run: `npx tsx --test test/src/domains/connector/node/authorization.test.ts test/src/domains/connector/node/lifecycle.test.ts`

```bash
git add src/domains/connector/node/authorization.ts src/domains/connector/node/lifecycle.ts test/src/domains/connector/node/authorization.test.ts test/src/domains/connector/node/lifecycle.test.ts
git commit -m "feat: manage connector lifecycle and authorization"
```

### Task 7: Implement schema-bound CLI execution and permissions

**Files:**
- Create: `src/domains/connector/node/command_policy.ts`
- Create: `src/domains/connector/node/command_gateway.ts`
- Create: `src/agent/tools/connector_cli_execute.ts`
- Create: `test/src/domains/connector/node/command_gateway.test.ts`
- Modify: `src/infra/context.ts`
- Modify: `src/agent/permissions.ts`

- [ ] **Step 1: Write failing gateway tests**

```ts
test("binds execution to the active child connector", async () => {
  await assert.rejects(gateway.execute({ connectorId: "wecom", argv: ["contacts", "list"] }, dingtalkContext), hasCode("COMMAND_NOT_ALLOWED"));
});

test("high-risk commands require exact replay after confirmation", async () => {
  const first = await gateway.execute(deleteCommand, dingtalkContext);
  assert.equal(first.code, "CONFIRMATION_REQUIRED");
  assert.equal(runner.calls.length, 0);
  await gateway.execute({ ...deleteCommand, confirmationId: first.confirmationId }, dingtalkContext);
  assert.equal(runner.calls.length, 1);
});
```

- [ ] **Step 2: Run RED**

Run: `npx tsx --test test/src/domains/connector/node/command_gateway.test.ts`

- [ ] **Step 3: Implement policy and tool**

Discover schema using only catalog `commandPolicy.schema.argv`; cache by connector ID, CLI version, and schema digest. Reject executable overrides, Shell metacharacter interpretation, schema-unknown commands, mismatched connector IDs, and expired confirmations. Map catalog error patterns to stable codes using bounded regex evaluation; unknown non-zero exits become `CONNECTOR_BROKEN`. Convert large successful output to the artifact store and return a compact reference.

Register `connector_cli_execute` only for connector child contexts. Main, ordinary expert, and skill sessions must never receive it.

- [ ] **Step 4: Run GREEN and commit**

Run: `npx tsx --test test/src/domains/connector/node/command_gateway.test.ts`

```bash
git add src/domains/connector/node/command_policy.ts src/domains/connector/node/command_gateway.ts src/agent/tools/connector_cli_execute.ts test/src/domains/connector/node/command_gateway.test.ts src/infra/context.ts src/agent/permissions.ts
git commit -m "feat: enforce connector command policy"
```

### Task 8: Add connector-child prompt and tool isolation

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

- [ ] **Step 1: Write the failing isolation test**

```ts
test("connector child receives only its extracted Skill and CLI gateway", async () => {
  const profile = await buildRuntimeProfile(connectorChildIntent);
  assert.deepEqual(profile.resources.skills?.map((skill) => skill.name), ["dws"]);
  assert.deepEqual(profile.tools.map((tool) => tool.name), ["connector_cli_execute"]);
  assert.doesNotMatch(profile.systemPrompt, /expert-manager|shell|delegate_to_/);
});
```

- [ ] **Step 2: Run RED**

Run: `npx tsx --test test/src/agent/prompt-runtime/connector-agent.test.ts`

- [ ] **Step 3: Implement the connector-child category**

Add structural intent `{ category: "connector-agent", connectorId, installedVersionRoot }`. The category prompt must instruct the child to use its Skill progressively, invoke only the gateway, return concise structured results, and never request arbitrary Shell or another connector. Load `SKILL.md` only from the validated installed version's `skill/` directory; do not load global user/built-in Skills. Include connector ID, catalog version, CLI version, and Skill digest in the runtime-profile hash.

- [ ] **Step 4: Run GREEN and commit**

Run: `npx tsx --test test/src/agent/prompt-runtime/connector-agent.test.ts`

```bash
git add resources/prompts/v2/categories/connector-agent.md src/agent/prompt-runtime src/agent/tools/index.ts test/src/agent/prompt-runtime/connector-agent.test.ts
git commit -m "feat: isolate connector child runtime"
```

### Task 9: Add persistent hidden connector children and autonomous delegation

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

- [ ] **Step 1: Write failing persistence tests**

```ts
test("reuses one hidden child per parent and connector", async () => {
  const first = await manager.delegate(parentId, "dingtalk", taskA);
  const second = await manager.delegate(parentId, "dingtalk", taskB);
  assert.equal(first.childConversationId, second.childConversationId);
  assert.equal(sessionList().some((item) => item.id === first.childConversationId), false);
});

test("only ready connectors expose main-agent delegate tools", async () => {
  assert.deepEqual(await toolNames(notInstalledMain), []);
  assert.deepEqual(await toolNames(readyMain), ["delegate_to_dingtalk"]);
});
```

- [ ] **Step 2: Run RED**

Run: `npx tsx --test test/src/domains/connector/node/agent_manager.test.ts test/src/agent/prompt-runtime/connector-delegation.test.ts`

- [ ] **Step 3: Implement association and delegation**

Create a unique `(parent_conversation_id, connector_id)` table that references a hidden child conversation. Serialize first creation, reuse it across parent turns, and pass only task text, minimal parent summary, and explicit attachment references. The delegate tool description comes from the catalog; its invocation does not embed the Skill or CLI schema in the main prompt. New task, parent deletion, logout, uninstall, catalog-version invalidation, or installed-version replacement destroys the child association safely.

- [ ] **Step 4: Run GREEN and commit**

Run: `npx tsx --test test/src/domains/connector/node/agent_manager.test.ts test/src/agent/prompt-runtime/connector-delegation.test.ts`

```bash
git add src/infra/db.ts src/domains/session/node/store.ts src/domains/connector/node/agent_session_store.ts src/domains/connector/node/agent_manager.ts src/agent/tools/connector_delegate.ts src/agent/provider.ts src/agent/prompt-runtime/runtime-profile.ts src/agent/prompt-runtime/tool-policy.ts src/agent/session_cleanup.ts test/src/domains/connector/node/agent_manager.test.ts test/src/agent/prompt-runtime/connector-delegation.test.ts
git commit -m "feat: delegate to persistent connector children"
```

### Task 10: Expose one connector service through HTTP and IPC

**Files:**
- Create: `src/domains/connector/node/service.ts`
- Modify: `application.electron.ts`
- Modify: `src/electron/ipc-handlers.ts`
- Modify: `src/electron/preload.cjs`
- Modify: `frontend/src/api/client.ts`
- Modify: `frontend/src/api/client.test.ts`
- Create: `test/src/domains/connector/node/service.test.ts`

- [x] **Step 1: Write failing service tests**

```ts
test("catalog list is side-effect free and activation is explicit", async () => {
  const listed = await service.list();
  assert.equal(listed[0]?.state, "not_installed");
  assert.equal(driver.install.calls.length, 0);
  await service.activate("dingtalk");
  assert.equal(driver.install.calls.length, 1);
});

test("HTTP and IPC return the same DTO", async () => {
  assert.deepEqual(await ipc.invoke("connector.list"), await http.get("/api/connectors"));
});
```

- [x] **Step 2: Run RED**

Run: `npx tsx --test test/src/domains/connector/node/service.test.ts frontend/src/api/client.test.ts`

Verification policy applied: tests written but not executed; type-checked standalone and via `tsconfig.electron.json` (clean).

- [x] **Step 3: Implement synchronized routes**

Expose `list`, `get`, `activate`, `cancel`, `reauthorize`, `logout`, `repair`, `update`, and `uninstall`. Both transports call the same singleton service and return catalog metadata plus real lifecycle state; neither accepts package coordinates, URLs, argv, executable paths, Skill paths, or authorization domains from the renderer. The IPC handlers are one-line proxies to `/api/connectors`, so both transports converge on the single handleApi → single service singleton; the only renderer-supplied value is the connector ID (an exact-match catalog key).

- [x] **Step 4: Run GREEN and commit**

Run: `npx tsx --test test/src/domains/connector/node/service.test.ts frontend/src/api/client.test.ts`

Verified via `npx tsc --project tsconfig.electron.json --noEmit`, standalone tsc on both new test files, esbuild syntax check on `application.electron.ts`, a runtime probe of the service singleton, and `git diff --check`; committed as `19e666e`. `preload.cjs` required no modification: its `call` forwarder is a generic `ipcRenderer.invoke(name, ...args)` that already covers the new `connector.*` handlers.

```bash
git add src/domains/connector/node/service.ts application.electron.ts src/electron/ipc-handlers.ts src/electron/preload.cjs frontend/src/api/client.ts frontend/src/api/client.test.ts test/src/domains/connector/node/service.test.ts
git commit -m "feat: expose managed connector service"
```

### Task 11: Replace static connector cards with catalog and lifecycle state

**Files:**
- Create: `frontend/src/components/connectorModel.ts`
- Create: `frontend/src/components/connectorModel.test.ts`
- Modify: `frontend/src/store/useSkillStore.ts`
- Modify: `frontend/src/components/ExpertPanel.tsx`
- Modify: `frontend/src/components/ExpertPanel.css`

- [x] **Step 1: Write failing renderer-model tests**

```ts
test("uninstalled catalog entries expose only the plus action", () => {
  assert.deepEqual(actionsFor(connector("not_installed")), ["activate"]);
});

test("installing and authorization states map to visible progress", () => {
  assert.equal(viewFor(connector("installing")).label, "正在安装连接器依赖");
  assert.equal(viewFor(connector("authorizing")).label, "等待授权完成");
  assert.equal(viewFor(connector("auth_expired")).primaryAction, "reauthorize");
});
```

- [x] **Step 2: Run RED**

Run: `npx tsx --test frontend/src/components/connectorModel.test.ts`

- [x] **Step 3: Implement catalog-driven interaction**

Delete `PRESET_CONNECTORS` as an authority. Load cards from `connector.list`; preserve the catalog icon, name, description, and examples while treating backend state as authoritative. Clicking “＋” shows “首次使用或更新需要安装连接器依赖，正在安装中，请稍后”, calls `activate`, disables duplicate clicks, and transitions automatically to authorization. Show retry for network/integrity/install failures, cancel only while supported, and management actions only for installed states. Never request Client ID, Agent Code, package URL, CLI command, or Skill path.

- [x] **Step 4: Run GREEN and commit**

Run: `npx tsx --test frontend/src/components/connectorModel.test.ts frontend/src/api/client.test.ts`

```bash
git add frontend/src/components/connectorModel.ts frontend/src/components/connectorModel.test.ts frontend/src/store/useSkillStore.ts frontend/src/components/ExpertPanel.tsx frontend/src/components/ExpertPanel.css
git commit -m "feat: drive connector cards from managed catalog"
```

### Task 12: Package only the catalog and verify the full on-demand flow

**Files:**
- Modify: `electron-builder.yml`
- Modify: `src/agent/startup.ts`
- Create: `test/src/domains/connector/node/packaging.test.ts`
- Create: `test/src/domains/connector/node/e2e.test.ts`
- Modify: `docs/superpowers/specs/2026-08-25-managed-cli-connector-framework-design.md`

- [x] **Step 1: Write failing packaged-resource and E2E tests**

```ts
test("packaged connector resources contain no vendor tree", async () => {
  assert.deepEqual(await listBuiltInConnectorFiles(packagedResources), [
    "connector-catalog.json",
    "connector-runtime-lock.json",
  ]);
});

test("DingTalk downloads and extracts only after activate", async () => {
  await app.start();
  assert.equal(network.calls.length, 0);
  assert.equal(await exists(installedSkill), false);
  await app.connectors.activate("dingtalk");
  assert.equal(network.calls[0]?.url, DINGTALK_TARBALL);
  assert.equal(await readFile(installedSkill, "utf8").then((text) => text.includes("name: dws")), true);
  assert.equal((await app.connectors.get("dingtalk")).state, "ready");
});
```

- [x] **Step 2: Run RED**

Run: `npx tsx --test test/src/domains/connector/node/packaging.test.ts test/src/domains/connector/node/e2e.test.ts`

- [x] **Step 3: Update packaging and startup recovery**

Package exactly the catalog JSON, runtime lock, managed Node/npm artifacts, and connector-child prompt. Exclude `resources/builtin-connectors/<connector-id>/` vendor directories even if a developer creates one locally. Startup validates catalog/runtime and recovers stale locks/staging only; it must not contact npm, install, extract Skill, execute a package script, open authorization, or register a delegate for a non-ready connector.

- [x] **Step 4: Run the complete verification matrix**

Run:

```bash
npx tsx --test test/src/domains/connector/node/*.test.ts test/src/agent/prompt-runtime/connector-*.test.ts frontend/src/components/connectorModel.test.ts frontend/src/api/client.test.ts
npx tsc --project tsconfig.electron.json --noEmit
npm run test:backend
git diff --check
```

Expected: connector suites and TypeScript PASS; backend suite has no new failures relative to the recorded baseline; diff check is clean.

- [x] **Step 5: Record the delivered behavior and commit**

Update the design document's implementation status with exact commands and results. Confirm:

- loading the catalog is offline and side-effect free;
- `resources/builtin-connectors/dingtalk/` is absent from `git ls-files` and packaged output;
- install uses exact package graph and SHA-512 integrity;
- Skill exists only under the installed connector version after activation;
- install/extraction failure leaves no half-current version;
- another standard Node/npm connector requires only a validated JSON entry.

```bash
git add electron-builder.yml src/agent/startup.ts test/src/domains/connector/node/packaging.test.ts test/src/domains/connector/node/e2e.test.ts docs/superpowers/specs/2026-08-25-managed-cli-connector-framework-design.md
git commit -m "test: verify on-demand connector lifecycle"
```

---

## Execution gates

- Use TDD for every task: observe the intended RED before implementation.
- After every implementation task, run a fresh spec-compliance review, then a code-quality review; resolve all Critical/Important findings before the next task.
- Preserve unrelated worktree changes and use exact pathspec staging.
- Do not add a compatibility fallback that loads the deleted per-connector built-in tree.
- Do not broaden the catalog into a remote marketplace in this plan.
