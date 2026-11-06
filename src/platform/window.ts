import type { SupportedPlatform } from "./runtime.ts";

export interface MainWindowOptions {
  width: number;
  height: number;
  minWidth: number;
  minHeight: number;
  title: string;
  url: string;
  transparentTitlebar?: boolean;
}

export function shouldCreatePlaceholderWindow(
  os: SupportedPlatform,
): boolean {
  return os === "darwin";
}

export function createMainWindowOptions(
  os: SupportedPlatform,
  url: string,
): MainWindowOptions {
  const options: MainWindowOptions = {
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    title: "PiCoddy",
    url,
  };
  if (os === "darwin") {
    options.transparentTitlebar = true;
  }
  return options;
}

export function resolveDesktopServePort(
  os: SupportedPlatform,
  configuredPort?: string,
): number {
  if (configuredPort) return Number(configuredPort);
  return os === "windows" ? 0 : 8000;
}
