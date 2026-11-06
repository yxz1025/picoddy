# Windows Compatibility Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add Windows 10/11 x64 runtime and packaging support without changing the existing macOS behavior or hot-path performance, then implement Windows Computer Use last.

**Architecture:** Introduce focused `src/platform/` adapters for paths, shell integration, LibreOffice, power management, and capability reporting. Existing routes and stores consume those adapters while retaining their current API contracts. Deno Desktop 2.9 produces the Windows portable directory and MSI directly.

**Tech Stack:** Deno 2.9+, TypeScript, Deno Desktop, Node-compatible `node:path`/`node:os`, PowerShell/.NET/Win32 on Windows, AppleScript/macOS CLI on macOS, React/Vite, Deno tests.

---

## File Structure

- Create `src/platform/runtime.ts`: platform identification and capability types.
- Create `src/platform/paths.ts`: cross-platform application paths.
- Create `src/platform/paths_test.ts`: Windows/macOS path-selection tests.
- Create `src/platform/process.ts`: injectable command runner with timeout and structured arguments.
- Create `src/platform/shell.ts`: open, directory picker, clipboard, foreground application.
- Create `src/platform/shell_test.ts`: command-selection and injection-safety tests.
- Create `src/platform/libreoffice.ts`: executable discovery and PDF conversion.
- Create `src/platform/libreoffice_test.ts`: per-platform discovery tests.
- Create `src/platform/power.ts`: keep-awake lifecycle.
- Create `src/platform/power_test.ts`: idempotency and disposal tests.
- Create `src/platform/permissions.ts`: truthful platform capability reporting.
- Create `src/platform/permissions_test.ts`: capability contract tests.
- Create `src/platform/index.ts`: stable public exports.
- Modify `src/infra/db.ts`: use platform application data.
- Modify stores/tools using `HOME || "/tmp"`: use platform paths.
- Modify `main.ts`: route OS operations through platform modules and clean up processes.
- Modify `src/domains/settings/node/store.ts`: delegate keep-awake.
- Modify `frontend/src/store/useStore.ts`: remove developer-specific macOS paths.
- Modify `frontend/src/components/WorkspaceModal.tsx`: platform-neutral placeholder.
- Modify `deno.json`: Deno 2.9 desktop metadata and Windows build tasks.
- Create `resources/app-icon.ico`: Windows multi-resolution icon.
- Create `.github/workflows/windows-package.yml`: Windows build and smoke-test job.
- Modify `README.md`: platform build commands and Windows prerequisites.
- Modify `src/agent/tools/os.ts`: add Windows Computer Use implementation last.
- Create `src/agent/tools/os_windows.ts`: Windows screenshot/input/window primitives.
- Create `src/agent/tools/os_windows_test.ts`: command and coordinate tests.

### Task 1: Platform Runtime and Path Contract

**Files:**
- Create: `src/platform/runtime.ts`
- Create: `src/platform/paths.ts`
- Test: `src/platform/paths_test.ts`

- [ ] **Step 1: Write failing path tests**

Cover macOS `~/.pi-a`, Windows `%LOCALAPPDATA%\Pi-a`, `%USERPROFILE%` fallback, temp directories, `C:\` paths, UNC paths, basename/dirname, and `~/` expansion. Construct adapters with explicit `{ os, env }` inputs so tests do not mutate `Deno.build`.

- [ ] **Step 2: Run the path tests and confirm failure**

Run:

```bash
deno test --allow-env src/platform/paths_test.ts
```

Expected: failure because `createPlatformPaths` does not exist.

- [ ] **Step 3: Implement runtime and paths**

Expose:

```ts
export type SupportedPlatform = "darwin" | "windows" | "linux";

export interface PlatformEnvironment {
  os: SupportedPlatform;
  env: Readonly<Record<string, string | undefined>>;
}

export function createPlatformPaths(input: PlatformEnvironment): {
  homeDir: string;
  tempDir: string;
  appDataDir: string;
  artifactsDir: string;
  skillsDir: string;
  expandHome(path: string): string;
};

