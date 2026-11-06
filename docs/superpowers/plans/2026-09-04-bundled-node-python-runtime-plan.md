# Bundled Node and Python Runtime Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make internal scripts and Agent shells use Electron’s embedded Node/npm and a platform-matched Python runtime without depending on system installations.

**Architecture:** Add a small `src/platform/runtime` service that validates a packaged manifest, installs a bundled Python archive into `platformPaths.appDataDir`, and constructs child/shell environments. Migrate expert-draft and plugin npm call sites to this service; inject the environment into macOS pi-coding-agent bash and the existing Windows shell. Packaging scripts prepare and verify one platform-specific archive at a time.

**Tech Stack:** TypeScript/Node ESM, Electron 43, `tar`, `unzipper`, Node `crypto`/`fs`, existing Win32 process runner, `tsx --test`, electron-builder.

---

### Task 1: Define runtime fixtures, lock validation, and error codes

**Files:**
- Create: `resources/runtimes/runtime-lock.json`
- Create: `src/platform/runtime/runtime-lock.ts`
- Create: `test/src/platform/runtime/runtime-lock.test.ts`

- [ ] **Step 1: Write failing tests for lock parsing**

Cover a valid `darwin-arm64` entry, unknown schema, missing platform key, non-hex SHA-256, and an executable path containing `..`. Assert errors use stable codes `RUNTIME_LOCK_INVALID` and `RUNTIME_PLATFORM_UNSUPPORTED`.

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npx tsx --test test/src/platform/runtime/runtime-lock.test.ts`
Expected: FAIL because `runtime-lock.ts` does not exist.

- [ ] **Step 3: Implement the minimal parser**

Export `RuntimeLock`, `PythonRuntimeLockEntry`, `runtimePlatformKey(platform, arch)`, and `parseRuntimeLock(value)`. Validate schema version, exact platform key, positive archive size, lowercase 64-character SHA-256, and normalized relative executable/archive paths. Keep the lock file’s initial version `3.13.12` and empty SHA values out of the lock: use concrete SHA values supplied by the runtime artifact step before release.

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npx tsx --test test/src/platform/runtime/runtime-lock.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add resources/runtimes/runtime-lock.json src/platform/runtime/runtime-lock.ts test/src/platform/runtime/runtime-lock.test.ts
git commit -m "feat: add managed runtime lock validation"
```

### Task 2: Implement archive verification and Python installation

**Files:**
- Create: `src/platform/runtime/archive-verifier.ts`
- Create: `src/platform/runtime/python-installer.ts`
- Create: `test/src/platform/runtime/archive-verifier.test.ts`
- Create: `test/src/platform/runtime/python-installer.test.ts`

- [ ] **Step 1: Write failing archive-security tests**

Test tar/zip entry validation for `../escape`, `/absolute`, `C:\escape`, NUL bytes, symbolic links, hard links, device files, more than 20,000 files, and extraction above 512 MiB. Test that a valid archive is extracted below the destination and that file mode `0o700` is retained for macOS executables.

- [ ] **Step 2: Run tests and verify the expected failure**

Run: `npx tsx --test test/src/platform/runtime/archive-verifier.test.ts test/src/platform/runtime/python-installer.test.ts`
Expected: FAIL because the verifier and installer are missing.

- [ ] **Step 3: Implement verifier and installer**

`archive-verifier.ts` must stream SHA-256, enforce archive byte limits, validate every entry before writing, reject links/special files, and use exclusive file creation. `python-installer.ts` must maintain one in-flight install Promise, extract to `versions/.staging-<random>`, run the absolute interpreter with `-I` to verify version/machine, write `.runtime.json`, rename the version directory, and atomically update `active.json`. A failed staging operation must leave an existing active version untouched.

- [ ] **Step 4: Run tests and verify they pass**

Run: `npx tsx --test test/src/platform/runtime/archive-verifier.test.ts test/src/platform/runtime/python-installer.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/platform/runtime/archive-verifier.ts src/platform/runtime/python-installer.ts test/src/platform/runtime/archive-verifier.test.ts test/src/platform/runtime/python-installer.test.ts
git commit -m "feat: install and verify bundled python runtime"
```

### Task 3: Build the managed environment and process runner

**Files:**
- Create: `src/platform/runtime/managed-environment.ts`
- Create: `src/platform/runtime/process-runner.ts`
- Create: `src/platform/runtime/index.ts`
- Create: `test/src/platform/runtime/managed-environment.test.ts`
- Create: `test/src/platform/runtime/process-runner.test.ts`

- [ ] **Step 1: Write failing environment tests**

