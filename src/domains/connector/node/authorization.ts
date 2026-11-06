import { buildCliProcessEnv, type ManagedNpmRuntime } from "../../../platform/cli/runtime.ts";
import { ConnectorError } from "./errors.ts";
import type { ConnectorProcessResult, RunConnectorProcessOptions } from "./process_runner.ts";
import type { ConnectorCatalogEntry } from "./types.ts";

export interface ConnectorAuthorizationOptions {
  readonly binPath: string;
  readonly entry: ConnectorCatalogEntry;
  readonly runtime: ManagedNpmRuntime;
  readonly runProcess: (options: RunConnectorProcessOptions) => Promise<ConnectorProcessResult>;
  readonly openExternal: (url: string) => void;
  readonly signal?: AbortSignal;
}

function authFailed(cause?: unknown): ConnectorError {
  return new ConnectorError("AUTH_FAILED", "Connector authorization failed", { cause });
}

function allowedAuthUrl(candidate: string, allowedDomains: readonly string[]): URL | undefined {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return undefined;
  }
  if (url.protocol !== "https:") return undefined;
  const host = url.hostname.toLowerCase();
  if (!allowedDomains.some((domain) => host === domain || host.endsWith(`.${domain}`))) return undefined;
  return url;
}

function extractUrlCandidates(line: string): string[] {
  return line.match(/https?:\/\/[^\s"'<>\\]+/gu) ?? [];
}

function matchesJsonMatch(value: unknown, jsonMatch: Readonly<Record<string, unknown>>): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const record = value as Readonly<Record<string, unknown>>;
  return Object.entries(jsonMatch).every(([key, expected]) => deepEqual(record[key], expected));
}

function deepEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (typeof left !== typeof right) return false;
  if (typeof left !== "object" || left === null || right === null) return false;
  if (Array.isArray(left) !== Array.isArray(right)) return false;
  const lKeys = Object.keys(left as object).sort();
  const rKeys = Object.keys(right as object).sort();
  if (lKeys.length !== rKeys.length) return false;
  return lKeys.every((key, index) => rKeys[index] === key && deepEqual((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

export async function authorizeConnector(options: ConnectorAuthorizationOptions): Promise<void> {
  const { binPath, entry, runtime, runProcess, openExternal, signal } = options;
  const env = buildCliProcessEnv({ ELECTRON_RUN_AS_NODE: "1" });
  let opened = false;
  const auth = await runProcess({
    executable: runtime.node.executable,
    argv: [binPath, ...entry.auth.argv],
    env,
    signal,
    onLine: (line) => {
      if (opened) return;
      for (const candidate of extractUrlCandidates(line)) {
        const url = allowedAuthUrl(candidate, entry.auth.allowedDomains);
        if (url !== undefined) {
          opened = true;
          openExternal(url.href);
          return;
        }
      }
    },
  });
  if (auth.exitCode !== 0) throw authFailed();

  const status = await runProcess({
    executable: runtime.node.executable,
    argv: [binPath, ...entry.status.argv],
    env,
    signal,
  });
  if (status.exitCode !== 0) throw authFailed();
  let parsed: unknown;
  try {
    parsed = JSON.parse(status.stdout);
  } catch (cause) {
    throw authFailed(cause);
  }
  if (!matchesJsonMatch(parsed, entry.status.jsonMatch)) throw authFailed();
}
