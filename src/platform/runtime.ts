const platformOs = process.platform === "win32" ? "windows" : process.platform;

export type SupportedPlatform = "darwin" | "windows" | "linux";

export interface PlatformEnvironment {
  os: SupportedPlatform;
  env: Readonly<Record<string, string | undefined>>;
  execPath?: string;
}

export const currentPlatform = platformOs as SupportedPlatform;
export const isMacOS = currentPlatform === "darwin";
export const isWindows = currentPlatform === "windows";
