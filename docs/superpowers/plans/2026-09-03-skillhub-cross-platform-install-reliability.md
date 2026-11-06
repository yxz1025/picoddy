# SkillHub Cross-Platform Install Reliability Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make SkillHub skill and expert installation deterministic on macOS and Windows regardless of launch directory, prior installs, or global ClawHub configuration permissions.

**Architecture:** Keep the bundled ClawHub CLI as the download implementation, but run login and install with an app-owned work directory and app-owned CLI config. Move non-global package normalization into a transactional same-filesystem replacement helper, and translate CLI failures into stable redacted application errors.

**Tech Stack:** Electron 43, Node.js 22 filesystem and child-process APIs, TypeScript, Node test runner through `tsx --test`.

---

> **Execution correction:** The user explicitly declined a worktree and new regression tests. Source inspection also confirmed that ClawHub CLI 0.23.3 does not read `CLAWHUB_TOKEN` during install, so the implementation retains `login --token` but redirects `CLAWHUB_CONFIG_PATH` into the app-owned runtime directory. A packaged-app reproduction further confirmed that the custom registry returns HTTP 500 only when the CLI calls the explicit-version endpoint, while the same install succeeds and resolves the same latest version without `--version`; the implementation therefore omits that flag. Any later step below that removes login, expects environment-only authentication, or requires explicit version pinning is superseded by this correction.

### Task 1: Make the CLI invocation app-owned and registry-compatible

**Files:**
- Modify: `src/domains/skillhub/node/installer.ts:18-204`
- Test: `test/src/domains/skillhub/node/installer.test.ts:11-52`

- [ ] **Step 1: Replace the existing invocation test with a failing app-owned invocation test**

Update the test to pass a temporary absolute `workDir`, expect exactly one runner call, and assert these arguments:

```ts
assert.deepEqual(installArgs, [
  "/app/node_modules/clawhub/bin/clawdhub.js",
  "--registry", "http://skillhub.test",
  "--workdir", workDir,
  "--dir", skillsDir,
  "install", "api-doc",
  "--version", "1.2.3",
  "--force",
]);
assert.equal(calls.length, 1);
assert.equal(installOptions.env.CLAWHUB_TOKEN, "secret-token");
```

Also assert that `<workDir>` exists after the call. The runner remains a test seam and performs no network request.

- [ ] **Step 2: Run the focused test and verify RED**

Run:

```bash
npx tsx --test --test-name-pattern="app-owned" test/src/domains/skillhub/node/installer.test.ts
```

Expected: FAIL because the current implementation invokes `login` first and omits `--workdir` and `--version`.

- [ ] **Step 3: Implement the minimal app-owned invocation**

Extend `SkillHubCliInstallOptions` with `workDir?: string`. Resolve the default as `join(platformPaths.appDataDir, "skillhub-runtime")`, require it to be absolute, and create it with `mkdir(..., { recursive: true })` before running the CLI.

Remove the `login --token` CLI call. Invoke only `install`, with arguments ordered as follows:

```ts
[
  "--registry", baseUrl,
  "--workdir", workDir,
  "--dir", skillsDir,
  "install",
  namespace === "global" ? slug : `${namespace}--${slug}`,
  "--version", version,
  "--force",
]
```

Continue passing `CLAWHUB_REGISTRY` and, when present, `CLAWHUB_TOKEN` through `managedEnv`.

- [ ] **Step 4: Run the focused test and verify GREEN**

Run the command from Step 2.

Expected: PASS with one CLI invocation, an existing work directory, and the exact requested version.

- [ ] **Step 5: Commit Task 1**

```bash
git add -- src/domains/skillhub/node/installer.ts test/src/domains/skillhub/node/installer.test.ts
git commit -m "fix: isolate SkillHub CLI runtime"
```

### Task 2: Replace existing non-global skills transactionally

**Files:**
- Modify: `src/domains/skillhub/node/installer.ts:86-101`
- Test: `test/src/domains/skillhub/node/installer.test.ts`

- [ ] **Step 1: Add a failing repeat-install regression test**

