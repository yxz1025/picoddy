import type { SupportedPlatform } from "../platform/runtime.ts";

export interface DesktopWindowConfig {
  createPlaceholderWindow: boolean;
  mainWindowOptions: Record<string, unknown>;
}

export function createDesktopWindowConfig(
  platform: SupportedPlatform,
): DesktopWindowConfig {
  const mainWindowOptions: Record<string, unknown> = {
    width: 800,
    height: 600,
    title: "PiCoddy",
  };

  if (platform === "darwin") {
    mainWindowOptions.transparentTitlebar = true;
  }

  return {
    createPlaceholderWindow: platform === "darwin",
    mainWindowOptions,
  };
}
