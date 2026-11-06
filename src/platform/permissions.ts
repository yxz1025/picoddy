import type { SupportedPlatform } from "./runtime.ts";

export interface CapabilityState {
  supported: boolean;
  available: boolean;
  reason?: string;
}

export interface PlatformCapabilities {
  shell: CapabilityState;
  directoryPicker: CapabilityState;
  clipboard: CapabilityState;
  foregroundApplication: CapabilityState;
  computerUse: CapabilityState;
}

export function baseCapabilities(
  os: SupportedPlatform,
): PlatformCapabilities {
  const desktopSupported = os === "darwin" || os === "windows";
  return {
    shell: { supported: desktopSupported, available: desktopSupported },
    directoryPicker: {
      supported: desktopSupported,
      available: desktopSupported,
    },
    clipboard: { supported: desktopSupported, available: desktopSupported },
    foregroundApplication: {
      supported: desktopSupported,
      available: desktopSupported,
    },
    computerUse: os === "darwin" || os === "windows"
      ? { supported: true, available: true }
      : { supported: false, available: false, reason: "当前平台暂不支持" },
  };
}
