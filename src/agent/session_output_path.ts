import { posix, win32 } from "node:path";

/** Return the isolated fallback directory for a session without a workspace. */
export function sessionFallbackArtifactDir(
  artifactsDir: string,
  sessionId: string,
  os: "windows" | "posix" = "posix",
): string {
  const pathApi = os === "windows" ? win32 : posix;
  return pathApi.join(artifactsDir, "sessions", sessionId);
}
