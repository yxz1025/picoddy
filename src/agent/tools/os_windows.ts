import {
  resolveWindowsPowerShellExecutable,
  windowsPowerShellArgs,
} from "../../platform/windows_powershell.ts";
import { runWindowsProcessNoWindow } from "../../platform/windows_process.ts";

export interface WindowsComputerProcessCall {
  command: string;
  args: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
}

export type WindowsComputerProcessRunner = (
  call: WindowsComputerProcessCall,
) => Promise<{ stdout: string }>;

async function defaultRunner(
  call: WindowsComputerProcessCall,
): Promise<{ stdout: string }> {
  const result = await runWindowsProcessNoWindow({
    command: call.command,
    args: call.args,
    env: call.env,
    timeoutMs: call.timeoutMs ?? 30_000,
  });
  if (result.timedOut) {
    throw new Error("Windows Computer Use 操作超时");
  }
  const stdout = new TextDecoder().decode(result.stdout).trim();
  const stderr = new TextDecoder().decode(result.stderr).trim();
  if (!result.success) {
    throw new Error(stderr || `PowerShell 退出码 ${result.code}`);
  }
  return { stdout };
}

const MOUSE_NATIVE = String.raw`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PiAMouse {
  [DllImport("user32.dll")] public static extern void mouse_event(uint f, uint x, uint y, int data, UIntPtr extra);
}
'@`;

const CLICK_SCRIPT = MOUSE_NATIVE + String.raw`
$x=[int]$env:PI_A_X; $y=[int]$env:PI_A_Y; $action=$env:PI_A_CLICK
$original=[System.Windows.Forms.Cursor]::Position
[System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point($x,$y)
$down=2; $up=4
if ($action -eq 'right_click') { $down=8; $up=16 }
if ($action -eq 'middle_click') { $down=32; $up=64 }
$count=1
if ($action -eq 'double_click') { $count=2 }
if ($action -eq 'triple_click') { $count=3 }
for ($i=0; $i -lt $count; $i++) {
  [PiAMouse]::mouse_event($down,0,0,0,[UIntPtr]::Zero)
  [PiAMouse]::mouse_event($up,0,0,0,[UIntPtr]::Zero)
  if ($i+1 -lt $count) { Start-Sleep -Milliseconds 80 }
}
[System.Windows.Forms.Cursor]::Position=$original`;

const MOVE_SCRIPT = String.raw`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Cursor]::Position=New-Object System.Drawing.Point([int]$env:PI_A_X,[int]$env:PI_A_Y)`;

const SCROLL_SCRIPT = MOUSE_NATIVE + String.raw`
$flag=2048
if ($env:PI_A_HORIZONTAL -eq '1') { $flag=4096 }
[PiAMouse]::mouse_event($flag,0,0,[int]$env:PI_A_SCROLL,[UIntPtr]::Zero)`;

const TYPE_SCRIPT = String.raw`
Add-Type -AssemblyName System.Windows.Forms
$old=$null
try { if ([System.Windows.Forms.Clipboard]::ContainsText()) { $old=[System.Windows.Forms.Clipboard]::GetText() } } catch {}
[System.Windows.Forms.Clipboard]::SetText($env:PI_A_TEXT)
[System.Windows.Forms.SendKeys]::SendWait('^v')
Start-Sleep -Milliseconds 50
try {
  if ($null -ne $old) { [System.Windows.Forms.Clipboard]::SetText($old) }
  else { [System.Windows.Forms.Clipboard]::Clear() }
} catch {}`;

const KEY_SCRIPT = String.raw`
Add-Type -AssemblyName System.Windows.Forms
[System.Windows.Forms.SendKeys]::SendWait($env:PI_A_KEYS)`;

const SCREENSHOT_SCRIPT = String.raw`
Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
$bounds=[System.Windows.Forms.SystemInformation]::VirtualScreen
$bitmap=New-Object System.Drawing.Bitmap($bounds.Width,$bounds.Height)
$graphics=[System.Drawing.Graphics]::FromImage($bitmap)
try {
  $graphics.CopyFromScreen($bounds.Location,[System.Drawing.Point]::Empty,$bounds.Size)
  $bitmap.Save($env:PI_A_SCREENSHOT,[System.Drawing.Imaging.ImageFormat]::Png)
} finally { $graphics.Dispose(); $bitmap.Dispose() }`;

const METRICS_SCRIPT = String.raw`
Add-Type -AssemblyName System.Windows.Forms
$b=[System.Windows.Forms.SystemInformation]::VirtualScreen
[Console]::Out.Write(('{0},{1},{2},{3}' -f $b.X,$b.Y,$b.Width,$b.Height))`;

