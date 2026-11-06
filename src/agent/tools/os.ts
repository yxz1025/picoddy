// src/agent/tools/os.ts
// Computer Use 工具：对标 CodeX / Anthropic 规范
// 支持 Anthropic 统一规范 computer 工具与单项工具 (screenshot/mouse_click/key_type 等)
// 支持 Retina 高分屏缩放换算 & cliclick + 原生 AppleScript 双模式自动降级。

import { Type } from "typebox";
import { mkdir, readFile } from "node:fs/promises";
const platformOs = process.platform === "win32" ? "windows" : process.platform;

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { platformPaths } from "../../platform/paths.ts";
import type { SupportedPlatform } from "../../platform/runtime.ts";
import { createWindowsComputerBackend } from "./os_windows.ts";
import {
  resolveWindowsPowerShellExecutable,
  windowsPowerShellArgs,
} from "../../platform/windows_powershell.ts";
import { runWindowsProcessNoWindow } from "../../platform/windows_process.ts";

const SHOTS_DIR = platformPaths.join(platformPaths.appDataDir, "screenshots");

async function ensureShotsDir(): Promise<void> {
  try {
    await mkdir(SHOTS_DIR, { recursive: true });
  } catch { /* 已存在 */ }
}

/** Uint8Array → base64（分块防栈溢出） */
function toBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** 检测 cliclick 是否安装 */
export async function hasCliclick(
  os: SupportedPlatform = platformOs as SupportedPlatform,
): Promise<boolean> {
  if (os !== "darwin") return false;
  try {
    const { spawnSync: s } = require("node:child_process");
    return s("which", ["cliclick"], { stdio: "ignore" }).status === 0;
  } catch {
    return false;
  }
}

/** 运行命令，成功返回 stdout，失败抛错 */
async function runCmd(name: string, args: string[]): Promise<string> {
  if (platformOs === "windows") {
    const result = await runWindowsProcessNoWindow({
      command: name,
      args,
      timeoutMs: 30_000,
    });
    const stdout = new TextDecoder().decode(result.stdout).trim();
    const stderr = new TextDecoder().decode(result.stderr).trim();
    if (!result.success) {
      throw new Error(stderr || `${name} 退出码 ${result.code}`);
    }
    return stdout;
  }
  const { spawnSync: s } = require("node:child_process");
  const r = s(name, args);
  const stdout = new TextDecoder().decode(r.stdout ?? new Uint8Array()).trim();
  const stderr = new TextDecoder().decode(r.stderr ?? new Uint8Array()).trim();
  if (r.status !== 0) throw new Error(stderr || `${name} 退出码 ${r.status}`);
  return stdout;
}

/** 屏幕与分辨率信息 */
export interface DisplayMetrics {
  width: number;
  height: number;
  scaleFactor: number;
}

/** 获取 macOS 屏幕分辨率与 Retina 缩放倍率（纯静默检测，绝对不出 screencapture 触发系统弹窗） */
export async function getDisplayMetrics(
  os: SupportedPlatform = platformOs as SupportedPlatform,
  getWindowsMetrics: () => Promise<DisplayMetrics> = async () => {
    const metrics = await windowsComputer.getDisplayMetrics();
    return {
      width: metrics.width,
      height: metrics.height,
      scaleFactor: metrics.scaleFactor,
    };
  },
): Promise<DisplayMetrics> {
  if (os === "windows") {
    return await getWindowsMetrics();
  }
  try {
    const script = `
      tell application "Finder"
        set b to bounds of window of desktop
        return (item 3 of b as string) & "x" & (item 4 of b as string)
      end tell
    `;
    const out = await runCmd("osascript", ["-e", script]);
    const m = out.match(/(\d+)x(\d+)/);
    const logicalW = m ? parseInt(m[1], 10) : 1440;
    const logicalH = m ? parseInt(m[2], 10) : 900;
    const scaleFactor = logicalW <= 2000 ? 2.0 : 1.0;

    return { width: logicalW, height: logicalH, scaleFactor };
  } catch {
    return { width: 1440, height: 900, scaleFactor: 2.0 };
  }
}