export const platformPaths = createPlatformPaths({
  os: Deno.build.os,
  env: {
    HOME: Deno.env.get("HOME"),
    USERPROFILE: Deno.env.get("USERPROFILE"),
    LOCALAPPDATA: Deno.env.get("LOCALAPPDATA"),
    TEMP: Deno.env.get("TEMP"),
    TMP: Deno.env.get("TMP"),
  },
});
```

Use `node:path/posix` for macOS fixtures and `node:path/win32` for Windows fixtures. Preserve `~/.pi-a` exactly on macOS.

- [ ] **Step 4: Run tests**

Run:

```bash
deno test --allow-env src/platform/paths_test.ts
deno check src/platform/runtime.ts src/platform/paths.ts
```

Expected: all pass.

- [ ] **Step 5: Commit**

```bash
git add src/platform/runtime.ts src/platform/paths.ts src/platform/paths_test.ts
git commit -m "feat: add cross-platform runtime paths"
```

### Task 2: Migrate Persistent Data and Default Paths

**Files:**
- Modify: `src/infra/db.ts`
- Modify: `src/domains/doc/node/paths.ts`
- Modify: `src/agent/tools/index.ts`
- Modify: `src/agent/tools/task.ts`
- Modify: `src/agent/experts.ts`
- Modify: `src/agent/mcp.ts`
- Modify: `src/infra/file_snapshot.ts`
- Modify: `src/domains/skill/node/store.ts`
- Modify: `src/agent/tools/os.ts`
- Modify: other production TypeScript files returned by `rg 'Deno\\.env\\.get\\(\"HOME\"\\).*\\/tmp|/Users/hanfeng' src main.ts frontend/src`
- Test: extend relevant existing store tests

- [ ] **Step 1: Record the compatibility scan**

Run:

```bash
rg -n 'Deno\.env\.get\("HOME"\).*\/tmp|/Users/hanfeng|startsWith\("/"\)' src main.ts frontend/src
```

Save the result in the task notes and distinguish URL route parsing from filesystem parsing.

- [ ] **Step 2: Add failing assertions**

Add tests asserting that macOS store roots remain under `<HOME>/.pi-a`, Windows roots use `%LOCALAPPDATA%\Pi-a`, and artifacts accept Windows absolute paths.

- [ ] **Step 3: Run focused tests and confirm failure**

Run:

```bash
deno test --allow-read --allow-write --allow-env src/domains/doc/node/reader_test.ts src/domains/skill-draft/node/store_test.ts
```

Expected: new Windows path assertions fail.

- [ ] **Step 4: Replace filesystem string concatenation**

Import `platformPaths` and `node:path` operations. Keep the macOS resolved strings unchanged. Do not change HTTP route `split("/")` calls.

- [ ] **Step 5: Remove developer-specific defaults**

Generate `security_file_rules` in the backend from `platformPaths.homeDir` and `platformPaths.tempDir`. Remove the `/Users/hanfeng/Desktop/pi-a` value from the Zustand initial state and use the backend response as the source of truth.

- [ ] **Step 6: Verify**

Run:

```bash
rg -n 'Deno\.env\.get\("HOME"\).*\/tmp|/Users/hanfeng' src main.ts frontend/src
deno test --allow-read --allow-write --allow-env src/platform/paths_test.ts src/domains/doc/node/reader_test.ts src/domains/skill-draft/node/store_test.ts
```

Expected: no production hard-coded developer path; tests pass.

- [ ] **Step 7: Commit**

```bash
git add src frontend/src
git commit -m "refactor: use platform application paths"
```

### Task 3: Safe Platform Process and Shell Integration

**Files:**
- Create: `src/platform/process.ts`
- Create: `src/platform/shell.ts`
- Test: `src/platform/shell_test.ts`
- Modify: `main.ts`

- [ ] **Step 1: Write failing command-selection tests**

Test these contracts:

```ts
await createShellAdapter(macFixture).openPath("/tmp/a b.txt");
assertEquals(calls[0], { command: "open", args: ["/tmp/a b.txt"] });