const CURSOR_SCRIPT = String.raw`
Add-Type -AssemblyName System.Windows.Forms
$p=[System.Windows.Forms.Cursor]::Position
[Console]::Out.Write(('{0},{1}' -f $p.X,$p.Y))`;

const FOCUS_SCRIPT = String.raw`
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class PiAWindow {
  [DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
  [DllImport("user32.dll")] public static extern bool ShowWindowAsync(IntPtr h, int n);
}
'@
$name=$env:PI_A_APP
$p=Get-Process | Where-Object {
  $_.MainWindowHandle -ne 0 -and
  ($_.ProcessName -ieq $name -or $_.MainWindowTitle -like ('*'+$name+'*'))
} | Select-Object -First 1
if ($null -eq $p) { throw "找不到应用窗口: $name" }
[void][PiAWindow]::ShowWindowAsync($p.MainWindowHandle,9)
[void][PiAWindow]::SetForegroundWindow($p.MainWindowHandle)`;

function keyToSendKeys(input: string): string {
  const parts = input.toLowerCase().split("+").map((part) => part.trim());
  const key = parts.pop() ?? "";
  const modifiers = parts.map((part) => {
    if (
      part === "ctrl" || part === "control" || part === "cmd" ||
      part === "command"
    ) return "^";
    if (part === "alt" || part === "option") return "%";
    if (part === "shift") return "+";
    throw new Error(`Windows 不支持修饰键: ${part}`);
  }).join("");
  const names: Record<string, string> = {
    enter: "{ENTER}",
    return: "{ENTER}",
    tab: "{TAB}",
    escape: "{ESC}",
    esc: "{ESC}",
    space: " ",
    backspace: "{BACKSPACE}",
    delete: "{DELETE}",
    up: "{UP}",
    down: "{DOWN}",
    left: "{LEFT}",
    right: "{RIGHT}",
    home: "{HOME}",
    end: "{END}",
    pageup: "{PGUP}",
    pagedown: "{PGDN}",
  };
  const encoded = names[key] ?? (/^[a-z0-9]$/.test(key) ? key : "");
  if (!encoded) throw new Error(`Windows 不支持按键: ${key}`);
  return modifiers + encoded;
}

export function createWindowsComputerBackend(
  runner: WindowsComputerProcessRunner = defaultRunner,
) {
  const run = (script: string, env?: Record<string, string>) =>
    runner({
      command: resolveWindowsPowerShellExecutable(),
      args: windowsPowerShellArgs(script, { sta: true }),
      env,
      timeoutMs: 30_000,
    });

  return {
    screenshot: (path: string) =>
      run(SCREENSHOT_SCRIPT, { PI_A_SCREENSHOT: path }),
    async getDisplayMetrics() {
      const { stdout } = await run(METRICS_SCRIPT);
      const [x, y, width, height] = stdout.split(",").map(Number);
      if (![x, y, width, height].every(Number.isFinite)) {
        throw new Error("无法解析 Windows 屏幕尺寸");
      }
      return { x, y, width, height, scaleFactor: 1 };
    },
    click: (
      x: number,
      y: number,
      action:
        | "left_click"
        | "right_click"
        | "double_click"
        | "triple_click"
        | "middle_click",
    ) =>
      run(CLICK_SCRIPT, {
        PI_A_X: String(Math.round(x)),
        PI_A_Y: String(Math.round(y)),
        PI_A_CLICK: action,
      }),
    move: (x: number, y: number) =>
      run(MOVE_SCRIPT, {
        PI_A_X: String(Math.round(x)),
        PI_A_Y: String(Math.round(y)),
      }),
    typeText: (text: string) => run(TYPE_SCRIPT, { PI_A_TEXT: text }),
    pressKey: (key: string) =>
      run(KEY_SCRIPT, { PI_A_KEYS: keyToSendKeys(key) }),
    scroll: (direction: "up" | "down" | "left" | "right", amount: number) => {
      const distance = Math.max(1, Math.min(Math.round(amount), 100)) * 120;
      const sign = direction === "down" || direction === "right" ? -1 : 1;
      return run(SCROLL_SCRIPT, {
        PI_A_SCROLL: String(sign * distance),
        PI_A_HORIZONTAL: direction === "left" || direction === "right"
          ? "1"
          : "0",
      });
    },
    async cursorPosition() {
      const { stdout } = await run(CURSOR_SCRIPT);
      const [x, y] = stdout.split(",").map(Number);
      if (![x, y].every(Number.isFinite)) {
        throw new Error("无法解析 Windows 光标位置");
      }
      return { x, y };
    },
    focusApplication: (name: string) => run(FOCUS_SCRIPT, { PI_A_APP: name }),
  };
}
