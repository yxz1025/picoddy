import { win32 } from "node:path";

export interface WindowsPowerShellArgsOptions {
  sta?: boolean;
  encoded?: boolean;
}

export function resolveWindowsPowerShellExecutable(
  env: (name: string) => string | undefined = (name) => process.env[name],
): string {
  const systemRoot = env("SystemRoot")?.trim() || env("WINDIR")?.trim() ||
    "C:\\Windows";
  return win32.join(
    systemRoot,
    "System32",
    "WindowsPowerShell",
    "v1.0",
    "powershell.exe",
  );
}

export function windowsPowerShellArgs(
  script: string,
  options: WindowsPowerShellArgsOptions = {},
): string[] {
  return [
    "-NoLogo",
    "-NoProfile",
    "-NonInteractive",
    "-WindowStyle",
    "Hidden",
    "-ExecutionPolicy",
    "Bypass",
    ...(options.sta ? ["-STA"] : []),
    options.encoded ? "-EncodedCommand" : "-Command",
    script,
  ];
}