Create temporary `skillsDir` and `workDir` directories. Seed `<skillsDir>/poster/SKILL.md` with `old`, and have the runner create `<skillsDir>/design--poster/SKILL.md` containing `new`. Call `installSkillHubSkillWithCli` for namespace `design` and assert:

```ts
assert.equal(await readFile(join(skillsDir, "poster", "SKILL.md"), "utf8"), "new");
assert.equal(await exists(join(skillsDir, "design--poster")), false);
assert.deepEqual(
  (await readdir(skillsDir)).filter((name) => name.includes("skillhub-backup")),
  [],
);
```

- [ ] **Step 2: Run the repeat-install test and verify RED**

Run:

```bash
npx tsx --test --test-name-pattern="replaces an existing" test/src/domains/skillhub/node/installer.test.ts
```

Expected on macOS: FAIL with `SkillHub CLI 安装失败`, caused by `ENOTEMPTY` from `rename`.

- [ ] **Step 3: Implement same-filesystem backup and rollback**

Replace the error-code-specific branch in `normalizeInstallDirectory` with these operations:

```ts
const backupDir = resolve(
  skillsDir,
  `.${slug}.skillhub-backup-${process.pid}-${Date.now()}`,
);
let backedUp = false;
try {
  await rename(slugDir, backupDir);
  backedUp = true;
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}
try {
  await rename(namespacedDir, slugDir);
} catch (error) {
  if (backedUp) await rename(backupDir, slugDir).catch(() => undefined);
  throw error;
}
if (backedUp) await rm(backupDir, { recursive: true, force: true });
```

Both source, destination and backup remain under `skillsDir`, so Windows and macOS use same-filesystem renames without relying on platform-specific replacement errors.

- [ ] **Step 4: Add and run a rollback regression test**

Seed the old target but let the runner return without creating the downloaded source. Assert that installation rejects and the old `SKILL.md` still contains `old`. Run both replacement tests and expect PASS.

- [ ] **Step 5: Run all installer tests and commit Task 2**

```bash
npx tsx --test test/src/domains/skillhub/node/installer.test.ts
git add -- src/domains/skillhub/node/installer.ts test/src/domains/skillhub/node/installer.test.ts
git commit -m "fix: replace SkillHub skills atomically"
```

### Task 3: Classify local CLI failures without leaking output

**Files:**
- Modify: `src/domains/skillhub/node/installer.ts:113-138`
- Test: `test/src/domains/skillhub/node/installer.test.ts:54-94`

- [ ] **Step 1: Add failing permission and collision classification tests**

Use runner errors with exit code `1` and representative stderr. Assert stable messages and absence of the sample secret:

```ts
await assert.rejects(callWith({ code: 1, stderr: "EACCES token secret-token" }),
  /SkillHub CLI 无法写入本地目录/u);
await assert.rejects(callWith({ code: 1, stderr: "ENOTEMPTY rename" }),
  /SkillHub CLI 无法替换已有技能/u);
```

For both errors, assert the public message does not match `/secret-token/u`.

- [ ] **Step 2: Run the classification tests and verify RED**

Run:

```bash
npx tsx --test --test-name-pattern="classifies" test/src/domains/skillhub/node/installer.test.ts
```

Expected: FAIL because exit code `1` currently maps to the generic installation error.

- [ ] **Step 3: Add redacted category mapping**

Inspect `record.code` and `record.stderr` without returning stderr text:

```ts
const diagnostic = typeof record.stderr === "string" ? record.stderr : "";
const processCode = typeof record.code === "string" ? record.code : "";
const combined = `${processCode}\n${diagnostic}`;
if (/\b(?:EACCES|EPERM|EROFS)\b|permission denied|read-only file system/iu.test(combined)) {
  return new Error("SkillHub CLI 无法写入本地目录");
}
if (/\b(?:ENOTEMPTY|EEXIST)\b/iu.test(combined)) {
  return new Error("SkillHub CLI 无法替换已有技能");
}
```

Keep existing numeric exit-code and timeout mappings. Never append raw stderr to a returned error.

- [ ] **Step 4: Run all installer tests and verify GREEN**

```bash
npx tsx --test test/src/domains/skillhub/node/installer.test.ts
```

