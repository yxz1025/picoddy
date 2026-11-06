import { realpathSync } from "node:fs";
import type { ProtectedPathPolicy } from "./path_policy.ts";

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

/** Reads remain unrestricted. Denials also apply to child processes and symlinks. */
export function macSystemWriteProfile(policy: ProtectedPathPolicy): string {
  const roots = new Set(policy.protectedRoots);
  for (const root of policy.protectedRoots) {
    try { roots.add(realpathSync(root)); } catch { /* Keep nonexistent roots protected. */ }
  }
  return [
    "(version 1)",
    "(allow default)",
    ...[...roots].map((root) => `(deny file-write* (subpath ${JSON.stringify(root)}))`),
  ].join("\n");
}

export function wrapProtectedShellCommand(command: string, policy: ProtectedPathPolicy): string {
  if (!policy.nativeShellProtection || policy.os !== "darwin") return command;
  if (process.platform !== "darwin") throw new Error("macOS shell protection requires macOS");
  if (command.includes("\0")) throw new Error("Shell command contains NUL");
  // No fallback to unprotected execution if sandbox-exec is unavailable or fails.
  return `/usr/bin/sandbox-exec -p ${shellQuote(macSystemWriteProfile(policy))} /bin/bash --noprofile --norc -c ${shellQuote(command)}`;
}
