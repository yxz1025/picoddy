import type { SupportedPlatform } from "./runtime.ts";
import { type ProcessCall, type ProcessRunner, runProcess } from "./process.ts";
import {
  resolveWindowsPowerShellExecutable,
  windowsPowerShellArgs,
} from "./windows_powershell.ts";

export type { ProcessCall, ProcessRunner } from "./process.ts";

const WINDOWS_OPEN_SCRIPT =
  "$p=$env:PI_A_TARGET_PATH; if ([string]::IsNullOrWhiteSpace($p)) { exit 2 }; Start-Process -FilePath $p";
const WINDOWS_PICK_DIR_SCRIPT =
  "Add-Type -AssemblyName System.Windows.Forms; $d=New-Object System.Windows.Forms.FolderBrowserDialog; if ($d.ShowDialog() -eq [System.Windows.Forms.DialogResult]::OK) { [Console]::Out.Write($d.SelectedPath) }";
const WINDOWS_FOREGROUND_SCRIPT =
  'Add-Type @"\nusing System;\nusing System.Runtime.InteropServices;\npublic static class PiAWindow { [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow(); [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint p); }\n"@; $p=0; [void][PiAWindow]::GetWindowThreadProcessId([PiAWindow]::GetForegroundWindow(), [ref]$p); if ($p) { (Get-Process -Id $p).ProcessName }';
const WINDOWS_SELECTION_SCRIPT =
  'Add-Type -AssemblyName UIAutomationClient; $e=[System.Windows.Automation.AutomationElement]::FocusedElement; if ($null -ne $e) { $p=$null; if ($e.TryGetCurrentPattern([System.Windows.Automation.TextPattern]::Pattern,[ref]$p)) { $parts=@(); foreach ($r in $p.GetSelection()) { $parts += $r.GetText(-1) }; [Console]::Out.Write(($parts -join "`n")) } }';

export interface ShellAdapter {
  openPath(path: string): Promise<void>;
  pickDirectory(): Promise<string | null>;
  readClipboardText(): Promise<string>;
  getForegroundApplication(): Promise<string>;
  readSelectedText?(): Promise<string>;
}

function powershellCall(
  script: string,
  options: { sta?: boolean; env?: Record<string, string> } = {},
): ProcessCall {
  return {
    command: resolveWindowsPowerShellExecutable(),
    args: windowsPowerShellArgs(script, { sta: options.sta }),
    env: options.env,
    timeoutMs: 30_000,
  };
}

export function createShellAdapter(
  os: SupportedPlatform,
  runner: ProcessRunner = runProcess,
): ShellAdapter {
  if (os === "darwin") {
    return {
      async openPath(path) {
        await runner({ command: "open", args: [path], timeoutMs: 15_000 });
      },
      async pickDirectory() {
        const result = await runner({
          command: "osascript",
          args: [
            "-e",
            "try",
            "-e",
            'set chosenFolder to choose folder with prompt "选择工作空间文件夹"',
            "-e",
            "return POSIX path of chosenFolder",
            "-e",
            "on error number -128",
            "-e",
            'return ""',
            "-e",
            "end try",
          ],
          timeoutMs: 120_000,
        });
        return result.stdout.trim() || null;
      },
      async readClipboardText() {
        return (await runner({
          command: "pbpaste",
          args: [],
          timeoutMs: 5_000,
        })).stdout.trim();
      },
      async getForegroundApplication() {
        return (await runner({
          command: "osascript",
          args: [
            "-e",
            'tell application "System Events" to name of first process whose frontmost is true',
          ],
          timeoutMs: 5_000,
        })).stdout.trim();
      },
    };
  }
  if (os === "windows") {
    return {
      async openPath(path) {
        await runner(powershellCall(WINDOWS_OPEN_SCRIPT, {
          env: { PI_A_TARGET_PATH: path },
        }));
      },
      async pickDirectory() {
        const result = await runner(
          powershellCall(WINDOWS_PICK_DIR_SCRIPT, { sta: true }),
        );
        return result.stdout.trim() || null;
      },
      async readClipboardText() {
        return (await runner(
          powershellCall("Get-Clipboard -Raw"),
        )).stdout.trim();
      },
      async getForegroundApplication() {
        return (await runner(
          powershellCall(WINDOWS_FOREGROUND_SCRIPT),
        )).stdout.trim();
      },
      async readSelectedText() {
        return (await runner(
          powershellCall(WINDOWS_SELECTION_SCRIPT),
        )).stdout.trim();
      },
    };
  }
  const unsupported = async (): Promise<never> => {
    throw new Error(`当前平台 ${os} 不支持此桌面能力`);
  };
  return {
    openPath: unsupported,
    pickDirectory: unsupported,
    readClipboardText: unsupported,
    getForegroundApplication: unsupported,
  };
}
