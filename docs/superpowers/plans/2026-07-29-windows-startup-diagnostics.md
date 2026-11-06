# Windows Startup Diagnostics Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Record every Windows desktop startup phase and capture failures that happen before `main.ts` can create a window.

**Architecture:** Add a dependency-free Windows startup logger that writes synchronously below `%LOCALAPPDATA%\Pi-a\logs`. Build Windows artifacts from a small bootstrap entrypoint that installs global failure handlers, dynamically imports `main.ts`, and calls its exported desktop startup function; macOS continues building directly from `main.ts`.

**Tech Stack:** Deno 2.9, TypeScript, Deno Desktop, Deno tests.

---

### Task 1: Startup log path and writer

**Files:**
- Create: `src/platform/startup_log.ts`
- Test: `src/platform/startup_log_test.ts`

- [ ] **Step 1: Write the failing tests**

Test that Windows resolves the log below `LOCALAPPDATA`, falls back to `USERPROFILE`, formats one-line timestamped records, creates the log directory, and appends instead of overwriting.

- [ ] **Step 2: Run the tests to verify failure**

Run:

```bash
deno test --allow-read --allow-write --allow-env src/platform/startup_log_test.ts
```

Expected: FAIL because `startup_log.ts` does not exist.

- [ ] **Step 3: Implement the logger**

Expose `createStartupLogPath`, `formatStartupLogLine`, and `createStartupLogger`. Keep the module free of application imports so the Windows bootstrap can load it before `main.ts`.

- [ ] **Step 4: Run tests**

Run the Task 1 command again. Expected: all tests pass.

### Task 2: Windows bootstrap and staged startup

**Files:**
- Create: `windows_bootstrap.ts`
- Modify: `main.ts`
- Modify: `deno.json`

- [ ] **Step 1: Add a failing bootstrap contract test**

Add a test asserting that Windows build tasks use `windows_bootstrap.ts`, while macOS tasks continue using `main.ts`.

- [ ] **Step 2: Verify failure**

Run:

```bash
deno test --allow-read deno_windows_bootstrap_test.ts
```

Expected: FAIL because Windows tasks still use `main.ts`.

- [ ] **Step 3: Implement bootstrap and startup stages**

Export `startDesktopApp()` from `main.ts`. In `windows_bootstrap.ts`, install `error` and `unhandledrejection` handlers, log bootstrap/import/start phases, dynamically import `main.ts`, call `startDesktopApp()`, and log caught stacks before rethrowing. Add stage records around database, models, skills, MCP configuration, scheduler, keep-awake, HTTP server, BrowserWindow creation, and navigation. Change only Windows build entrypoints.

- [ ] **Step 4: Run focused tests and checks**

Run:

```bash
deno test --allow-read --allow-write --allow-env src/platform/startup_log_test.ts deno_windows_bootstrap_test.ts src/platform/window_test.ts
deno check main.ts windows_bootstrap.ts
```

Expected: all pass.

### Task 3: Rebuild and verify Windows artifacts

**Files:**
- Generated: `dist/windows/Pi-a/`
- Generated: `dist/windows/Pi-a.msi`

- [ ] **Step 1: Build frontend and embed assets**

```bash
cd frontend && npm run build
cd .. && deno run --allow-read --allow-write scripts/gen-frontend.ts
```

- [ ] **Step 2: Build Windows portable and MSI**

```bash
deno task build:windows:portable
deno task build:windows:msi
```

- [ ] **Step 3: Verify artifact contents**

Confirm `Pi-a.exe`, `runtime.dll`, and `Pi-a.msi` exist and that the embedded runtime contains `windows_bootstrap.ts` and the startup log messages.

- [ ] **Step 4: Windows acceptance**

After installation, inspect:

```text
%LOCALAPPDATA%\Pi-a\logs\startup.log
```

The final line identifies the exact failed or completed startup phase.
