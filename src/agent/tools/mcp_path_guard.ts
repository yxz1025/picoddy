import { posix, win32 } from "node:path";
import type { ProtectedPathPolicy } from "../../platform/path_policy.ts";
import { WRITABLE_PATH_KEYS } from "../sandbox.ts";

const PATH_KEYS = new Set([
  ...[...WRITABLE_PATH_KEYS].map((key) => key.toLowerCase()),
  "file",
  "filename",
  "directory",
  "dir",
  "root",
  "uri",
  "url",
]);

function fromFileUri(value: string, os: ProtectedPathPolicy["os"]): string {
  let url: URL;
  try {
    url = new URL(value);
    if (
      url.protocol !== "file:" || url.username || url.password ||
      url.search || url.hash
    ) throw new Error("invalid file URI");
    const decoded = decodeURIComponent(url.pathname);
    if (/[$*{}]/.test(decoded) || /%[A-Za-z_][^%]*%/.test(decoded)) {
      throw new Error("dynamic file URI");
    }
    if (os === "windows") {
      if (url.hostname) {
        return `\\\\${url.hostname}${decoded.replaceAll("/", "\\")}`;
      }
      const drivePath = decoded.match(/^\/([a-zA-Z]:\/.*)$/)?.[1];
      if (!drivePath) throw new Error("invalid Windows file URI");
      return win32.normalize(drivePath.replaceAll("/", "\\"));
    }
    if (url.hostname && url.hostname !== "localhost") {
      return posix.normalize(`//${url.hostname}${decoded}`);
    }
    return posix.normalize(decoded);
  } catch (error) {
    throw new Error(
      `Invalid or dynamic file URI: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function pathValue(
  key: string,
  value: string,
  policy: ProtectedPathPolicy,
): string | undefined {
  const trimmed = value.trim();
  if (!trimmed) return undefined;
  if (/^file:/i.test(trimmed)) return fromFileUri(trimmed, policy.os);
  if (
    (key === "uri" || key === "url") && /^[a-z][a-z0-9+.-]*:/i.test(trimmed)
  ) {
    return undefined;
  }
  if (/^https?:\/\//i.test(trimmed)) return undefined;
  for (const root of policy.protectedRoots) {
    const comparable = policy.os === "windows"
      ? trimmed.replaceAll("/", "\\").toLowerCase()
      : trimmed;
    const protectedRoot = policy.os === "windows"
      ? root.replaceAll("/", "\\").toLowerCase()
      : root;
    if (comparable.includes(protectedRoot)) return root;
  }
  return trimmed;
}

/** Recursively extracts explicit local path arguments from an unknown MCP call. */
/** Unknown MCPs can still hide side effects in non-path fields. Known local
 * filesystem MCP capabilities must be dropped or assigned a dedicated resolver. */
export function collectMcpPathTargets(
  input: unknown,
  policy: ProtectedPathPolicy,
): string[] {
  const targets: string[] = [];
  const visit = (value: unknown, key = "") => {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key);
      return;
    }
    if (value && typeof value === "object") {
      for (const [childKey, child] of Object.entries(value)) {
        visit(child, childKey.toLowerCase());
      }
      return;
    }
    if (typeof value !== "string" || !PATH_KEYS.has(key)) return;
    const target = pathValue(key, value, policy);
    if (target) targets.push(target);
  };
  visit(input);
  return targets;
}