Assert that managed Python and wrapper directories are first in PATH using `path.delimiter`, dangerous variables (`NODE_OPTIONS`, `NODE_PATH`, `PYTHONHOME`, `PYTHONPATH`, proxy variables, and secret-suffix variables) are removed, and Node-only `ELECTRON_RUN_AS_NODE` is present only in the Node environment. Assert `resolveNode()` returns the injected Electron executable and `resolvePython()` returns the installed absolute executable.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx tsx --test test/src/platform/runtime/managed-environment.test.ts test/src/platform/runtime/process-runner.test.ts`
Expected: FAIL because the modules are missing.

- [ ] **Step 3: Implement RuntimeService**

Implement `createManagedRuntimeService({ platform, arch, isPackaged, resourcesPath, projectRoot, appDataDir, hostExecutable, hostNodeVersion, readHostEnv, log })`. Expose `resolveNode()`, `resolvePython()`, and `buildShellEnv()`. Resolve packaged resources from `resourcesPath/vendor` and development resources from `build/runtime-staging`; never inspect the current working directory. Use the existing `src/platform/process.ts` and `src/platform/windows_process.ts` conventions for bounded output and timeout errors.

- [ ] **Step 4: Run focused tests and verify pass**

Run: `npx tsx --test test/src/platform/runtime/managed-environment.test.ts test/src/platform/runtime/process-runner.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/platform/runtime/managed-environment.ts src/platform/runtime/process-runner.ts src/platform/runtime/index.ts test/src/platform/runtime/managed-environment.test.ts test/src/platform/runtime/process-runner.test.ts
git commit -m "feat: add managed runtime service"
```

### Task 4: Add platform wrappers and package preparation

**Files:**
- Create: `src/platform/runtime/wrappers.ts`
- Create: `scripts/runtime/prepare-runtime.mjs`
- Create: `scripts/runtime/verify-packaged-runtime.mjs`
- Create: `test/src/platform/runtime/wrappers.test.ts`
- Create: `test/scripts/runtime/prepare-runtime.test.ts`
- Modify: `package.json`
- Modify: `electron-builder.yml`

- [ ] **Step 1: Write failing wrapper and staging tests**

Assert macOS wrappers set `ELECTRON_RUN_AS_NODE=1`, Windows `.cmd` wrappers quote the absolute executable, staging rejects a source symlink and digest mismatch, and the output contains exactly `python.dat` plus `runtime-manifest.json` for the requested target.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npx tsx --test test/src/platform/runtime/wrappers.test.ts test/scripts/runtime/prepare-runtime.test.ts`
Expected: FAIL because wrapper and preparation modules are missing.

- [ ] **Step 3: Implement preparation and verification**

`prepare-runtime.mjs --platform <darwin|win32> --arch <arm64|x64>` must select one lock entry, validate the trusted source archive and entries, copy it as `python.dat`, and write the concrete manifest. `verify-packaged-runtime.mjs` must validate `vendor/runtime-manifest.json`, `vendor/python.dat`, target platform/arch, size, digest, and absence of other platform archives. Add direct `tar` and `unzipper` dependencies, runtime preparation scripts, and the two `extraResources` entries while retaining existing connector resources.

- [ ] **Step 4: Run focused tests and verify pass**

Run: `npx tsx --test test/src/platform/runtime/wrappers.test.ts test/scripts/runtime/prepare-runtime.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/platform/runtime/wrappers.ts scripts/runtime/prepare-runtime.mjs scripts/runtime/verify-packaged-runtime.mjs test/src/platform/runtime/wrappers.test.ts test/scripts/runtime/prepare-runtime.test.ts package.json package-lock.json electron-builder.yml
git commit -m "feat: package platform runtime artifacts"
```

### Task 5: Migrate expert Python and plugin npm calls

**Files:**
- Modify: `src/agent/tools/expert_draft.ts`
- Modify: `src/domains/plugin/node/service.ts`
- Modify: `src/agent/provider.ts`
- Create: `test/src/agent/tools/expert_draft.test.ts`
- Create: `test/src/domains/plugin/node/service.test.ts`

- [ ] **Step 1: Write failing migration tests**