await createShellAdapter(winFixture).openPath("C:\\Users\\A B\\文档.txt");
assertEquals(calls[0].command, "cmd.exe");
assert(calls[0].args.includes("C:\\Users\\A B\\文档.txt"));
```

Also test that paths containing `&`, `|`, quotes, and `$()` remain data arguments and never become interpolated PowerShell source.

- [ ] **Step 2: Confirm failure**

Run:

```bash
deno test src/platform/shell_test.ts
```

Expected: shell adapter is missing.

- [ ] **Step 3: Implement the process runner**

Define a runner accepting `{ command, args, timeoutMs, stdin? }`, using `Deno.Command`, `AbortSignal.timeout`, piped output, and sanitized error objects. Long PowerShell programs are constant source strings; user paths are passed as encoded stdin or environment/positional data, never concatenated into the script.

- [ ] **Step 4: Implement shell adapters**

Keep macOS `open`, AppleScript, `pbpaste`, and System Events behavior. Add Windows `cmd.exe`, STA FolderBrowserDialog, `Get-Clipboard -Raw`, and Win32 foreground-process lookup.

- [ ] **Step 5: Migrate API routes**

Change `/api/open`, `/api/pick-dir`, and `/api/system/context` to call the adapter. Preserve success fields, cancellation behavior, and empty-string context fallback.

- [ ] **Step 6: Verify**

Run:

```bash
deno test src/platform/shell_test.ts
deno check main.ts src/platform/process.ts src/platform/shell.ts
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add main.ts src/platform/process.ts src/platform/shell.ts src/platform/shell_test.ts
git commit -m "feat: add Windows shell integration"
```

### Task 4: Cross-Platform LibreOffice Export

**Files:**
- Create: `src/platform/libreoffice.ts`
- Test: `src/platform/libreoffice_test.ts`
- Modify: `main.ts`

- [ ] **Step 1: Write discovery tests**

Cover macOS existing candidates, Windows `PATH`, `PROGRAMFILES`, `PROGRAMFILES(X86)`, Chinese/space paths, missing installation, output dirname, and output filename.

- [ ] **Step 2: Confirm failure**

Run:

```bash
deno test src/platform/libreoffice_test.ts
```

Expected: module missing.

- [ ] **Step 3: Implement discovery and conversion**

Inject `stat` and command runner for tests. Preserve the two existing macOS candidates and add Windows candidates. Use `path.dirname` and `path.parse`, not `/` splitting.

- [ ] **Step 4: Migrate `/api/export-pdf`**

Retain the route contract and artifact registration. Return platform-specific installation guidance.

- [ ] **Step 5: Verify**

Run:

```bash
deno test src/platform/libreoffice_test.ts
deno check main.ts src/platform/libreoffice.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add main.ts src/platform/libreoffice.ts src/platform/libreoffice_test.ts
git commit -m "feat: support LibreOffice export on Windows"
```

### Task 5: Keep-Awake Lifecycle

**Files:**
- Create: `src/platform/power.ts`
- Test: `src/platform/power_test.ts`
- Modify: `src/domains/settings/node/store.ts`
- Modify: `main.ts`

- [ ] **Step 1: Write lifecycle tests**

Assert repeated enable spawns once, disable kills once, application disposal always restores state, macOS uses `caffeinate -d -i`, and Windows uses the constant `SetThreadExecutionState` helper.

- [ ] **Step 2: Confirm failure**

Run:

```bash
deno test src/platform/power_test.ts
```

Expected: module missing.

- [ ] **Step 3: Implement adapters**

Move existing macOS behavior without semantic changes. Implement a Windows PowerShell helper with `ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED`, keep it alive under the manager, and restore `ES_CONTINUOUS` in `finally`.

- [ ] **Step 4: Wire settings and shutdown**

Delegate `applyKeepAwake` and call `disposeKeepAwake()` before explicit process exit and normal shutdown hooks.

- [ ] **Step 5: Verify**

Run:

```bash
deno test src/platform/power_test.ts
deno check main.ts src/domains/settings/node/store.ts
```

Expected: pass.

- [ ] **Step 6: Commit**

```bash
git add main.ts src/platform/power.ts src/platform/power_test.ts src/domains/settings/node/store.ts
git commit -m "feat: add Windows keep-awake support"
```

### Task 6: Truthful Capability and Permission Reporting

**Files:**
- Create: `src/platform/permissions.ts`
- Test: `src/platform/permissions_test.ts`
- Create: `src/platform/index.ts`
- Modify: `main.ts`
- Modify: relevant permission UI in `frontend/src/components/SettingsModal.tsx`

- [ ] **Step 1: Write capability contract tests**

Assert macOS checks remain callable, Windows generic shell capabilities reflect probes, Windows Computer Use is initially `supported: false`, and unknown platforms do not report success.

- [ ] **Step 2: Confirm failure**

Run:

```bash
deno test src/platform/permissions_test.ts
```

Expected: module missing.

- [ ] **Step 3: Implement capability types**

Use:

```ts
type CapabilityState = {
  supported: boolean;
  available: boolean;
  reason?: string;
};
```

Keep legacy `accessibilityGranted`, `screenRecordingGranted`, and `cliclickInstalled` response fields while adding structured capability fields.

- [ ] **Step 4: Migrate permission routes**

Keep macOS framework checks. On Windows, open the appropriate Settings URI only when useful and never return blanket `true` for unimplemented Computer Use.

- [ ] **Step 5: Update UI**

Render unsupported/unavailable states without treating them as permission denial. Do not change macOS labels or interaction.

- [ ] **Step 6: Verify**

Run:

```bash
deno test src/platform/permissions_test.ts
deno check main.ts frontend/src/components/SettingsModal.tsx
```

Expected: pass.

- [ ] **Step 7: Commit**

```bash
git add main.ts src/platform frontend/src/components/SettingsModal.tsx
git commit -m "feat: report platform capabilities accurately"
```

### Task 7: Deno Desktop Windows Packaging

**Files:**
- Modify: `deno.json`
- Create: `resources/app-icon.ico`
- Modify: `scripts/generate-icon.py`
- Create: `.github/workflows/windows-package.yml`
- Modify: `README.md`

- [ ] **Step 1: Update icon generation**

Generate an ICO containing at least 16, 24, 32, 48, 64, 128, and 256 pixel images from the existing source PNG. Preserve all macOS icon outputs and their current rendering.

- [ ] **Step 2: Add desktop metadata and tasks**

Require Deno 2.9+ and add:

```json
"build:mac": "... --output dist/macos/Pi-a.app ...",
"build:windows:portable": "... --target x86_64-pc-windows-msvc --output dist/windows/Pi-a ...",
"build:windows:msi": "... --target x86_64-pc-windows-msvc --output dist/windows/Pi-a.msi --compress ...",
"build:windows": "deno task build:frontend && deno task gen:frontend && deno task build:windows:portable && deno task build:windows:msi"
```

Keep the existing `build` task as a macOS-compatible alias unless release automation explicitly changes it.

- [ ] **Step 3: Add Windows CI**

Use `windows-latest`, `denoland/setup-deno`, Node setup, `npm ci`, `deno check`, Windows portable build, MSI build, and artifact upload. Run a PowerShell smoke test that confirms expected launcher/runtime files and the MSI exist.

- [ ] **Step 4: Document commands**

Document portable directory semantics, MSI installation, Deno 2.9+, WebView2 requirements if applicable, and optional `signtool` signing. Do not call the portable directory a single EXE.

- [ ] **Step 5: Verify locally available parts**

Run:

```bash
python3 scripts/generate-icon.py
file resources/app-icon.ico
cd frontend && npm run build
```

Then, on a machine with Deno 2.9+:

```bash
deno task build:windows
```

Expected: `dist/windows/Pi-a/` and `dist/windows/Pi-a.msi`.

- [ ] **Step 6: Commit**

```bash
git add deno.json resources/app-icon.ico scripts/generate-icon.py .github/workflows/windows-package.yml README.md
git commit -m "build: add Windows portable and MSI packages"
```

### Task 8: Windows Native Dependency Verification

**Files:**
- Create: `scripts/windows-smoke.ts`
- Modify: `.github/workflows/windows-package.yml`
- Modify: `src/infra/keychain.ts` only if the smoke test exposes a compatibility fault
- Modify: terminal/sidecar module only if the smoke test exposes a Windows fault

- [ ] **Step 1: Add a Windows smoke script**

Exercise SQLite creation/query, application-data write/read, `keytar` set/get/delete against a test service, child-process pipes, and dynamic imports used by the packaged app. Assert that the Windows dependency graph and packaged file manifest contain no `node-pty`, `winpty`, or ConPTY backend. Ensure test credentials are deleted in `finally`.

- [ ] **Step 2: Run on Windows CI before packaging**

Run:

```powershell
deno run --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys scripts/windows-smoke.ts
```

Expected: all checks print `PASS`.

- [ ] **Step 3: Run against the packaged app**

Launch the portable app with a smoke-test environment flag, poll its local health endpoint, call settings and database-backed endpoints, then terminate it cleanly.

- [ ] **Step 4: Apply only evidence-driven fallbacks**

Windows must always use pipe-based `Deno.Command`/`child_process.spawn`; do not add a PTY probe or fallback. If keytar fails, surface `unavailable` and retain environment-variable reads; never persist plaintext secrets.

- [ ] **Step 5: Commit**

```bash
git add scripts/windows-smoke.ts .github/workflows/windows-package.yml src
git commit -m "test: verify Windows native dependencies"
```

### Task 9: macOS Regression and Windows Release Gate

**Files:**
- Modify: `.github/workflows/windows-package.yml`
- Create or modify: release checklist under `docs/`

- [ ] **Step 1: Run static and unit validation**

Run:

```bash
deno test --allow-read --allow-write --allow-env --allow-run --allow-ffi --allow-sys
deno check main.ts
cd frontend && npm run build
```

Expected: pass.

- [ ] **Step 2: Run macOS regression**

Verify chat, attachments, skills, documents, open, directory picker, PDF export, context, clipboard, keep-awake, existing Computer Use, and `.app` packaging. Compare command traces for macOS platform adapters against pre-change commands.

- [ ] **Step 3: Run Windows 10/11 x64 acceptance**

Verify portable launch, MSI install/start/uninstall, Chinese username, paths with spaces, attachment parsing, skill creation/install, SQLite persistence, file opening, native folder picker, clipboard, foreground application, LibreOffice present/missing, keep-awake enable/disable/crash recovery, and Credential Manager.

- [ ] **Step 4: Record release status**

Mark Windows support ready only when a Windows runner or real machine produces passing evidence. Cross-compilation alone is insufficient.

- [ ] **Step 5: Commit**

```bash
git add .github/workflows/windows-package.yml docs
git commit -m "docs: add Windows release verification gate"
```

### Task 10: Windows Computer Use (Last)

**Files:**
- Create: `src/agent/tools/os_windows.ts`
- Test: `src/agent/tools/os_windows_test.ts`
- Modify: `src/agent/tools/os.ts`
- Modify: `src/platform/permissions.ts`
- Modify: `main.ts`

- [ ] **Step 1: Define the backend interface**

Cover display metrics, screenshot, cursor position, move, click, drag, scroll, text entry, key combinations, foreground window, window list, and application focus.

- [ ] **Step 2: Write failing coordinate and command tests**

Test Windows scaling at 100/125/150/200 percent, multi-monitor negative origins, Unicode input, modifier combinations, right/double click, and unsupported secure-desktop behavior.

- [ ] **Step 3: Implement Windows primitives**

Use Win32/UI Automation through a focused native bridge or FFI for high-frequency input and screen operations. PowerShell may be used only as a low-frequency fallback. Keep the existing macOS implementation unchanged and selected directly for Darwin.

- [ ] **Step 4: Wire tool dispatch**

Dispatch once by platform and preserve the existing Agent tool schemas and response content. Return structured unsupported/unavailable errors instead of silently succeeding.

- [ ] **Step 5: Update capability reporting**

Mark Windows Computer Use available only after its backend initializes and required operations pass a probe.

- [ ] **Step 6: Run automated and real-machine acceptance**

Run unit tests, then on Windows verify screenshot dimensions, cursor targeting, typing Chinese and English, shortcuts, scrolling, window focus, and multi-monitor coordinates.

- [ ] **Step 7: Run macOS regression**

Confirm the Darwin tool objects execute the same `cliclick`/AppleScript/screenshot paths as before.

- [ ] **Step 8: Commit**

```bash
git add src/agent/tools/os.ts src/agent/tools/os_windows.ts src/agent/tools/os_windows_test.ts src/platform/permissions.ts main.ts
git commit -m "feat: add Windows Computer Use backend"
```

## Final Verification

- [ ] `rg` finds no production developer-specific `/Users/hanfeng` path.
- [ ] macOS application data remains `~/.pi-a`.
- [ ] Windows application data uses `%LOCALAPPDATA%\Pi-a`.
- [ ] Existing API routes retain compatible success/cancellation responses.
- [ ] macOS command choices are unchanged.
- [ ] Windows paths with spaces, Unicode, drive letters, and UNC roots pass.
- [ ] Windows portable directory and MSI are produced by Deno Desktop 2.9+.
- [ ] Windows native dependencies pass on a Windows runner.
- [ ] Windows Computer Use is implemented only after all preceding compatibility work.
