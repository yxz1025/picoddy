# Windows Managed npm and DPAPI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Produce a Windows 10 x64 Pi-a build that excludes macOS native modules and stores API keys with Windows DPAPI while preserving the existing macOS keytar path.

**Architecture:** Windows builds use a child Deno config that aliases `keytar` to an unreachable stub, disables the host `node_modules`, and embeds only reachable managed npm packages. A focused Windows credential adapter invokes PowerShell 5.1 DPAPI with secrets sent through stdin; the existing keychain facade routes Windows to DPAPI and all other platforms to the current keytar behavior.

**Tech Stack:** Deno 2.9 Desktop, TypeScript, Windows PowerShell 5.1, DPAPI `ProtectedData`, Deno tests.

---

## File Structure

- Create `deno.windows.json`: inherit root dependency pins while overriding Windows-only dependency resolution.
- Create `src/infra/keytar_windows_stub.ts`: fail-fast stub that prevents macOS keytar binaries entering Windows builds.
- Create `src/infra/windows_credentials.ts`: DPAPI command encoding, process execution, credential paths, read/write/delete.
- Create `src/infra/windows_credentials_test.ts`: DPAPI adapter and secret-handling regression tests.
- Create `src/infra/keychain_test.ts`: platform routing and macOS keytar preservation tests.
- Modify `src/infra/keychain.ts`: retain public API and route by platform.
- Modify `deno_windows_bootstrap_test.ts`: enforce Windows build isolation flags and config.
- Modify `deno.json`: apply the Windows child config and managed npm flags only to Windows builds.

### Task 1: Lock the Windows Build Contract

**Files:**
- Create: `deno.windows.json`
- Create: `src/infra/keytar_windows_stub.ts`
- Modify: `deno_windows_bootstrap_test.ts`
- Modify: `deno.json`

- [ ] **Step 1: Extend the build contract test**

Add assertions that both Windows tasks contain:

```ts
for (const task of [portable, msi]) {
  assertStringIncludes(task, "--config deno.windows.json");
  assertStringIncludes(task, "--node-modules-dir=none");
  assertStringIncludes(task, "--exclude-unused-npm");
  assertStringIncludes(task, "windows_bootstrap.ts");
}
assertEquals(mac.includes("deno.windows.json"), false);
assertEquals(mac.includes("--node-modules-dir=none"), false);
```

Import `assertEquals` beside `assertStringIncludes`.

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
/Users/xiaozhongyuan/.deno/bin/deno test --allow-read deno_windows_bootstrap_test.ts
```

Expected: FAIL because the current Windows tasks do not contain the managed npm flags or child config.

- [ ] **Step 3: Add the Windows config and keytar stub**

Create `deno.windows.json`:

```json
{
  "extends": "./deno.json",
  "nodeModulesDir": "none",
  "imports": {
    "keytar": "./src/infra/keytar_windows_stub.ts"
  }
}
```

Create `src/infra/keytar_windows_stub.ts`:

```ts
function unavailable(): never {
  throw new Error("Windows 必须使用 DPAPI，禁止调用 keytar");
}

export async function getPassword(
  _service: string,
  _account: string,
): Promise<string | null> {
  return unavailable();
}
export async function setPassword(
  _service: string,
  _account: string,
  _password: string,
): Promise<void> {
  unavailable();
}
export async function deletePassword(
  _service: string,
  _account: string,
): Promise<boolean> {
  return unavailable();
}
```

- [ ] **Step 4: Apply the Windows build flags**

Update only `build:windows:portable` and `build:windows:msi` in `deno.json` so each `deno desktop` invocation begins with:

```text
deno desktop --config deno.windows.json --node-modules-dir=none --exclude-unused-npm
```

Keep their target, output, icon, permissions, bootstrap entry, and staging commands unchanged. Do not modify `build:mac`.

- [ ] **Step 5: Run the build contract test and verify GREEN**

Run:

```bash
/Users/xiaozhongyuan/.deno/bin/deno test --allow-read deno_windows_bootstrap_test.ts
```

Expected: 1 passed, 0 failed.

### Task 2: Implement the Windows DPAPI Adapter

**Files:**
- Create: `src/infra/windows_credentials.ts`
- Create: `src/infra/windows_credentials_test.ts`

- [ ] **Step 1: Write failing adapter tests**

Define tests against this public API:

```ts
export interface WindowsCredentialStore {
  get(provider: string): Promise<string | undefined>;
  set(provider: string, secret: string): Promise<void>;
  delete(provider: string): Promise<void>;
}

