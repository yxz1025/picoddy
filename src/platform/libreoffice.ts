import { posix, win32 } from "node:path";
import { stat } from "node:fs/promises";
const platformOs = process.platform === "win32" ? "windows" : process.platform;

import { spawnSync } from "node:child_process";
import type { SupportedPlatform } from "./runtime.ts";
import { runWindowsProcessNoWindow } from "./windows_process.ts";

export function libreOfficeCandidates(
  os: SupportedPlatform,
  env: Readonly<Record<string, string | undefined>>,
): string[] {
  if (os === "darwin") {
    return [
      "/Applications/LibreOffice.app/Contents/MacOS/soffice",
      "/opt/homebrew/bin/soffice",
    ];
  }
  if (os === "windows") {
    return [
      "soffice.exe",
      ...(env.PROGRAMFILES
        ? [
          win32.join(env.PROGRAMFILES, "LibreOffice", "program", "soffice.exe"),
        ]
        : []),
      ...(env["PROGRAMFILES(X86)"]
        ? [
          win32.join(
            env["PROGRAMFILES(X86)"],
            "LibreOffice",
            "program",
            "soffice.exe",
          ),
        ]
        : []),
    ];
  }
  return ["soffice"];
}

export async function findLibreOfficeExecutable(
  os: SupportedPlatform = platformOs as SupportedPlatform,
): Promise<string | null> {
  const candidates = libreOfficeCandidates(os, {
    PROGRAMFILES: process.env["PROGRAMFILES"],
    "PROGRAMFILES(X86)": process.env["PROGRAMFILES(X86)"],
  });
  for (const candidate of candidates) {
    if (!candidate.includes("/") && !candidate.includes("\\")) {
      try {
        const locator = os === "windows" ? "where.exe" : "which";
        const result = os === "windows"
          ? await runWindowsProcessNoWindow({
            command: `${
              process.env["SystemRoot"] || "C:\\Windows"
            }\\System32\\where.exe`,
            args: [candidate],
            timeoutMs: 5000,
          })
          : (() => { const r = spawnSync(locator, [candidate]); return { success: r.status === 0 && !r.error, stdout: r.stdout, stderr: r.stderr }; })();
        if (result.success) {
          const found =
            new TextDecoder().decode(result.stdout ?? new Uint8Array()).trim().split(/\r?\n/)[0];
          if (found) return found;
        }
      } catch {
        // Continue with explicit paths.
      }
      continue;
    }
    try {
      if ((await stat(candidate)).isFile()) return candidate;
    } catch {
      // Try the next candidate.
    }
  }
  return null;
}

export function outputPathForPdf(
  sourcePath: string,
  os: SupportedPlatform = platformOs as SupportedPlatform,
): { outputDirectory: string; pdfPath: string } {
  const pathApi = os === "windows" ? win32 : posix;
  const parsed = pathApi.parse(sourcePath);
  return {
    outputDirectory: parsed.dir || ".",
    pdfPath: pathApi.join(parsed.dir, `${parsed.name}.pdf`),
  };
}