Inject a fake RuntimeService and assert expert validation/registration receives its absolute Python executable. Inject a fake managed npm runtime and assert plugin installation invokes `process.execPath` with the bundled npm CLI path, never command name `npm` or a system `cmd.exe` npm command.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx tsx --test test/src/agent/tools/expert_draft.test.ts test/src/domains/plugin/node/service.test.ts`
Expected: FAIL because the call sites still hard-code `python3` and `npm`.

- [ ] **Step 3: Implement migration**

Create the RuntimeService once in `provider.ts`, pass it into tool/service factories, replace expert `runProcess("python3", ...)` with `runtime.resolvePython()`, and replace plugin npm execution with the existing `resolveManagedNpmRuntime()` result plus `ELECTRON_RUN_AS_NODE=1`. Preserve existing output limits and error mapping.

- [ ] **Step 4: Run tests and verify pass**

Run: `npx tsx --test test/src/agent/tools/expert_draft.test.ts test/src/domains/plugin/node/service.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/agent/tools/expert_draft.ts src/domains/plugin/node/service.ts src/agent/provider.ts test/src/agent/tools/expert_draft.test.ts test/src/domains/plugin/node/service.test.ts
git commit -m "feat: route internal scripts through managed runtimes"
```

### Task 6: Inject managed PATH into Agent shells

**Files:**
- Modify: `src/vendor/pi_coding_agent.ts`
- Modify: `src/agent/tools/index.ts`
- Modify: `src/agent/tools/windows_shell.ts`
- Modify: `src/platform/windows_process.ts`
- Create: `test/src/agent/tools/windows_shell.test.ts`

- [ ] **Step 1: Write failing shell tests**

Assert macOS bash calls `createLocalBashOperations().exec` with a runtime-built PATH, and Windows shell passes the same environment to `runWindowsProcessNoWindow`, with managed wrapper directory before the inherited PATH and case-insensitive PATH replacement.

- [ ] **Step 2: Run tests and verify failure**

Run: `npx tsx --test test/src/agent/tools/windows_shell.test.ts`
Expected: FAIL because shells currently inherit the process environment unchanged.

- [ ] **Step 3: Implement shell injection**

Re-export `createBashTool` and `createLocalBashOperations` from `src/vendor/pi_coding_agent.ts`. On macOS replace only the bash tool with a custom `BashOperations.exec` that awaits `runtime.buildShellEnv()`. On Windows await the same method before calling `runWindowsProcessNoWindow`; use `python3.cmd`, `node.cmd`, `npm.cmd`, and `npx.cmd` in the wrapper directory. Keep existing mutation/path protection order.

- [ ] **Step 4: Run focused shell tests and the type checker**

Run: `npx tsx --test test/src/agent/tools/windows_shell.test.ts && npx tsc --project tsconfig.electron.json --noEmit`
Expected: PASS and exit code 0.

- [ ] **Step 5: Commit**

```bash
git add src/vendor/pi_coding_agent.ts src/agent/tools/index.ts src/agent/tools/windows_shell.ts src/platform/windows_process.ts test/src/agent/tools/windows_shell.test.ts
git commit -m "feat: inject managed runtime into agent shells"
```

### Task 7: End-to-end verification and release wiring

**Files:**
- Modify: `package.json`
- Modify: `scripts/runtime/verify-packaged-runtime.mjs`
- Create: `test/src/platform/runtime/runtime.e2e.test.ts`

- [ ] **Step 1: Write failing clean-environment assertions**

Run a child process with Node/Python system paths removed and assert `node -p` resolves to the Electron executable, `python3 -I` resolves below the Pi-a app-data directory, and a script with `#!/usr/bin/env python3` works on macOS. Assert a second service initialization reuses the receipt without extracting again.

- [ ] **Step 2: Run the test and verify failure**

Run: `npx tsx --test test/src/platform/runtime/runtime.e2e.test.ts`
Expected: FAIL until packaged runtime fixtures and service wiring are complete.

- [ ] **Step 3: Implement release checks**

Add `prepare:runtime:mac:arm64`, `prepare:runtime:mac:x64`, `prepare:runtime:win:x64`, and `verify:runtime:package` scripts. Make release CI run clean → frontend build → target preparation → electron-builder target → package verification. Do not add a system-runtime fallback.

- [ ] **Step 4: Run the full verification set**

Run: `npx tsx --test $(find test/src test/scripts -type f \( -name '*.test.ts' -o -name '*.test.tsx' -o -name '*.spec.ts' -o -name '*.spec.tsx' \) -print) && npx tsc --project tsconfig.electron.json --noEmit`
Expected: all tests pass and type checking exits 0.

- [ ] **Step 5: Commit**

```bash
git add package.json package-lock.json scripts/runtime/verify-packaged-runtime.mjs test/src/platform/runtime/runtime.e2e.test.ts
git commit -m "test: verify packaged managed runtimes"
```

### Task 8: Final review

- [ ] Run `git diff --check` and inspect `git status --short`.
- [ ] Confirm `.claude/` remains untouched.
- [ ] Confirm no `spawn("python3")`, `spawn("npm")`, or `spawn("node")` remains in production code.
- [ ] Confirm release builds fail closed when the target archive is absent or tampered.
- [ ] Report exact test commands and results before claiming completion.
