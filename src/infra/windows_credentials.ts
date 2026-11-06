import { win32 } from "node:path";
import { mkdir, rm, stat } from "node:fs/promises";
import { spawn } from "node:child_process";

import {
  resolveWindowsPowerShellExecutable,
  windowsPowerShellArgs,
} from "../platform/windows_powershell.ts";
import { startOperation } from "./operation_log.ts";

export interface CredentialProcessCall {
  command: string;
  args: string[];
  env: Record<string, string>;
  stdin: string;
}

export interface CredentialProcessResult {
  code: number;
  stdout: string;
  stderr: string;
}

export type CredentialProcessRunner = (
  call: CredentialProcessCall,
) => Promise<CredentialProcessResult>;

export interface WindowsCredentialStore {
  get(provider: string): Promise<string | undefined>;
  set(provider: string, secret: string): Promise<void>;
  delete(provider: string): Promise<void>;
}

export interface WindowsCredentialStoreOptions {
  appDataDir: string;
  powershellExecutable?: string;
  runProcess?: CredentialProcessRunner;
  ensureDirectory?: (path: string) => Promise<void>;
  fileExists?: (path: string) => Promise<boolean>;
  removeFile?: (path: string) => Promise<void>;
}

const PROTECT_SCRIPT = `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security
[Console]::InputEncoding = New-Object Text.UTF8Encoding($false)
$plainText = [Console]::In.ReadToEnd()
$plainBytes = [Text.Encoding]::UTF8.GetBytes($plainText)
$protectedBytes = [Security.Cryptography.ProtectedData]::Protect(
  $plainBytes,
  $null,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
[IO.File]::WriteAllBytes($env:PI_A_CREDENTIAL_PATH, $protectedBytes)
`;

const UNPROTECT_SCRIPT = `
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.Security
$protectedBytes = [IO.File]::ReadAllBytes($env:PI_A_CREDENTIAL_PATH)
$plainBytes = [Security.Cryptography.ProtectedData]::Unprotect(
  $protectedBytes,
  $null,
  [Security.Cryptography.DataProtectionScope]::CurrentUser
)
[Console]::OutputEncoding = New-Object Text.UTF8Encoding($false)
[Console]::Out.Write([Text.Encoding]::UTF8.GetString($plainBytes))
`;

export async function credentialFilePath(
  appDataDir: string,
  provider: string,
): Promise<string> {
  const bytes = new TextEncoder().encode(provider);
  const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
  const hash = Array.from(
    digest,
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
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

export function decodePowerShellCommand(encoded: string): string {
  const binary = atob(encoded);
  let decoded = "";
  for (let index = 0; index < binary.length; index += 2) {
    decoded += String.fromCharCode(
      binary.charCodeAt(index) | (binary.charCodeAt(index + 1) << 8),
    );
  }
  return decoded;
}

const defaultProcessRunner: CredentialProcessRunner = (call) => {
  const operation = startOperation("windows.credentials.powershell", {
    command: call.command,
    argumentCount: call.args.length,
    stdinLength: call.stdin.length,
  });
  return new Promise((resolve, reject) => {
    const child = spawn(call.command, call.args, {
      env: { ...process.env, ...call.env },
      windowsHide: true,
      shell: false,
      stdio: ["pipe", "pipe", "pipe"],
    });
    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    let settled = false;
    const timeout = setTimeout(() => {
      child.kill();
      settled = true;
      const error = new Error("PowerShell credential process timed out");
      operation.error(error);
      reject(error);
    }, 30_000);

    child.stdout.on("data", (chunk: Buffer) => stdout.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      operation.error(error);
      reject(error);
    });
    child.once("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const result = {
        code: code ?? -1,
        stdout: Buffer.concat(stdout).toString("utf-8"),
        stderr: Buffer.concat(stderr).toString("utf-8"),
      };
      if (result.code === 0) operation.success({ exitCode: result.code });
      else operation.error(new Error(failureMessage("PowerShell", result)), { exitCode: result.code });
      resolve(result);
    });
    child.stdin.end(call.stdin, "utf-8");
  });
};

function processCall(
  script: string,
  path: string,
  command: string,
  stdin = "",
): CredentialProcessCall {
  return {
    command,
    args: windowsPowerShellArgs(encodePowerShellCommand(script), {
      encoded: true,
    }),
    env: { PI_A_CREDENTIAL_PATH: path },
    stdin,
  };
}

function failureMessage(
  operation: string,
  result: CredentialProcessResult,
): string {
  const stderr = result.stderr.trim().slice(0, 500);
  return `Windows DPAPI ${operation}失败（退出码 ${result.code}）${
    stderr ? `：${stderr}` : ""
  }`;
}

async function defaultFileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch (error) {
    if ((error as { code?: string }).code === "ENOENT") return false;
    throw error;
  }
}

export function createWindowsCredentialStore(
  options: WindowsCredentialStoreOptions,
): WindowsCredentialStore {
  const runProcess = options.runProcess || defaultProcessRunner;
  const powershellExecutable = options.powershellExecutable ||
    resolveWindowsPowerShellExecutable();
  const ensureDirectory = options.ensureDirectory ||
    ((path: string) => mkdir(path, { recursive: true }));
  const fileExists = options.fileExists || defaultFileExists;
  const removeFile = options.removeFile || rm;

  return {
    async get(provider) {
      const operation = startOperation("windows.credentials.get", { provider });
      try {
        const path = await credentialFilePath(options.appDataDir, provider);
        if (!(await fileExists(path))) {
          operation.success({ exists: false });
          return undefined;
        }
        const result = await runProcess(
          processCall(UNPROTECT_SCRIPT, path, powershellExecutable),
        );
        if (result.code !== 0) {
          throw new Error(failureMessage("解密", result));
        }
        operation.success({ exists: true });
        return result.stdout || undefined;
      } catch (error) {
        operation.error(error);
        throw error;
      }
    },

    async set(provider, secret) {
      const operation = startOperation("windows.credentials.set", {
        provider,
        inputLength: secret.length,
      });
      try {
        const path = await credentialFilePath(options.appDataDir, provider);
        await ensureDirectory(win32.dirname(path));
        const result = await runProcess(
          processCall(PROTECT_SCRIPT, path, powershellExecutable, secret),
        );
        if (result.code !== 0) {
          throw new Error(failureMessage("加密", result));
        }
        operation.success({ exitCode: result.code });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        operation.error(error);
        throw new Error(
          `Windows DPAPI 加密失败：${message.replaceAll(secret, "[REDACTED]")}`,
        );
      }
    },

    async delete(provider) {
      const operation = startOperation("windows.credentials.delete", { provider });
      try {
        const path = await credentialFilePath(options.appDataDir, provider);
        await removeFile(path);
        operation.success({ existed: true });
      } catch (error) {
        if ((error as { code?: string }).code === "ENOENT") {
          operation.success({ existed: false });
          return;
        }
        operation.error(error);
        throw error;
      }
    },
  };
}