export function createWindowsCredentialStore(
  options: WindowsCredentialStoreOptions,
): WindowsCredentialStore;
```

Tests must verify:

```ts
Deno.test("provider names become stable credential paths inside app data", async () => {
  const first = await credentialFilePath("C:\\Data\\Pi-a", "../../deepseek");
  const second = await credentialFilePath("C:\\Data\\Pi-a", "../../deepseek");
  assertEquals(first, second);
  assertEquals(first.startsWith("C:\\Data\\Pi-a\\credentials\\"), true);
  assertEquals(first.includes(".."), false);
});

Deno.test("DPAPI set passes plaintext only through stdin", async () => {
  // Capture the injected process call.
  // Assert command is powershell.exe, args contain -EncodedCommand,
  // env contains only PI_A_CREDENTIAL_PATH, and stdin equals the secret.
  // Assert args and env JSON do not contain the secret.
});

Deno.test("DPAPI read returns stdout and delete ignores a missing file", async () => {
  // Inject exists=true and a runner returning { code: 0, stdout: "secret", stderr: "" }.
  // Assert get returns "secret"; inject a NotFound remove and assert delete resolves.
});

Deno.test("DPAPI failures redact the plaintext secret", async () => {
  // Make the runner throw an Error containing the supplied secret.
  // Assert the outward error does not contain that secret.
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
/Users/xiaozhongyuan/.deno/bin/deno test --allow-read --allow-write --allow-env --allow-run src/infra/windows_credentials_test.ts
```

Expected: FAIL with module-not-found for `windows_credentials.ts`.

- [ ] **Step 3: Implement command encoding and path isolation**

In `src/infra/windows_credentials.ts`:

```ts
import { win32 } from "node:path";

export async function credentialFilePath(
  appDataDir: string,
  provider: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(provider);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hash = Array.from(digest, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return win32.join(appDataDir, "credentials", `${hash}.bin`);
}

export function encodePowerShellCommand(script: string): string {
  const bytes = new Uint8Array(script.length * 2);
  for (let index = 0; index < script.length; index++) {
    const code = script.charCodeAt(index);
    bytes[index * 2] = code & 0xff;
    bytes[index * 2 + 1] = code >>> 8;
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}
```

- [ ] **Step 4: Implement protected write/read/delete**

Use two fixed PowerShell scripts. The write script reads plaintext from
`[Console]::In.ReadToEnd()`, calls:

```powershell
[Security.Cryptography.ProtectedData]::Protect(
  $bytes,
  $null,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
```

and writes bytes to `$env:PI_A_CREDENTIAL_PATH`. The read script calls
`Unprotect` with the same scope and writes UTF-8 plaintext to stdout.

The default runner must:

```ts
const child = new Deno.Command("powershell.exe", {
  args: [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-ExecutionPolicy",
    "Bypass",
    "-EncodedCommand",
    encodePowerShellCommand(script),
  ],
  env: { PI_A_CREDENTIAL_PATH: path },
  stdin: "piped",
  stdout: "piped",
  stderr: "piped",
}).spawn();
```

Write the secret to `child.stdin`, close it, and await `child.output()`. On a
non-zero exit, throw an error containing only the exit code and at most 500
characters of stderr. In `set`, replace every occurrence of the plaintext secret
in an outward error with `[REDACTED]`.

The store must create `win32.dirname(path)` recursively before writing, check
existence before reading, and ignore only `Deno.errors.NotFound` during delete.

- [ ] **Step 5: Run adapter tests and verify GREEN**

Run:

```bash
/Users/xiaozhongyuan/.deno/bin/deno test --allow-read --allow-write --allow-env --allow-run src/infra/windows_credentials_test.ts
```

Expected: all DPAPI adapter tests pass.

### Task 3: Route Keychain Calls by Platform

**Files:**
- Create: `src/infra/keychain_test.ts`
- Modify: `src/infra/keychain.ts`

- [ ] **Step 1: Write failing platform-routing tests**

Add a factory with injected dependencies to the desired API:

```ts
export function createKeychainService(options: {
  platform: SupportedPlatform;
  env: (name: string) => string | undefined;
  windowsStore: WindowsCredentialStore;
  loadKeytar: () => Promise<KeytarAdapter>;
}): KeychainService;
```

Tests must assert:

```ts
Deno.test("Windows routes get set and delete to DPAPI", async () => {
  // Call all three methods and assert only the fake windows store was used.
});

Deno.test("macOS preserves keytar get set and delete", async () => {
  // Call all three methods and assert the injected keytar adapter received
  // service "pi-a" and the provider.
});

Deno.test("environment API key still wins before platform storage", async () => {
  // Return DEEPSEEK_API_KEY from env and assert neither backend is loaded.
});
```

- [ ] **Step 2: Run the tests and verify RED**

Run:

```bash
/Users/xiaozhongyuan/.deno/bin/deno test --allow-env src/infra/keychain_test.ts
```

Expected: FAIL because `createKeychainService` does not exist.

- [ ] **Step 3: Implement the keychain service factory**

Keep `SERVICE = "pi-a"` and `providerToEnvKey`. Define:

```ts
export interface KeychainService {
  getApiKey(provider: string): Promise<string | undefined>;
  setApiKey(provider: string, key: string): Promise<void>;
  deleteApiKey(provider: string): Promise<void>;
}
```

Behavior:

```ts
if (envValue) return envValue;
if (platform === "windows") return windowsStore.get(provider);
const keytar = await loadKeytar();
return (await keytar.getPassword(SERVICE, provider)) ?? undefined;
```

Set and delete use the Windows store on Windows and existing keytar calls on all
other platforms. Preserve the current read warning-and-undefined behavior.

Create the production service with `currentPlatform`, `Deno.env.get`,
`createWindowsCredentialStore({ appDataDir: platformPaths.appDataDir })`, and
`await import("keytar")`. Existing named exports delegate to that service, so no
call sites change.

- [ ] **Step 4: Run routing and adapter tests and verify GREEN**

Run:

```bash
/Users/xiaozhongyuan/.deno/bin/deno test --allow-env --allow-read --allow-write --allow-run \
  src/infra/keychain_test.ts src/infra/windows_credentials_test.ts
```

Expected: all tests pass.

### Task 4: Verify and Rebuild Windows Artifacts

**Files:**
- Modify only if verification exposes a defect in files listed above.

- [ ] **Step 1: Run focused regression tests**

Run:

```bash
/Users/xiaozhongyuan/.deno/bin/deno test --allow-read --allow-write --allow-env --allow-run \
  deno_windows_bootstrap_test.ts \
  src/infra/windows_credentials_test.ts \
  src/infra/keychain_test.ts \
  src/platform/startup_log_test.ts \
  src/platform/window_test.ts \
  src/platform/paths_test.ts
```

Expected: all tests pass.

- [ ] **Step 2: Type-check both platform configurations**

Run:

```bash
/Users/xiaozhongyuan/.deno/bin/deno check main.ts windows_bootstrap.ts
/Users/xiaozhongyuan/.deno/bin/deno check --config deno.windows.json windows_bootstrap.ts
```

Expected: both commands exit 0.

- [ ] **Step 3: Rebuild Windows portable and MSI packages**

Run:

```bash
PATH="/Users/xiaozhongyuan/.deno/bin:$PATH" deno task build:windows
```

Expected: frontend build, portable build, `runtime.dll` normalization, MSI build,
and MSI staging all complete successfully. No warning may state that the host
`node_modules` is incompatible with the Windows target.

- [ ] **Step 4: Inspect final binaries**

Run:

```bash
file dist/windows/Pi-a/Pi-a.exe dist/windows/Pi-a/runtime.dll dist/windows/Pi-a.msi
strings dist/windows/Pi-a/runtime.dll | rg "clipboard\\.win32-x64-msvc\\.node"
strings dist/windows/Pi-a/runtime.dll | rg '"n":"keytar\\.node"|"n":"clipboard\\.darwin[^"]*\\.node"'
shasum -a 256 dist/windows/Pi-a.msi
```

Expected:

- EXE and DLL are PE32+ x86-64.
- MSI is a Windows Installer package.
- Windows clipboard binding is present.
- Embedded-file entries for `keytar.node` and Darwin clipboard native modules
  produce no matches. Package metadata may still mention platform package names.
- SHA-256 is printed for handoff.

- [ ] **Step 5: Windows 10 acceptance**

On the target Windows machine:

```powershell
Get-Content "$env:LOCALAPPDATA\Pi-a\logs\startup.log" -Tail 30
```

Expected: startup reaches `desktop.ready`. Save an API key, restart Pi-a, verify
the key remains available, delete it, and verify the provider is reported as not
configured.
