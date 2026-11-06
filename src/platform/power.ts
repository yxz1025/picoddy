import type { SupportedPlatform } from "./runtime.ts";
const platformOs = process.platform === "win32" ? "windows" : process.platform;
import { loadKoffi } from "./koffi_loader.ts";


export interface ManagedProcess {
  kill(): void;
}

export type ProcessSpawner = (
  command: string,
  args: string[],
) => Promise<ManagedProcess>;

export type WindowsKeepAwakeController = (enabled: boolean) => void;

let setThreadExecutionState: ((flags: number) => number) | undefined;

function setWindowsKeepAwake(enabled: boolean): void {
  if (!setThreadExecutionState) {
    setThreadExecutionState = loadKoffi().load("kernel32.dll").func(
      "u32 SetThreadExecutionState(u32 flags)",
    ) as (flags: number) => number;
  }
  const ES_CONTINUOUS = 0x80000000;
  const ES_SYSTEM_REQUIRED = 0x00000001;
  const ES_DISPLAY_REQUIRED = 0x00000002;
  const flags =
    (enabled
      ? ES_CONTINUOUS | ES_SYSTEM_REQUIRED | ES_DISPLAY_REQUIRED
      : ES_CONTINUOUS) >>> 0;
  if (setThreadExecutionState(flags) === 0) {
    throw new Error("SetThreadExecutionState 调用失败");
  }
}

export function createKeepAwakeManager(
  os: SupportedPlatform,
  spawn: ProcessSpawner = async (command, args) => {
    const { spawn } = await import("node:child_process");
    const child = spawn(command, args, { stdio: "ignore" });
    return { kill: () => child.kill() };
  },
  controlWindowsPower: WindowsKeepAwakeController = setWindowsKeepAwake,
) {
  let process: ManagedProcess | null = null;
  let windowsEnabled = false;
  return {
    async setEnabled(enabled: boolean): Promise<void> {
      if (os === "windows") {
        if (windowsEnabled === enabled) return;
        controlWindowsPower(enabled);
        windowsEnabled = enabled;
        return;
      }
      if (!enabled) {
        if (process) {
          try {
            process.kill();
          } finally {
            process = null;
          }
        }
        return;
      }
      if (process) return;
      if (os === "darwin") {
        process = await spawn("caffeinate", ["-d", "-i"]);
      }
    },
    async dispose(): Promise<void> {
      await this.setEnabled(false);
    },
  };
}

export const keepAwakeManager = createKeepAwakeManager(
  platformOs as SupportedPlatform,
);
