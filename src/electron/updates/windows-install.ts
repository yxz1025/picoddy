import { execFile, spawn } from "node:child_process";
import { win32 } from "node:path";

// Fixed local launcher: the verified cache path is passed as data, never as
// PowerShell source. Start-Process returns only after the UAC decision, without
// waiting for NSIS (which needs the current application to exit).
export const elevationScript = [
  "$ErrorActionPreference = 'Stop'",
  "try {",
  "  $p = Start-Process -FilePath $env:PICODDY_UPDATE_INSTALLER -ArgumentList @('--updated', '--force-run', '/allusers') -Verb RunAs -PassThru -ErrorAction Stop",
  "  if ($null -eq $p) { exit 1 }",
  "  exit 0",
  "} catch { exit 1 }",
].join("\n");

export async function launchWindowsInstaller(file: string, elevated: boolean,
  processes: { spawn: typeof spawn; execFile: typeof execFile } = { spawn, execFile }): Promise<void> {
  if (elevated) {
    const systemRoot = process.env.SystemRoot;
    if (!systemRoot || !win32.isAbsolute(systemRoot)) throw new Error("INSTALL_PERMISSION");
    await new Promise<void>((resolve, reject) => {
      processes.execFile(win32.join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe"),
        ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(elevationScript, "utf16le").toString("base64")],
        { windowsHide: true, env: { ...process.env, PICODDY_UPDATE_INSTALLER: file } },
        (error) => error ? reject(new Error("INSTALL_PERMISSION")) : resolve());
    });
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const child = processes.spawn(file, ["--updated", "--force-run", "/currentuser"], { detached: true, stdio: "ignore", shell: false });
    child.once("error", () => reject(new Error("INSTALL_PERMISSION")));
    child.once("spawn", () => { child.unref(); resolve(); });
  });
}