Expected: all installer tests pass and neither test exposes the sample secret.

- [ ] **Step 5: Commit Task 3**

```bash
git add -- src/domains/skillhub/node/installer.ts test/src/domains/skillhub/node/installer.test.ts
git commit -m "fix: classify SkillHub local failures"
```

### Task 4: Verify expert reuse and cross-platform paths

**Files:**
- Create: `test/src/platform/paths.test.ts`
- Modify: `test/src/domains/skillhub/node/expert_installer.test.ts`
- Test: `test/src/domains/skillhub/node/expert_installer.test.ts`
- Test: `test/src/agent/experts/skillhub_cache.test.ts`
- Test: `test/src/platform/cli/runtime.test.ts`

- [ ] **Step 1: Add cross-platform path characterization tests**

Create `test/src/platform/paths.test.ts` with explicit platform inputs:

```ts
import assert from "node:assert/strict";
import test from "node:test";
import { createPlatformPaths } from "../../../src/platform/paths.ts";

test("app data directory is user-owned on macOS", () => {
  const paths = createPlatformPaths({
    os: "darwin",
    execPath: "/Applications/PiCoddyClaw.app/Contents/MacOS/PiCoddyClaw",
    env: { HOME: "/Users/tester" },
  });
  assert.equal(paths.appDataDir, "/Users/tester/.pi-a");
  assert.equal(paths.join(paths.appDataDir, "skillhub-runtime"), "/Users/tester/.pi-a/skillhub-runtime");
});

test("app data directory is user-owned on Windows", () => {
  const paths = createPlatformPaths({
    os: "windows",
    execPath: "C:\\Program Files\\PiCoddyClaw\\PiCoddyClaw.exe",
    env: { USERPROFILE: "C:\\Users\\tester", LOCALAPPDATA: "C:\\Users\\tester\\AppData\\Local" },
  });
  assert.equal(paths.appDataDir, "C:\\Users\\tester\\AppData\\Local\\Pi-a");
  assert.equal(paths.join(paths.appDataDir, "skillhub-runtime"), "C:\\Users\\tester\\AppData\\Local\\Pi-a\\skillhub-runtime");
});
```

Run `npx tsx --test test/src/platform/paths.test.ts`; both characterization tests must pass before changing shared installation behavior.

- [ ] **Step 2: Add an expert delegation test**

Install a valid fixture through `installSkillHubExpert` with an injected `installPackage`. Capture its input and options, then assert:

```ts
assert.equal(capturedInput?.version, "2.0.0");
assert.equal(capturedOptions?.workDir, workDir);
assert.ok(capturedOptions?.skillsDir?.startsWith(cacheDir));
```

This locks down version and work-directory forwarding while retaining the expert staging directory.

- [ ] **Step 3: Run the expert test and verify its initial result**

```bash
npx tsx --test --test-name-pattern="forwards the managed" test/src/domains/skillhub/node/expert_installer.test.ts
```

Expected: PASS because the expert installer forwards its input and options to the shared installer while overriding only `skillsDir`.

- [ ] **Step 4: Run the complete focused regression suite**

```bash
npx tsx --test \
  test/src/platform/cli/runtime.test.ts \
  test/src/platform/paths.test.ts \
  test/src/domains/skillhub/node/installer.test.ts \
  test/src/domains/skillhub/node/expert_installer.test.ts \
  test/src/domains/skillhub/node/client.test.ts \
  test/src/agent/experts/skillhub_cache.test.ts \
  frontend/src/api/client.test.ts
```

Expected: all focused tests pass.

- [ ] **Step 5: Run build-level verification**

```bash
npm run build:frontend
npx tsc --project tsconfig.electron.json --noEmit
git diff --check
```

Expected: frontend build succeeds and changed files introduce no type or whitespace errors. If TypeScript still reports the pre-existing `src/agent/tools/subagent.ts` errors, record them separately and verify no new SkillHub errors are present.

- [ ] **Step 6: Commit the cross-platform and expert regression coverage**

```bash
git add -- test/src/platform/paths.test.ts test/src/domains/skillhub/node/expert_installer.test.ts
git commit -m "test: cover cross-platform SkillHub installs"
```