/** 辅助函数：转义 AppleScript 字符串 */
function escapeAppleScript(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** 原生 AppleScript 点击降级 */
async function appleScriptClick(
  x: number,
  y: number,
  action: "left" | "right" | "double" = "left",
): Promise<void> {
  if (action === "right") {
    const script = `
      tell application "System Events"
        click at {${Math.round(x)}, ${Math.round(y)}} using {control down}
      end tell
    `;
    await runCmd("osascript", ["-e", script]);
  } else if (action === "double") {
    const script = `
      tell application "System Events"
        click at {${Math.round(x)}, ${Math.round(y)}}
        delay 0.1
        click at {${Math.round(x)}, ${Math.round(y)}}
      end tell
    `;
    await runCmd("osascript", ["-e", script]);
  } else {
    const script = `
      tell application "System Events"
        click at {${Math.round(x)}, ${Math.round(y)}}
      end tell
    `;
    await runCmd("osascript", ["-e", script]);
  }
}

/** 静默无位移点击算法：在目标坐标执行点击后，毫秒级恢复用户原本的鼠标指针位置（支持 macOS 与 Windows） */
async function performSilentClick(
  x: number,
  y: number,
  action:
    | "left_click"
    | "right_click"
    | "double_click"
    | "triple_click"
    | "middle_click" = "left_click",
  isCliclickInstalled = false,
): Promise<void> {
  const isMac = platformOs === "darwin";
  const isWin = platformOs === "windows";

  if (isMac) {
    if (isCliclickInstalled) {
      let origX: string | undefined;
      let origY: string | undefined;
      try {
        const pOut = await runCmd("cliclick", ["p"]);
        const parts = pOut.split(",");
        if (parts.length === 2) {
          origX = parts[0].trim();
          origY = parts[1].trim();
        }
      } catch {}

      let code = "c";
      if (action === "right_click") code = "rc";
      else if (action === "double_click" || action === "triple_click") {
        code = "dc";
      } else if (action === "middle_click") code = "mc";

      if (origX && origY) {
        // 在单个 process 指令中完成点击与毫秒级坐标归位，鼠标指针对用户零打扰
        await runCmd("cliclick", [`${code}:${x},${y}`, `m:${origX},${origY}`]);
      } else {
        await runCmd("cliclick", [`${code}:${x},${y}`]);
      }
      return;
    }

    const act = action === "right_click"
      ? "right"
      : (action === "double_click" ? "double" : "left");
    await appleScriptClick(x, y, act);
    return;
  }

  if (isWin) {
    const flagDown = action === "right_click" ? 0x0008 : 0x0002;
    const flagUp = action === "right_click" ? 0x0010 : 0x0004;
    const psScript = `
      Add-Type -AssemblyName System.Windows.Forms
      Add-Type -AssemblyName System.Drawing
      $orig = [System.Windows.Forms.Cursor]::Position
      [System.Windows.Forms.Cursor]::Position = New-Object System.Drawing.Point(${
      Math.round(x)
    }, ${Math.round(y)})
      $signature = '[DllImport("user32.dll")] public static extern void mouse_event(int flags, int dx, int dy, int cButtons, int dwExtraInfo);'
      $type = Add-Type -MemberDefinition $signature -Name 'Win32Mouse' -Namespace 'Win32' -PassThru
      $type::mouse_event(${flagDown}, 0, 0, 0, 0)
      $type::mouse_event(${flagUp}, 0, 0, 0, 0)
      [System.Windows.Forms.Cursor]::Position = $orig
    `;
    try {
      await runCmd(
        resolveWindowsPowerShellExecutable(),
        windowsPowerShellArgs(psScript),
      );
    } catch (e) {
      console.error("[os.ts] Windows silent click error:", e);
    }
  }
}

/** 原生 AppleScript 文本输入降级 */
async function appleScriptType(text: string): Promise<void> {
  const safeText = escapeAppleScript(text);
  const script = `
    tell application "System Events"
      keystroke "${safeText}"
    end tell
  `;
  await runCmd("osascript", ["-e", script]);
}

/** 原生 AppleScript 按键降级 (回车, Tab, Esc 等) */
async function appleScriptKey(keyStr: string): Promise<void> {
  const k = keyStr.toLowerCase().trim();
  let script = "";
  if (k === "return" || k === "enter") {
    script = `tell application "System Events" to key code 36`;
  } else if (k === "tab") {
    script = `tell application "System Events" to key code 48`;
  } else if (k === "space") {
    script = `tell application "System Events" to key code 49`;
  } else if (k === "escape" || k === "esc") {
    script = `tell application "System Events" to key code 53`;
  } else if (k === "backspace" || k === "delete") {
    script = `tell application "System Events" to key code 51`;
  } else if (k.includes("+")) {
    const parts = k.split("+").map((p) => p.trim());
    const mainKey = parts[parts.length - 1];
    const mods = parts.slice(0, -1);
    const modMap: Record<string, string> = {
      cmd: "command down",
      command: "command down",
      ctrl: "control down",
      control: "control down",
      alt: "option down",
      opt: "option down",
      option: "option down",
      shift: "shift down",
    };
    const modCodes = mods.map((m) => modMap[m]).filter(Boolean);
    const modStr = modCodes.length > 0 ? ` using {${modCodes.join(", ")}}` : "";
    script = `tell application "System Events" to keystroke "${
      escapeAppleScript(mainKey)
    }"${modStr}`;
  } else {
    script = `tell application "System Events" to keystroke "${
      escapeAppleScript(k)
    }"`;
  }
  await runCmd("osascript", ["-e", script]);
}

/** 原生 AppleScript 滚动降级 */
async function appleScriptScroll(
  direction: "up" | "down" | "left" | "right",
  amount: number = 5,
): Promise<void> {
  const isDown = direction === "down";
  const script = `
    tell application "System Events"
      repeat ${Math.min(amount, 20)} times
        key code ${isDown ? 125 : 126}
      end repeat
    end tell
  `;
  await runCmd("osascript", ["-e", script]);
}

const windowsComputer = createWindowsComputerBackend();

async function executeWindowsComputerAction(p: any): Promise<any> {
  const action = p.action as string;
  try {
    if (action === "screenshot") {
      await ensureShotsDir();
      const path = platformPaths.join(SHOTS_DIR, `shot-${Date.now()}.png`);
      await windowsComputer.screenshot(path);
      const bytes = await readFile(path);
      const metrics = await windowsComputer.getDisplayMetrics();
      return {
        content: [
          {
            type: "image" as const,
            data: toBase64(bytes),
            mimeType: "image/png",
          },
          {
            type: "text" as const,
            text:
              `✓ Windows 屏幕截图成功 (${metrics.width}x${metrics.height})。文件: ${path}`,
          },
        ],
        details: { path, action, metrics },
      };
    }

    if (
      action === "left_click" || action === "right_click" ||
      action === "double_click" || action === "triple_click" ||
      action === "middle_click"
    ) {
      if (!p.coordinate) {
        throw new Error(`动作 ${action} 必须包含 coordinate: [x, y]`);
      }
      const [x, y] = p.coordinate;
      await windowsComputer.click(x, y, action);
      return {
        content: [{
          type: "text",
          text: `✓ 已在坐标 (${x}, ${y}) 执行 ${action}`,
        }],
        details: { action, x, y, method: "win32-user32" },
      };
    }

    if (action === "mouse_move") {
      if (!p.coordinate) {
        throw new Error("动作 mouse_move 必须包含 coordinate: [x, y]");
      }
      const [x, y] = p.coordinate;
      await windowsComputer.move(x, y);
      return {
        content: [{ type: "text", text: `✓ 已移动鼠标到坐标 (${x}, ${y})` }],
        details: { action, x, y },
      };
    }

    if (action === "type") {
      if (!p.text) throw new Error("动作 type 必须填写 text 字符串");
      await windowsComputer.typeText(p.text);
      return {
        content: [{
          type: "text",
          text: `✓ 已输入文本: "${p.text.slice(0, 60)}${
            p.text.length > 60 ? "..." : ""
          }"`,
        }],
        details: { action, text: p.text },
      };
    }

    if (action === "key" || action === "press_hotkey") {
      const key = p.key || p.text || "";
      if (!key) throw new Error("动作 key 必须填写 key 参数");
      await windowsComputer.pressKey(key);
      return {
        content: [{ type: "text", text: `✓ 已按键: ${key}` }],
        details: { action, key },
      };
    }

    if (action === "scroll") {
      const direction = p.direction || "down";
      const amount = p.amount || 5;
      await windowsComputer.scroll(direction, amount);
      return {
        content: [{
          type: "text",
          text: `✓ 已向 ${direction} 滚动 ${amount} 单位`,
        }],
        details: { action, direction, amount },
      };
    }

    if (action === "app_focus") {
      const app = p.app_name || p.text || "";
      if (!app) throw new Error("动作 app_focus 必须填写 app_name");
      await windowsComputer.focusApplication(app);
      return {
        content: [{ type: "text", text: `✓ 已前台激活应用: ${app}` }],
        details: { action, app },
      };
    }

    if (action === "cursor_position") {
      const position = await windowsComputer.cursorPosition();
      return {
        content: [{
          type: "text",
          text: `当前鼠标坐标: (${position.x}, ${position.y})`,
        }],
        details: { action, ...position },
      };
    }

    throw new Error(`未知动作: ${action}`);
  } catch (error) {
    return {
      content: [{
        type: "text",
        text: `❌ Windows Computer Use 操作失败: ${(error as Error).message}`,
      }],
      details: { action, isError: true },
    };
  }
}

// ===== CodeX / Anthropic 规范: 统一 computer 工具 =====
const computerSchema = Type.Object({
  action: Type.Union([
    Type.Literal("screenshot"),
    Type.Literal("left_click"),
    Type.Literal("right_click"),
    Type.Literal("double_click"),
    Type.Literal("triple_click"),
    Type.Literal("middle_click"),
    Type.Literal("mouse_move"),
    Type.Literal("left_click_drag"),
    Type.Literal("type"),
    Type.Literal("key"),
    Type.Literal("press_hotkey"),
    Type.Literal("scroll"),
    Type.Literal("cursor_position"),
    Type.Literal("app_focus"),
  ], { description: "要执行的操控动作" }),
  coordinate: Type.Optional(
    // 用 Array 而不是 Tuple：Tuple 生成的 items 数组写法是 draft-07，
    // Anthropic 只接受 JSON Schema 2020-12，会直接 400。
    Type.Array(Type.Number(), {
      minItems: 2,
      maxItems: 2,
      description: "目标屏幕坐标 [x, y]（逻辑坐标点）",
    }),
  ),
  text: Type.Optional(
    Type.String({ description: "动作 action 为 type 时填写的字符串" }),
  ),
  key: Type.Optional(
    Type.String({
      description:
        "动作 action 为 key 或 press_hotkey 时填写的按键（如 return, tab, cmd+c）",
    }),
  ),
  direction: Type.Optional(
    Type.Union([
      Type.Literal("up"),
      Type.Literal("down"),
      Type.Literal("left"),
      Type.Literal("right"),
    ], { description: "动作 action 为 scroll 时的方向" }),
  ),
  amount: Type.Optional(
    Type.Number({ description: "动作 action 为 scroll 时的滚动行数/距离" }),
  ),
  app_name: Type.Optional(
    Type.String({ description: "动作 action 为 app_focus 时的应用程序名" }),
  ),
});

export const computerTool: AgentTool<
  typeof computerSchema,
  { action: string; details?: any }
> = {
  name: "computer",
  label: "Computer Use (电脑掌控通道)",
  description:
    "Anthropic/CodeX 标准 Computer Use 通道工具。可实现截图自检 (screenshot)、屏幕操控 (click/move/type/key/scroll/app_focus)。屏幕操作基于点坐标或键位。",
  parameters: computerSchema,
  execute: async (_id, p) => {
    if (platformOs === "windows") {
      return await executeWindowsComputerAction(p);
    }

    const action = p.action;
    const isCliclickInstalled = await hasCliclick();
    const metrics = await getDisplayMetrics();

    if (action === "screenshot") {
      await ensureShotsDir();
      const path = `${SHOTS_DIR}/shot-${Date.now()}.png`;
      try {
        await runCmd("screencapture", ["-x", "-C", path]);
        const bytes = await readFile(path);
        const base64 = toBase64(bytes);
        return {
          content: [
            { type: "image" as const, data: base64, mimeType: "image/png" },
            {
              type: "text" as const,
              text:
                `✓ 屏幕截图成功 (尺寸: ${metrics.width}x${metrics.height}, Retina缩放比: ${metrics.scaleFactor}x)。文件: ${path}`,
            },
          ],
          details: { path, action, metrics },
        };
      } catch (e) {
        return {
          content: [{
            type: "text",
            text: `❌ 截图失败: ${
              (e as Error).message
            }\n（请在 macOS「系统设置 > 隐私与安全 > 屏幕录制」授权）`,
          }],
          details: { action, isError: true },
        };
      }
    }

    if (
      action === "left_click" || action === "right_click" ||
      action === "double_click" || action === "triple_click" ||
      action === "middle_click"
    ) {
      if (!p.coordinate) {
        return {
          content: [{
            type: "text",
            text: `❌ 动作 ${action} 必须包含 coordinate: [x, y]`,
          }],
          details: { action, isError: true },
        };
      }
      const [x, y] = p.coordinate;
      try {
        await performSilentClick(x, y, action, isCliclickInstalled);
        return {
          content: [{
            type: "text",
            text: `✓ 已在坐标 (${x}, ${y}) 静默无位移执行 ${action}`,
          }],
          details: {
            action,
            x,
            y,
            silent: true,
            method: isCliclickInstalled ? "cliclick-restore" : "native-restore",
          },
        };
      } catch (e) {
        return {
          content: [{
            type: "text",
            text: `❌ 点击操作失败: ${
              (e as Error).message
            }\n（请在 macOS「系统设置 > 隐私与安全 > 辅助功能」授权）`,
          }],
          details: { action, isError: true },
        };
      }
    }

    if (action === "mouse_move") {
      if (!p.coordinate) {
        return {
          content: [{
            type: "text",
            text: "❌ 动作 mouse_move 必须包含 coordinate: [x, y]",
          }],
          details: { action, isError: true },
        };
      }
      const [x, y] = p.coordinate;
      try {
        if (isCliclickInstalled) {
          await runCmd("cliclick", [`m:${x},${y}`]);
        } else {
          const script =
            `tell application "System Events" to set the position of cursor to {${x}, ${y}}`;
          try {
            await runCmd("osascript", ["-e", script]);
          } catch {}
        }
        return {
          content: [{ type: "text", text: `✓ 已移动鼠标到坐标 (${x}, ${y})` }],
          details: { action, x, y },
        };
      } catch (e) {
        return {
          content: [{
            type: "text",
            text: `❌ 移动失败: ${(e as Error).message}`,
          }],
          details: { action, isError: true },
        };
      }
    }

    if (action === "type") {
      const text = p.text || "";
      if (!text) {
        return {
          content: [{
            type: "text",
            text: "❌ 动作 type 必须填写 text 字符串",
          }],
          details: { action, isError: true },
        };
      }
      try {
        if (isCliclickInstalled) {
          await runCmd("cliclick", [`t:${text}`]);
        } else {
          await appleScriptType(text);
        }
        return {
          content: [{
            type: "text",
            text: `✓ 已输入文本: "${text.slice(0, 60)}${
              text.length > 60 ? "..." : ""
            }"`,
          }],
          details: { action, text },
        };
      } catch (e) {
        return {
          content: [{
            type: "text",
            text: `❌ 键入失败: ${(e as Error).message}`,
          }],
          details: { action, isError: true },
        };
      }
    }

    if (action === "key" || action === "press_hotkey") {
      const key = p.key || p.text || "";
      if (!key) {
        return {
          content: [{ type: "text", text: "❌ 动作 key 必须填写 key 参数" }],
          details: { action, isError: true },
        };
      }
      try {
        if (isCliclickInstalled) {
          await runCmd("cliclick", [`kp:${key}`]);
        } else {
          await appleScriptKey(key);
        }
        return {
          content: [{ type: "text", text: `✓ 已按键: ${key}` }],
          details: { action, key },
        };
      } catch (e) {
        return {
          content: [{
            type: "text",
            text: `❌ 按键失败: ${(e as Error).message}`,
          }],
          details: { action, isError: true },
        };
      }
    }

    if (action === "scroll") {
      const dir = p.direction || "down";
      const amt = p.amount || 5;
      try {
        await appleScriptScroll(dir, amt);
        return {
          content: [{ type: "text", text: `✓ 已向 ${dir} 滚动 ${amt} 单位` }],
          details: { action, direction: dir, amount: amt },
        };
      } catch (e) {
        return {
          content: [{
            type: "text",
            text: `❌ 滚动失败: ${(e as Error).message}`,
          }],
          details: { action, isError: true },
        };
      }
    }

    if (action === "app_focus") {
      const app = p.app_name || p.text || "";
      if (!app) {
        return {
          content: [{
            type: "text",
            text: "❌ 动作 app_focus 必须填写 app_name",
          }],
          details: { action, isError: true },
        };
      }
      try {
        await runCmd("osascript", [
          "-e",
          `tell application "${escapeAppleScript(app)}" to activate`,
        ]);
        return {
          content: [{ type: "text", text: `✓ 已前台激活应用: ${app}` }],
          details: { action, app },
        };
      } catch (e) {
        return {
          content: [{
            type: "text",
            text: `❌ 切换应用失败: ${(e as Error).message}`,
          }],
          details: { action, isError: true },
        };
      }
    }

    if (action === "cursor_position") {
      try {
        if (isCliclickInstalled) {
          const out = await runCmd("cliclick", ["p"]);
          const m = out.match(/(\d+),(\d+)/);
          if (m) {
            return {
              content: [{
                type: "text",
                text: `当前鼠标坐标: (${m[1]}, ${m[2]})`,
              }],
              details: { action, x: parseInt(m[1], 10), y: parseInt(m[2], 10) },
            };
          }
        }
        return {
          content: [{
            type: "text",
            text: `当前屏幕尺寸: ${metrics.width}x${metrics.height}`,
          }],
          details: { action, metrics },
        };
      } catch (e) {
        return {
          content: [{
            type: "text",
            text: `获取光标位置失败: ${(e as Error).message}`,
          }],
          details: { action, isError: true },
        };
      }
    }

    return {
      content: [{ type: "text", text: `未知动作: ${action}` }],
      details: { action, isError: true },
    };
  },
};

// ===== screenshot (单项工具) =====
const screenshotSchema = Type.Object({
  region: Type.Optional(Type.Object({
    x: Type.Number(),
    y: Type.Number(),
    w: Type.Number(),
    h: Type.Number(),
  }, { description: "可选：截取指定区域（不传则全屏）" })),
});

export const screenshotTool: AgentTool<
  typeof screenshotSchema,
  { path: string }
> = {
  name: "screenshot",
  label: "截图",
  description:
    "截取屏幕（或指定区域）并返回图片，供视觉分析。用于查看屏幕内容、确认操作效果。建议每次操作后截图自检。",
  parameters: screenshotSchema,
  execute: async (_id, p) => {
    if (platformOs === "windows") {
      return await executeWindowsComputerAction({ action: "screenshot" });
    }
    await ensureShotsDir();
    const path = `${SHOTS_DIR}/shot-${Date.now()}.png`;
    const args = ["-x", "-C"]; // -x 静音；-C 含光标
    if (p.region) {
      args.push(
        "-R",
        `${p.region.x},${p.region.y},${p.region.w},${p.region.h}`,
      );
    }
    args.push(path);
    try {
      await runCmd("screencapture", args);
    } catch (e) {
      return {
        content: [{
          type: "text",
          text: `❌ 截图失败：${
            (e as Error).message
          }\n（macOS 需在「系统设置 > 隐私与安全 > 屏幕录制」授权 PiCoddy）`,
        }],
        details: { path: "" },
      };
    }
    try {
      const bytes = await readFile(path);
      const base64 = toBase64(bytes);
      return {
        content: [
          { type: "image" as const, data: base64, mimeType: "image/png" },
          { type: "text" as const, text: `截图已保存：${path}` },
        ],
        details: { path },
      };
    } catch {
      return {
        content: [{ type: "text", text: `截图已保存但读取失败：${path}` }],
        details: { path },
      };
    }
  },
};

// ===== mouse_click =====
const clickSchema = Type.Object({
  x: Type.Number({ description: "点击的 x 坐标" }),
  y: Type.Number({ description: "点击的 y 坐标" }),
  button: Type.Optional(
    Type.Union([Type.Literal("left"), Type.Literal("right")], {
      description: "左键(默认)/右键",
    }),
  ),
  double: Type.Optional(Type.Boolean({ description: "是否双击" })),
});

export const mouseClickTool: AgentTool<
  typeof clickSchema,
  { x: number; y: number }
> = {
  name: "mouse_click",
  label: "鼠标点击",
  description:
    "在屏幕坐标 (x,y) 处执行静默无位移点击鼠标（在 1ms 内自动归位指针）。支持 cliclick 与原生 AppleScript/Powershell 多模式静默降级。",
  parameters: clickSchema,
  execute: async (_id, p) => {
    if (platformOs === "windows") {
      const action = p.double
        ? "double_click"
        : p.button === "right"
        ? "right_click"
        : "left_click";
      return await executeWindowsComputerAction({
        action,
        coordinate: [p.x, p.y],
      });
    }
    const isCliclickInstalled = await hasCliclick();
    const act = p.double
      ? "double_click"
      : (p.button === "right" ? "right_click" : "left_click");
    try {
      await performSilentClick(p.x, p.y, act, isCliclickInstalled);
      return {
        content: [{
          type: "text",
          text: `✓ 已${
            p.double ? "双" : p.button === "right" ? "右键" : ""
          }静默点击 (${p.x},${p.y})`,
        }],
        details: { x: p.x, y: p.y },
      };
    } catch (e) {
      return {
        content: [{
          type: "text",
          text: `❌ 点击失败：${
            (e as Error).message
          }\n（需在「系统设置 > 隐私与安全 > 辅助功能」授权）`,
        }],
        details: { x: p.x, y: p.y },
      };
    }
  },
};

// ===== mouse_move =====
const moveSchema = Type.Object({
  x: Type.Number({ description: "目标 x 坐标" }),
  y: Type.Number({ description: "目标 y 坐标" }),
});
export const mouseMoveTool: AgentTool<
  typeof moveSchema,
  { x: number; y: number }
> = {
  name: "mouse_move",
  label: "鼠标移动",
  description: "移动鼠标到 (x,y)。",
  parameters: moveSchema,
  execute: async (_id, p) => {
    if (platformOs === "windows") {
      return await executeWindowsComputerAction({
        action: "mouse_move",
        coordinate: [p.x, p.y],
      });
    }
    const isCliclickInstalled = await hasCliclick();
    try {
      if (isCliclickInstalled) {
        await runCmd("cliclick", [`m:${p.x},${p.y}`]);
      } else {
        const script =
          `tell application "System Events" to set the position of cursor to {${p.x}, ${p.y}}`;
        try {
          await runCmd("osascript", ["-e", script]);
        } catch {}
      }
      return {
        content: [{ type: "text", text: `✓ 已移动到 (${p.x},${p.y})` }],
        details: { x: p.x, y: p.y },
      };
    } catch (e) {
      return {
        content: [{
          type: "text",
          text: `❌ 移动失败：${(e as Error).message}`,
        }],
        details: { x: p.x, y: p.y },
      };
    }
  },
};

// ===== key_type =====
const keySchema = Type.Object({
  text: Type.Optional(Type.String({ description: "要输入的文本" })),
  key: Type.Optional(
    Type.String({
      description:
        "要按的键（return/tab/esc/cmd+c/shift+a 等，组合键用 + 连接）",
    }),
  ),
});
export const keyTypeTool: AgentTool<typeof keySchema, { input: string }> = {
  name: "key_type",
  label: "键盘输入",
  description:
    "输入文本或按键。text 输入字符串，key 按键（return/tab/esc/cmd+c 等）。支持 AppleScript 原生降级。",
  parameters: keySchema,
  execute: async (_id, p) => {
    if (platformOs === "windows") {
      if (p.text) {
        return await executeWindowsComputerAction({
          action: "type",
          text: p.text,
        });
      }
      if (p.key) {
        return await executeWindowsComputerAction({
          action: "key",
          key: p.key,
        });
      }
      return {
        content: [{ type: "text", text: "❌ 请提供 text 或 key 参数" }],
        details: { input: "" },
      };
    }
    const isCliclickInstalled = await hasCliclick();
    try {
      if (p.text) {
        if (isCliclickInstalled) {
          await runCmd("cliclick", [`t:${p.text}`]);
        } else {
          await appleScriptType(p.text);
        }
        return {
          content: [{
            type: "text",
            text: `✓ 已输入文本：${p.text.slice(0, 50)}`,
          }],
          details: { input: p.text },
        };
      } else if (p.key) {
        if (isCliclickInstalled) {
          await runCmd("cliclick", [`kp:${p.key}`]);
        } else {
          await appleScriptKey(p.key);
        }
        return {
          content: [{ type: "text", text: `✓ 已按键：${p.key}` }],
          details: { input: p.key },
        };
      }
      return {
        content: [{ type: "text", text: "❌ 请提供 text 或 key 参数" }],
        details: { input: "" },
      };
    } catch (e) {
      return {
        content: [{
          type: "text",
          text: `❌ 按键失败：${
            (e as Error).message
          }\n（需在「系统设置 > 隐私与安全 > 辅助功能」授权）`,
        }],
        details: { input: p.text || p.key || "" },
      };
    }
  },
};

// ===== app_focus =====
const appSchema = Type.Object({
  name: Type.String({ description: "应用名（如 Safari, Finder, 飞书）" }),
});
export const appFocusTool: AgentTool<typeof appSchema, { name: string }> = {
  name: "app_focus",
  label: "切换应用",
  description: "激活/前台显示指定应用。用 osascript 调用。",
  parameters: appSchema,
  execute: async (_id, p) => {
    if (platformOs === "windows") {
      return await executeWindowsComputerAction({
        action: "app_focus",
        app_name: p.name,
      });
    }
    try {
      await runCmd("osascript", [
        "-e",
        `tell application "${escapeAppleScript(p.name)}" to activate`,
      ]);
      return {
        content: [{ type: "text", text: `✓ 已切换到 ${p.name}` }],
        details: { name: p.name },
      };
    } catch (e) {
      return {
        content: [{
          type: "text",
          text: `❌ 切换失败：${
            (e as Error).message
          }\n（应用名可能不正确，试试英文名）`,
        }],
        details: { name: p.name },
      };
    }
  },
};

// ===== cursor_pos =====
const cursorSchema = Type.Object({}, { description: "无参数" });
export const cursorPosTool: AgentTool<
  typeof cursorSchema,
  { x: number; y: number }
> = {
  name: "cursor_pos",
  label: "鼠标位置",
  description: "获取并返回当前鼠标光标的屏幕坐标位置。",
  parameters: cursorSchema,
  execute: async () => {
    if (platformOs === "windows") {
      return await executeWindowsComputerAction({ action: "cursor_position" });
    }
    const isCliclickInstalled = await hasCliclick();
    try {
      if (isCliclickInstalled) {
        const out = await runCmd("cliclick", ["p"]);
        const m = out.match(/(\d+),(\d+)/);
        if (m) {
          const x = parseInt(m[1], 10), y = parseInt(m[2], 10);
          return {
            content: [{ type: "text", text: `当前鼠标位置：(${x},${y})` }],
            details: { x, y },
          };
        }
      }
      const metrics = await getDisplayMetrics();
      return {
        content: [{
          type: "text",
          text: `当前屏幕点数尺寸: ${metrics.width}x${metrics.height}`,
        }],
        details: { x: -1, y: -1 },
      };
    } catch (e) {
      return {
        content: [{
          type: "text",
          text: `❌ 获取失败：${(e as Error).message}`,
        }],
        details: { x: -1, y: -1 },
      };
    }
  },
};
