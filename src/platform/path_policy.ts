import { posix, win32 } from "node:path";
import { realpath } from "node:fs/promises";
import { statSync, mkdirSync, readFileSync } from "node:fs";
const platformOs = process.platform === "win32" ? "windows" : process.platform;

import type { PlatformPaths } from "./paths.ts";
import { platformPaths } from "./paths.ts";
import { currentPlatform, type SupportedPlatform } from "./runtime.ts";

export interface ProtectedPathPolicy {
  os: SupportedPlatform;
  protectedRoots: string[];
  /** Shell writes are enforced by sandbox-exec at the execution boundary. */
  nativeShellProtection?: boolean;
  /** Explicit base for relative tool arguments. Relative paths are rejected without it. */
  cwd?: string;
  /** Home directory used to resolve shell tilde (~) targets. */
  homeDir?: string;
}

export interface CreateProtectedPathPolicyOptions {
  os: SupportedPlatform;
  cwd?: string;
  homeDir?: string;
  protectedRoots?: string[];
  installationDir?: string;
  systemDir?: string;
  builtinSkillsRootDir?: string;
  sourceRoot?: string;
  resourceRoots?: string[];
}

export interface ResolvedPathOptions {
  realPath?: (path: string) => string | Promise<string>;
}

function hasNul(value: string): boolean {
  return value.includes("\0");
}

function normalizeWindowsPrefix(value: string): string | undefined {
  const slash = value.replaceAll("/", "\\");
  if (/^\\\\\.\\/i.test(slash) || /^\\\?\?\\/i.test(slash)) return undefined;
  if (/^\\\\\?\\globalroot(?:\\|$)/i.test(slash)) return undefined;
  if (/^\\\\\?\\unc\\/i.test(slash)) return `\\\\${slash.slice(8)}`;
  if (/^\\\\\?\\[a-z]:\\/i.test(slash)) return slash.slice(4);
  if (/^\\\\\?\\/i.test(slash)) return undefined;
  return slash;
}

function normalizeAbsolute(
  value: string,
  os: SupportedPlatform,
  cwd?: string,
): string | undefined {
  if (!value || hasNul(value)) return undefined;
  if (os === "windows") {
    const candidate = normalizeWindowsPrefix(value.trim());
    if (!candidate) return undefined;
    const base = cwd ? normalizeWindowsPrefix(cwd.trim()) : undefined;
    // Drive-relative (C:foo) and root-relative (\foo) paths are context-dependent.
    if (/^[a-z]:[^\\]/i.test(candidate)) return undefined;
    const isDriveAbsolute = /^[a-z]:\\/i.test(candidate);
    const isUncAbsolute = /^\\\\[^\\]+\\[^\\]+(?:\\|$)/.test(candidate);
    if (!isDriveAbsolute && !isUncAbsolute) {
      if (
        !base ||
        (!/^[a-z]:\\/i.test(base) && !/^\\\\[^\\]+\\[^\\]+(?:\\|$)/.test(base))
      ) {
        return undefined;
      }
    }
    const resolved = isDriveAbsolute || isUncAbsolute
      ? win32.resolve(candidate)
      : win32.resolve(base!, candidate);
    return resolved.length > 3 && resolved.endsWith("\\")
      ? resolved.slice(0, -1).toLowerCase()
      : resolved.toLowerCase();
  }

  const candidate = value.trim();
  const resolved = posix.isAbsolute(candidate)
    ? posix.resolve(candidate)
    : cwd && posix.isAbsolute(cwd)
    ? posix.resolve(cwd, candidate)
    : undefined;
  if (!resolved) return undefined;
  return resolved.length > 1 && resolved.endsWith("/")
    ? resolved.slice(0, -1)
    : resolved;
}

export function isPathWithin(
  root: string,
  target: string,
  os: SupportedPlatform,
): boolean {
  const normalizedRoot = normalizeAbsolute(root, os);
  const normalizedTarget = normalizeAbsolute(target, os);
  if (!normalizedRoot || !normalizedTarget) return false;
  if (normalizedRoot === normalizedTarget) return true;
  const separator = os === "windows" ? "\\" : "/";
  const prefix = normalizedRoot.endsWith(separator)
    ? normalizedRoot
    : `${normalizedRoot}${separator}`;
  return normalizedTarget.startsWith(prefix);
}

export function createProtectedPathPolicy(
  options: CreateProtectedPathPolicyOptions,
): ProtectedPathPolicy {
  const candidates = [
    ...(options.protectedRoots ?? []),
    options.installationDir,
    options.systemDir,
    options.builtinSkillsRootDir,
    options.sourceRoot,
    ...(options.resourceRoots ?? []),
  ].filter((value): value is string => Boolean(value));
  const roots: string[] = [];
  for (const candidate of candidates) {
    const normalized = normalizeAbsolute(candidate, options.os);
    if (normalized && !roots.includes(normalized)) roots.push(normalized);
  }
  const homeDir = options.homeDir
    ? normalizeAbsolute(options.homeDir, options.os)
    : undefined;
  return {
    os: options.os,
    protectedRoots: roots,
    cwd: options.cwd,
    homeDir,
  };
}

function isDevelopmentRoot(path: string, os: SupportedPlatform): boolean {
  const api = pathApi(os);
  try {
    return statSync(api.join(path, "package.json")).isFile() &&
      statSync(api.join(path, "application.electron.ts")).isFile() &&
      statSync(api.join(path, "src", "agent")).isDirectory();
  } catch {
    return false;
  }
}

export function detectDevelopmentSourceRoot(
  candidates: string[],
  os: SupportedPlatform = currentPlatform,
): string | undefined {
  const api = pathApi(os);
  for (const candidate of candidates) {
    let current = api.resolve(candidate);
    while (true) {
      if (isDevelopmentRoot(current, os)) return current;
      const parent = api.dirname(current);
      if (parent === current) break;
      current = parent;
    }
  }
  return undefined;
}

export function createDefaultProtectedPathPolicy(options: {
  os?: SupportedPlatform;
  paths?: PlatformPaths;
  cwd?: string;
  moduleUrl?: string;
  sourceRoot?: string;
  resourceRoots?: string[];
  executablePath?: string;
} = {}): ProtectedPathPolicy {
  const os = options.os ?? currentPlatform;
  const paths = options.paths ?? platformPaths;
  // Keep relative permission checks aligned with the currently registered
  // coding-tool root. Task-specific callers should always pass their tool cwd.
  const cwd = options.cwd ?? paths.homeDir;
  return {
    ...createProtectedPathPolicy({
      os,
      cwd,
      homeDir: paths.homeDir,
      protectedRoots: hostSystemProtectedRoots(os),
    }),
    nativeShellProtection: os === "darwin",
  };
}

function hostSystemProtectedRoots(os: SupportedPlatform): string[] {
  if (os === "windows") {
    return [
      process.env.SystemRoot || "C:\\Windows",
      process.env.ProgramFiles || "C:\\Program Files",
      process.env["ProgramFiles(x86)"] || "C:\\Program Files (x86)",
    ];
  }
  return os === "darwin"
    ? ["/System", "/Library", "/bin", "/sbin", "/usr", "/etc", "/private/etc", "/private/var/db", "/private/var/root"]
    : ["/boot", "/bin", "/sbin", "/usr", "/etc"];
}

function expandTilde(target: string, policy: ProtectedPathPolicy): string {
  const home = policy.homeDir;
  if (!home) return target;
  if (target === "~") return home;
  if (target.startsWith("~/") || target.startsWith("~\\")) {
    return pathApi(policy.os).join(home, target.slice(2));
  }
  return target;
}

function absoluteTarget(target: string, policy: ProtectedPathPolicy): string {
  if (hasNul(target)) throw new Error("Writable target contains NUL");
  const normalized = normalizeAbsolute(
    expandTilde(target, policy),
    policy.os,
    policy.cwd,
  );
  if (!normalized) {
    throw new Error(
      "Writable target is invalid or relative without an explicit cwd",
    );
  }
  return normalized;
}

export function assertWritableTarget(
  target: string,
  policy: ProtectedPathPolicy,
): void {
  const normalized = absoluteTarget(target, policy);
  for (const root of policy.protectedRoots) {
    if (isPathWithin(root, normalized, policy.os)) {
      throw new Error(`Writable target is inside a protected path: ${target}`);
    }
  }
}

function pathApi(os: SupportedPlatform) {
  return os === "windows" ? win32 : posix;
}

export async function assertResolvedWritableTarget(
  target: string,
  policy: ProtectedPathPolicy,
  options: ResolvedPathOptions = {},
): Promise<void> {
  assertWritableTarget(target, policy);
  const absolute = absoluteTarget(target, policy);
  // Cross-platform tests cannot ask the host OS to resolve a foreign path.
  if (!options.realPath && policy.os !== platformOs) return;
  const realPath = options.realPath ?? ((path: string) => realpath(path));
  const api = pathApi(policy.os);
  let existing = absolute;
  let suffix = "";
  while (true) {
    try {
      const resolvedExisting = await realPath(existing);
      const resolvedTarget = suffix
        ? api.resolve(resolvedExisting, suffix)
        : resolvedExisting;
      assertWritableTarget(resolvedTarget, { ...policy, cwd: undefined });
      return;
    } catch (error) {
      if (!((error as { code?: string }).code === "ENOENT")) throw error;
      const parent = api.dirname(existing);
      if (parent === existing) return;
      suffix = suffix
        ? api.join(api.basename(existing), suffix)
        : api.basename(existing);
      existing = parent;
    }
  }
}

function decodeAnsiEscape(command: string, index: number): {
  value: string;
  consumed: number;
} {
  const marker = command[index + 1] ?? "";
  const simple: Record<string, string> = {
    n: "\n",
    r: "\r",
    t: "\t",
    b: "\b",
    f: "\f",
    v: "\v",
    "\\": "\\",
    "'": "'",
    '"': '"',
  };
  if (marker in simple) return { value: simple[marker], consumed: 1 };
  const hex = command.slice(index + 2).match(/^[0-9a-fA-F]{1,2}/)?.[0];
  if (marker === "x" && hex) {
    return {
      value: String.fromCharCode(parseInt(hex, 16)),
      consumed: 1 + hex.length,
    };
  }
  const unicode = command.slice(index + 2).match(/^[0-9a-fA-F]{4}/)?.[0];
  if (marker === "u" && unicode) {
    return {
      value: String.fromCharCode(parseInt(unicode, 16)),
      consumed: 1 + unicode.length,
    };
  }
  const octal = command.slice(index + 1).match(/^[0-7]{1,3}/)?.[0];
  if (octal) {
    return {
      value: String.fromCharCode(parseInt(octal, 8)),
      consumed: octal.length,
    };
  }
  return { value: marker, consumed: marker ? 1 : 0 };
}

function tokenizeCommand(command: string, os: SupportedPlatform): string[] {
  const tokens: string[] = [];
  let current = "";
  let quote: "" | "'" | '"' | "ansi" = "";
  const push = () => {
    if (current) tokens.push(current);
    current = "";
  };
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (quote) {
      if ((quote === "ansi" && char === "'") || char === quote) {
        quote = "";
      } else if (quote === "ansi" && char === "\\") {
        const decoded = decodeAnsiEscape(command, index);
        current += decoded.value;
        index += decoded.consumed;
      } else if (
        os !== "windows" && quote === '"' && char === "\\" &&
        command[index + 1]
      ) {
        current += command[++index];
      } else if (
        os === "windows" && char === "`" && command[index + 1]
      ) {
        current += command[++index];
      } else current += char;
      continue;
    }
    if (os !== "windows" && char === "$" && command[index + 1] === "'") {
      quote = "ansi";
      index++;
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (
      ((os === "windows" && (char === "^" || char === "`")) ||
        (os !== "windows" && char === "\\")) && command[index + 1]
    ) {
      current += command[++index];
      continue;
    }
    if (/\s/.test(char)) {
      push();
      continue;
    }
    if (char === ">") {
      push();
      if (command[index + 1] === ">") index++;
      tokens.push(">");
      continue;
    }
    if (char === "|" || char === ";" || char === "&") {
      push();
      tokens.push(char);
      continue;
    }
    current += char;
  }
  push();
  return tokens;
}

function commandName(token: string): string {
  const name = token.replaceAll("/", "\\").split("\\").pop()?.toLowerCase() ??
    "";
  return name.endsWith(".exe") ? name.slice(0, -4) : name;
}

const POSIX_ALL_OPERAND_WRITERS = new Set([
  "rm",
  "touch",
  "mkdir",
  "chmod",
  "chown",
  "tee",
  "truncate",
]);
const WINDOWS_ALL_OPERAND_WRITERS = new Set([
  "remove-item",
  "ri",
  "set-content",
  "sc",
  "add-content",
  "ac",
  "clear-content",
  "clc",
  "clear-item",
  "cli",
  "out-file",
  "new-item",
  "ni",
  "set-item",
  "si",
  "set-itemproperty",
  "sp",
  "new-itemproperty",
  "np",
  "remove-itemproperty",
  "rp",
  "rename-itemproperty",
  "rnp",
  "clear-itemproperty",
  "clp",
  "set-acl",
  "del",
  "erase",
  "rd",
  "rmdir",
  "rm",
]);
const POSIX_LAST_OPERAND_WRITERS = new Set([
  "mv",
  "cp",
  "install",
  "rsync",
]);
const WINDOWS_LAST_OPERAND_WRITERS = new Set([
  "move",
  "copy",
  "move-item",
  "copy-item",
  "mi",
  "cpi",
  "ren",
  "rename",
  "rename-item",
  "rni",
  "xcopy",
  "robocopy",
]);
const WINDOWS_NAMED_PATH_WRITERS = new Set([
  "remove-item",
  "ri",
  "set-content",
  "sc",
  "add-content",
  "ac",
  "clear-content",
  "clc",
  "clear-item",
  "cli",
  "out-file",
  "new-item",
  "ni",
  "set-item",
  "si",
  "set-itemproperty",
  "sp",
  "new-itemproperty",
  "np",
  "remove-itemproperty",
  "rp",
  "rename-itemproperty",
  "rnp",
  "clear-itemproperty",
  "clp",
  "set-acl",
]);
const WINDOWS_MULTI_PATH_WRITERS = new Set([
  "remove-item",
  "ri",
  "clear-content",
  "clc",
  "clear-item",
  "cli",
  "del",
  "erase",
  "rd",
  "rmdir",
]);
const WINDOWS_SOURCE_MUTATING_LAST_WRITERS = new Set([
  "mv",
  "move",
  "move-item",
  "mi",
  "ren",
  "rename",
  "rename-item",
  "rni",
]);
const WINDOWS_RENAME_WRITERS = new Set([
  "ren",
  "rename",
  "rename-item",
  "rni",
]);
const COMMAND_BOUNDARIES = new Set(["|", ";", "&"]);

const KNOWN_READ_ONLY_COMMANDS = new Set([
  "cd",
  "cat",
  "dir",
  "df",
  "du",
  "echo",
  "egrep",
  "fgrep",
  "file",
  "gc",
  "get-content",
  "get-item",
  "get-itemproperty",
  "gi",
  "gp",
  "grep",
  "head",
  "ls",
  "printf",
  "pwd",
  "rg",
  "select-string",
  "stat",
  "tail",
  "test-path",
  "tree",
  "type",
  "wc",
]);

const WINDOWS_READ_ONLY_PIPELINE_COMMANDS = new Set([
  "foreach-object",
  "group-object",
  "measure-object",
  "select-object",
  "sort-object",
  "where-object",
  "write-host",
  "write-output",
]);

const INTERPRETER_WRITE_SEMANTICS =
  /(?:\bwrite|append|unlink|remove|rename|replace|mkdir|rmdir|chmod|chown|open\s*\([^)]*,\s*["'][wax+])/i;

export interface ShellWriteTarget {
  path: string;
  role: "source" | "destination" | "target" | "capability" | "potential";
  resolve: boolean;
  lexical?: boolean;
}

export interface ShellWriteParseResult {
  targets: ShellWriteTarget[];
  unsafeDynamicTarget: boolean;
}

function isOption(token: string, os: SupportedPlatform): boolean {
  if (token === "-") return false;
  return token.startsWith("-") ||
    (os === "windows" && /^\/[a-z]+$/i.test(token));
}

function protectedTarget(target: string, policy: ProtectedPathPolicy): boolean {
  try {
    assertWritableTarget(target, policy);
    return false;
  } catch {
    // An ambiguous or device path is not safe to pass to a write command either.
    return true;
  }
}

export function commandReferencesProtectedWrite(
  command: string,
  policy: ProtectedPathPolicy,
): boolean {
  // Arbitrary scripts cannot be classified reliably with regular expressions.
  // The native execution boundary checks actual writes, including descendants.
  if (policy.nativeShellProtection && policy.os === "darwin") return hasNul(command);
  const parsed = parseShellWriteTargets(command, policy.os);
  if (parsed.unsafeDynamicTarget) return true;
  return parsed.targets.some((target) =>
    target.lexical !== false && protectedTarget(target.path, policy)
  );
}

function wrappedCommandFragments(command: string): string[] {
  const fragments: string[] = [];
  const patterns = [
    /(?:^|[;&|]\s*|\s)(?:env\s+(?:(?!(?:bash|sh|zsh|fish|dash|ksh|csh|tcsh)(?:\.exe)?\b)\S+\s+)*)?(?:bash|sh|zsh|fish|dash|ksh|csh|tcsh)(?:\.exe)?\b.*?\s(?:-c|--command)\s+(["'])([\s\S]*?)\1/gi,
    /(?:^|[;&|]\s*|\s)cmd(?:\.exe)?\b.*?\s\/(?:[dqs]*c)\s+(["'])([\s\S]*?)\1/gi,
    /(?:^|[;&|]\s*|\s)(?!(?:grep|rg|sed|wc|find|powershell|pwsh)(?:\.exe)?\b)\S+(?:\.exe)?\b.*?\s(?:-c|--command)\s+(["'])([\s\S]*?)\1/gi,
  ];
  for (const pattern of patterns) {
    for (const match of command.matchAll(pattern)) {
      if (match[2]) fragments.push(match[2]);
    }
  }
  return fragments;
}

function backtickCommandFragments(command: string): string[] {
  const fragments: string[] = [];
  let singleQuoted = false;
  for (let index = 0; index < command.length; index++) {
    if (command[index] === "'" && command[index - 1] !== "\\") {
      singleQuoted = !singleQuoted;
      continue;
    }
    if (singleQuoted || command[index] !== "`" || command[index - 1] === "\\") {
      continue;
    }
    const start = index + 1;
    for (index = start; index < command.length; index++) {
      if (command[index] === "`" && command[index - 1] !== "\\") {
        fragments.push(command.slice(start, index));
        break;
      }
    }
  }
  return fragments;
}

function subshellFragments(command: string): string[] {
  const fragments: string[] = [];
  let quote = "";
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if ((char === "'" || char === '"') && !quote) quote = char;
    else if (char === quote) quote = "";
    else if (!quote && char === "(" && command[index - 1] !== "$") {
      let depth = 1;
      let innerQuote = "";
      const start = index + 1;
      for (let cursor = start; cursor < command.length; cursor++) {
        const nested = command[cursor];
        if ((nested === "'" || nested === '"') && !innerQuote) {
          innerQuote = nested;
        } else if (nested === innerQuote) innerQuote = "";
        else if (!innerQuote && nested === "(") depth++;
        else if (!innerQuote && nested === ")" && --depth === 0) {
          fragments.push(command.slice(start, cursor));
          index = cursor;
          break;
        }
      }
    }
  }
  return fragments;
}

function commandSubstitutionFragments(command: string): string[] {
  const fragments: string[] = [];
  let quote = "";
  for (let index = 0; index < command.length - 1; index++) {
    const char = command[index];
    if (char === "'" && quote !== '"') {
      quote = quote === "'" ? "" : "'";
      continue;
    }
    if (char === '"' && quote !== "'") {
      quote = quote === '"' ? "" : '"';
      continue;
    }
    if (quote === "'" || char !== "$" || command[index + 1] !== "(") continue;
    let nestedDepth = 1;
    let innerQuote = "";
    const start = index + 2;
    for (let cursor = start; cursor < command.length; cursor++) {
      const nested = command[cursor];
      if ((nested === "'" || nested === '"') && !innerQuote) {
        innerQuote = nested;
      } else if (nested === innerQuote) innerQuote = "";
      else if (!innerQuote && nested === "(") nestedDepth++;
      else if (!innerQuote && nested === ")" && --nestedDepth === 0) {
        fragments.push(command.slice(start, cursor));
        index = cursor;
        break;
      }
    }
  }
  return fragments;
}

function addAssignments(
  tokens: string[],
  variables: Map<string, string>,
): void {
  for (let index = 0; index < tokens.length; index++) {
    const direct = tokens[index].match(/^\$?([A-Za-z_][A-Za-z0-9_]*)=(.+)$/);
    if (direct) variables.set(direct[1].toLowerCase(), direct[2]);
    if (commandName(tokens[index]) === "set") {
      const next = tokens[index + 1]?.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.+)$/);
      if (next) variables.set(next[1].toLowerCase(), next[2]);
    }
  }
}

function expandTarget(
  target: string,
  os: SupportedPlatform,
  variables: Map<string, string>,
): { path: string; dynamic: boolean } {
  let path = target.replace(
    /\$\{([A-Za-z_][A-Za-z0-9_]*)\}|\$([A-Za-z_][A-Za-z0-9_]*)/g,
    (match, braced, plain) =>
      variables.get(String(braced ?? plain).toLowerCase()) ?? match,
  );
  if (os === "windows") {
    path = path.replace(
      /%([A-Za-z_][A-Za-z0-9_]*)%/g,
      (match, name) => variables.get(String(name).toLowerCase()) ?? match,
    );
  }
  return {
    path,
    dynamic:
      /\$\(|`|\$\{?[A-Za-z_]|%[A-Za-z_][A-Za-z0-9_]*%|![A-Za-z_][A-Za-z0-9_]*!|[*?[]/
        .test(path),
  };
}

function namedParameter(
  tokens: string[],
  names: string[],
): string | undefined {
  for (let index = 0; index < tokens.length; index++) {
    const lower = tokens[index].toLowerCase();
    for (const name of names) {
      if (lower === name) return tokens[index + 1];
      if (lower.startsWith(`${name}:`) || lower.startsWith(`${name}=`)) {
        return tokens[index].slice(name.length + 1);
      }
    }
  }
  return undefined;
}

function operandsUntilBoundary(
  tokens: string[],
  start: number,
  os: SupportedPlatform,
): { operands: string[]; end: number } {
  const operands: string[] = [];
  let cursor = start;
  for (
    ;
    cursor < tokens.length && !COMMAND_BOUNDARIES.has(tokens[cursor]);
    cursor++
  ) {
    const token = tokens[cursor];
    if (token === ">") break;
    if (!isOption(token, os)) operands.push(token);
  }
  return { operands, end: cursor };
}

function commandPositions(
  tokens: string[],
  os: SupportedPlatform,
): Set<number> {
  const positions = new Set<number>();
  let expectingCommand = true;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (COMMAND_BOUNDARIES.has(token)) {
      expectingCommand = true;
      continue;
    }
    if (!expectingCommand || token === ">") continue;
    if (
      os === "windows" &&
      /^\$[A-Za-z_][A-Za-z0-9_]*$/.test(token) &&
      tokens[index + 1] === "="
    ) {
      index++;
      continue;
    }
    if (/^[A-Za-z_][A-Za-z0-9_]*=/.test(token)) continue;
    positions.add(index);
    expectingCommand = false;
  }
  return positions;
}

function isKnownReadOnlyCommand(
  name: string,
  rawSegment: string[],
  os: SupportedPlatform,
): boolean {
  if (name === "find") {
    return !rawSegment.some((token) =>
      /^(?:-delete|-exec|-execdir|-ok|-okdir|-fprint|-fprint0|-fprintf|-fls)$/i
        .test(token)
    );
  }
  if (name === "less") {
    return !rawSegment.some((token) =>
      /(?:\$\(|`|\$\{?[A-Za-z_]|%[A-Za-z_][A-Za-z0-9_]*%|![A-Za-z_][A-Za-z0-9_]*!|^~(?:[\\/]|$)|^\+!)/
        .test(token)
    );
  }
  if (name === "sort" || name === "jq") {
    return !rawSegment.some((token) =>
      /(?:\$\(|`|\$\{?[A-Za-z_]|%[A-Za-z_][A-Za-z0-9_]*%|![A-Za-z_][A-Za-z0-9_]*!|^~(?:[\\/]|$))/
        .test(token)
    );
  }
  if (name === "awk") return isAuditedReadOnlyAwk(rawSegment);
  if (
    KNOWN_READ_ONLY_COMMANDS.has(name) || name.startsWith("get-") ||
    (os === "windows" && WINDOWS_READ_ONLY_PIPELINE_COMMANDS.has(name))
  ) {
    return true;
  }
  if (name === "git") {
    let subcommand: string | undefined;
    for (let index = 0; index < rawSegment.length; index++) {
      const token = rawSegment[index].toLowerCase();
      if (["-c", "--git-dir", "--work-tree", "--namespace"].includes(token)) {
        index++;
        continue;
      }
      if (
        token.startsWith("--git-dir=") || token.startsWith("--work-tree=") ||
        token.startsWith("--namespace=") || token.startsWith("-c=")
      ) continue;
      if (token.startsWith("-")) continue;
      subcommand = token;
      break;
    }
    return new Set([
      "blame",
      "diff",
      "grep",
      "log",
      "rev-parse",
      "show",
      "status",
    ]).has(subcommand ?? "");
  }
  if (/^(?:python3?|node|deno)$/.test(name)) {
    const scriptIndex = rawSegment.findIndex((token) =>
      /^(?:-c|-e|--eval|eval)$/.test(token)
    );
    const script = scriptIndex >= 0 ? rawSegment[scriptIndex + 1] ?? "" : "";
    return Boolean(script) && !INTERPRETER_WRITE_SEMANTICS.test(script) &&
      /(?:\bprint\s*\(|console\.log\s*\(|\bread(?:File|TextFile|FileSync|TextFileSync)?\s*\()/i
        .test(script);
  }
  return false;
}

function powerShellCommandScript(
  name: string,
  rawSegment: string[],
  os: SupportedPlatform,
): string | undefined {
  if (os !== "windows" || (name !== "powershell" && name !== "pwsh")) {
    return undefined;
  }
  const commandFlag = rawSegment.findIndex((token) =>
    /^(?:-command|-c)$/i.test(token)
  );
  return commandFlag >= 0 ? rawSegment[commandFlag + 1] || undefined : undefined;
}

function isAuditedReadOnlyAwk(rawSegment: string[]): boolean {
  let index = 0;
  for (; index < rawSegment.length; index++) {
    const token = rawSegment[index];
    if (token === "--") {
      index++;
      break;
    }
    if (token === "-F" || token === "-v" || token === "--assign") {
      index++;
      continue;
    }
    if (/^(?:-F.+|-v.+|--assign=.+)$/.test(token)) continue;
    if (token.startsWith("-")) return false;
    break;
  }
  const program = rawSegment[index];
  if (!program || /\bsystem\s*\(|[>|`]|\$\(|^~(?:[\\/]|$)/i.test(program)) {
    return false;
  }
  return !rawSegment.slice(index + 1).some((token) =>
    /(?:\$\(|`|\$\{?[A-Za-z_]|%[A-Za-z_][A-Za-z0-9_]*%|![A-Za-z_][A-Za-z0-9_]*!|^~(?:[\\/]|$))/
      .test(token)
  );
}

function potentialPathOperands(
  raw: string,
  os: SupportedPlatform,
): string[] {
  const equals = raw.indexOf("=");
  const value = equals > 0 ? raw.slice(equals + 1) : raw;
  if (!value) return [];
  const dynamic =
    /\$\(|`|\$\{?[A-Za-z_]|%[A-Za-z_][A-Za-z0-9_]*%|![A-Za-z_][A-Za-z0-9_]*!|^~(?:[\\/]|$)/
      .test(value);
  if (dynamic) return [value];
  const candidates: string[] = [];
  if (os === "windows") {
    if (
      /^(?:[A-Za-z]:[\\/]|\\\\|\.{1,2}[\\/])/.test(value) ||
      value.includes("\\") || value.includes("/")
    ) candidates.push(value);
    for (
      const match of value.matchAll(
        /["']([A-Za-z]:[\\/][^"']+|\\\\[^"']+)["']|([A-Za-z]:[\\/][^"'()\s,;]+|\\\\[^"'()\s,;]+)/g,
      )
    ) candidates.push(match[1] ?? match[2]);
    return [...new Set(candidates)];
  }
  if (/^(?:\/|\.{1,2}\/)/.test(value) || value.includes("/")) {
    candidates.push(value);
  }
  for (
    const match of value.matchAll(
      /["'](\/[^"']+)["']|(\/[^"'()\s,;]+)/g,
    )
  ) candidates.push(match[1] ?? match[2]);
  return [...new Set(candidates)];
}

function addPotentialWriteOperands(
  result: ShellWriteParseResult,
  rawSegment: string[],
  os: SupportedPlatform,
  variables: Map<string, string>,
): void {
  for (let index = 0; index < rawSegment.length; index++) {
    const raw = rawSegment[index];
    if (
      /^(?:--?(?:output|out|dest|destination|target|path|file)|-o)$/i.test(
        raw,
      ) &&
      (!rawSegment[index + 1] || isOption(rawSegment[index + 1], os))
    ) {
      result.unsafeDynamicTarget = true;
    }
    for (const potential of potentialPathOperands(raw, os)) {
      pushTarget(result, potential, "potential", os, variables);
    }
  }
}

function addExplicitOutputTargets(
  result: ShellWriteParseResult,
  rawSegment: string[],
  os: SupportedPlatform,
  variables: Map<string, string>,
  includeShortOption: boolean,
): void {
  for (let index = 0; index < rawSegment.length; index++) {
    const token = rawSegment[index];
    if (
      /^(?:--?(?:output|out))$/i.test(token) ||
      (includeShortOption && /^-o$/i.test(token))
    ) {
      const target = rawSegment[index + 1];
      if (!target || isOption(target, os)) result.unsafeDynamicTarget = true;
      else pushTarget(result, target, "potential", os, variables);
      index++;
      continue;
    }
    const attached = token.match(/^(?:--?(?:output|out)(?:=|:))(.+)$/i)?.[1] ??
      (includeShortOption ? token.match(/^-o=?(.+)$/i)?.[1] : undefined);
    if (attached) pushTarget(result, attached, "potential", os, variables);
  }
}

function addFindOutputTargets(
  result: ShellWriteParseResult,
  rawSegment: string[],
  os: SupportedPlatform,
  variables: Map<string, string>,
): void {
  for (let index = 0; index < rawSegment.length; index++) {
    if (/^-(?:fprint|fprint0|fprintf|fls)$/i.test(rawSegment[index])) {
      pushTarget(
        result,
        rawSegment[index + 1],
        "destination",
        os,
        variables,
      );
      index++;
    }
  }
}

function addSortOutputTargets(
  result: ShellWriteParseResult,
  rawSegment: string[],
  os: SupportedPlatform,
  variables: Map<string, string>,
): void {
  for (let index = 0; index < rawSegment.length; index++) {
    const token = rawSegment[index];
    if (token === "-o" || token === "--output") {
      pushTarget(result, rawSegment[index + 1], "destination", os, variables);
      index++;
      continue;
    }
    const attached = token.match(/^(?:-o|--output=)(.+)$/)?.[1];
    if (attached) pushTarget(result, attached, "destination", os, variables);
  }
}

function addLessWriteTargets(
  result: ShellWriteParseResult,
  rawSegment: string[],
  os: SupportedPlatform,
  variables: Map<string, string>,
): void {
  const historyFile = variables.get("lesshistfile");
  if (historyFile) {
    pushTarget(result, historyFile, "destination", os, variables);
  }
  for (let index = 0; index < rawSegment.length; index++) {
    const token = rawSegment[index];
    if (/^(?:-[oO]|--log-file)$/i.test(token)) {
      const target = rawSegment[index + 1];
      if (!target || isOption(target, os)) result.unsafeDynamicTarget = true;
      else pushTarget(result, target, "destination", os, variables);
      index++;
      continue;
    }
    const attached = token.match(/^(?:-[oO]|--log-file=)(.+)$/i)?.[1];
    if (attached) pushTarget(result, attached, "destination", os, variables);
    if (/^\+(?:s|v|\||.*!)/i.test(token) || /^--save-marks$/i.test(token)) {
      result.unsafeDynamicTarget = true;
    }
  }
}

function addSortTemporaryTargets(
  result: ShellWriteParseResult,
  rawSegment: string[],
  os: SupportedPlatform,
  variables: Map<string, string>,
): void {
  const environmentTemp = variables.get("tmpdir");
  if (environmentTemp) {
    pushTarget(result, environmentTemp, "capability", os, variables);
  }
  for (let index = 0; index < rawSegment.length; index++) {
    const token = rawSegment[index];
    if (token === "-T" || token === "--temporary-directory") {
      const target = rawSegment[index + 1];
      if (!target || isOption(target, os)) result.unsafeDynamicTarget = true;
      else pushTarget(result, target, "capability", os, variables);
      index++;
      continue;
    }
    const attached = token.match(/^(?:-T|--temporary-directory=)(.+)$/)?.[1];
    if (attached) pushTarget(result, attached, "capability", os, variables);
    if (/^--compress-program(?:=|$)/.test(token)) {
      // sort executes this helper while creating temporary files; without a
      // separate process policy its write behavior cannot be proven safe.
      result.unsafeDynamicTarget = true;
    }
  }
}

function addGitContextTargets(
  result: ShellWriteParseResult,
  rawSegment: string[],
  os: SupportedPlatform,
  variables: Map<string, string>,
): void {
  // Even nominally read-only Git commands can refresh the index in the
  // current repository unless callers explicitly disable optional locks.
  pushTarget(result, ".", "potential", os, variables);
  for (let index = 0; index < rawSegment.length; index++) {
    const token = rawSegment[index];
    if (/^(?:-C|--git-dir|--work-tree)$/.test(token)) {
      pushTarget(result, rawSegment[index + 1], "potential", os, variables);
      index++;
      continue;
    }
    const attached = token.match(/^(?:-C|--git-dir=|--work-tree=)(.+)$/)?.[1];
    if (attached) pushTarget(result, attached, "potential", os, variables);
  }
}

function addAwkPotentialWrites(
  result: ShellWriteParseResult,
  rawSegment: string[],
  os: SupportedPlatform,
  variables: Map<string, string>,
): void {
  for (const token of rawSegment) {
    if (/\bsystem\s*\(/i.test(token)) result.unsafeDynamicTarget = true;
    if (token.includes("|")) result.unsafeDynamicTarget = true;
    if (!/[>|]/.test(token)) continue;
    let extracted = false;
    for (const match of token.matchAll(/(?:>>?)\s*["']([^"']+)["']/g)) {
      extracted = true;
      pushTarget(result, match[1], "potential", os, variables);
    }
    if (!extracted) result.unsafeDynamicTarget = true;
  }
}

function pushTarget(
  result: ShellWriteParseResult,
  raw: string | undefined,
  role: ShellWriteTarget["role"],
  os: SupportedPlatform,
  variables: Map<string, string>,
  lexical = true,
): void {
  if (!raw) {
    result.unsafeDynamicTarget = true;
    return;
  }
  const expanded = expandTarget(raw, os, variables);
  result.unsafeDynamicTarget ||= expanded.dynamic;
  result.targets.push({
    path: expanded.path,
    role,
    resolve: true,
    ...(lexical ? {} : { lexical: false }),
  });
}

function interpreterScripts(command: string): string[] {
  const scripts: string[] = [];
  const pattern =
    /(?:^|[;&|]\s*|\s)(?:python3?|node|perl|ruby)(?:\.exe)?\s+(?:-c|-e)\s+(["'])([\s\S]*?)\1|(?:^|[;&|]\s*|\s)deno(?:\.exe)?\s+eval\s+(["'])([\s\S]*?)\3/gi;
  for (const match of command.matchAll(pattern)) {
    const script = match[2] ?? match[4];
    if (script) scripts.push(script);
  }
  return scripts;
}

interface HeredocScanResult {
  command: string;
  hasInterpreterWrite: boolean;
}

function blankShellSyntax(value: string[], start: number, end: number): void {
  for (let index = start; index < end; index++) {
    if (value[index] !== "\n" && value[index] !== "\r") value[index] = " ";
  }
}

function scanHeredocBodies(command: string): HeredocScanResult {
  const chars = command.split("");
  const markerPattern = /<<-?\s*(["']?)([A-Za-z_][A-Za-z0-9_-]*)\1/g;
  let hasInterpreterWrite = false;
  let marker: RegExpExecArray | null;
  while ((marker = markerPattern.exec(command))) {
    const lineStart = command.lastIndexOf("\n", marker.index) + 1;
    const linePrefix = command.slice(lineStart, marker.index);
    const interpreter = /\b(?:python3?|node|perl|ruby)(?:\.exe)?\b/i.test(linePrefix);
    const bodyStart = command.indexOf("\n", marker.index);
    if (bodyStart < 0) break;
    const label = marker[2];
    let cursor = bodyStart + 1;
    let terminatorStart = -1;
    let terminatorEnd = -1;
    while (cursor <= command.length) {
      const lineEnd = command.indexOf("\n", cursor);
      const end = lineEnd < 0 ? command.length : lineEnd;
      const line = command.slice(cursor, end).replace(/\r$/, "");
      if (new RegExp(`^[ \\t]*${label}[ \\t]*$`).test(line)) {
        terminatorStart = cursor;
        terminatorEnd = lineEnd < 0 ? end : lineEnd + 1;
        break;
      }
      if (lineEnd < 0) break;
      cursor = lineEnd + 1;
    }
    if (terminatorStart < 0) {
      markerPattern.lastIndex = bodyStart + 1;
      continue;
    }
    if (interpreter) {
      const body = command.slice(bodyStart + 1, terminatorStart);
      hasInterpreterWrite ||= INTERPRETER_WRITE_SEMANTICS.test(body);
    }
    // Keep shell syntax on the marker line (including a trailing redirect),
    // but hide the heredoc marker/body from the generic shell tokenizer.
    blankShellSyntax(chars, marker.index, marker.index + marker[0].length);
    blankShellSyntax(chars, bodyStart + 1, terminatorEnd);
    markerPattern.lastIndex = terminatorEnd;
  }
  return { command: chars.join(""), hasInterpreterWrite };
}

function addInterpreterFallbackTargets(
  result: ShellWriteParseResult,
  command: string,
  os: SupportedPlatform,
  variables: Map<string, string>,
): void {
  for (const script of interpreterScripts(command)) {
    if (!INTERPRETER_WRITE_SEMANTICS.test(script)) continue;
    const paths: string[] = [];
    const pathPattern = os === "windows"
      ? /["']([A-Za-z]:[\\/][^"']+|\\\\[^"']+)["']/g
      : /["'](\/[^"']+)["']/g;
    for (const match of script.matchAll(pathPattern)) paths.push(match[1]);
    if (paths.length === 0) result.unsafeDynamicTarget = true;
    for (const path of paths) pushTarget(result, path, "target", os, variables);
  }
}

function sedFileOperands(tokens: string[]): string[] {
  const positional: string[] = [];
  let explicitScript = false;
  let options = true;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (options && token === "--") {
      options = false;
      continue;
    }
    if (options && (token === "-e" || token === "--expression")) {
      explicitScript = true;
      index++;
      continue;
    }
    if (
      options &&
      (/^-e.+/.test(token) || token.startsWith("--expression="))
    ) {
      explicitScript = true;
      continue;
    }
    if (options && (token === "-f" || token === "--file")) {
      explicitScript = true;
      index++;
      continue;
    }
    if (options && (/^-f.+/.test(token) || token.startsWith("--file="))) {
      explicitScript = true;
      continue;
    }
    if (options && token.startsWith("-")) continue;
    positional.push(token);
  }
  return explicitScript ? positional : positional.slice(1);
}

function copyPreservesCapabilities(
  name: string,
  rawSegment: string[],
  os: SupportedPlatform,
): boolean {
  if (
    rawSegment.some((token) =>
      token === "--no-dereference" || token === "--recursive" ||
      token === "--archive" || token === "--preserve=links" ||
      /^-[^-]*[RrdPa][^-]*$/.test(token)
    )
  ) return true;
  if (os !== "windows") return false;
  return ((name === "copy-item" || name === "cpi") &&
    rawSegment.some((token) => /^-(?:recurse|container)$/i.test(token))) ||
    name === "xcopy" || name === "robocopy";
}

export function parseShellWriteTargets(
  command: string,
  os: SupportedPlatform,
  depth = 0,
): ShellWriteParseResult {
  return parseShellWriteTargetsWithSyntax(command, os, depth, "generic");
}

function parseShellWriteTargetsWithSyntax(
  command: string,
  os: SupportedPlatform,
  depth: number,
  syntax: "generic" | "powershell" = "generic",
): ShellWriteParseResult {
  // This is a conservative target extractor, not a complete shell parser.
  // Unresolved/dynamic write targets are deliberately reported as unsafe.
  // Dedicated direct-read tools are the preferred way to inspect protected
  // content; shell reads are limited to the audited forms below.
  const result: ShellWriteParseResult = {
    targets: [],
    unsafeDynamicTarget: hasNul(command),
  };
  if (!command) return result;
  const heredoc = scanHeredocBodies(command);
  command = heredoc.command;
  result.unsafeDynamicTarget ||= heredoc.hasInterpreterWrite;
  if (depth < 3) {
    for (
      const fragment of [
        ...wrappedCommandFragments(command),
        ...commandSubstitutionFragments(command),
        ...(os === "windows" ? [] : backtickCommandFragments(command)),
        ...(syntax === "powershell" ? [] : subshellFragments(command)),
      ]
    ) {
      const nested = parseShellWriteTargetsWithSyntax(
        fragment,
        os,
        depth + 1,
        syntax,
      );
      result.targets.push(...nested.targets);
      result.unsafeDynamicTarget ||= nested.unsafeDynamicTarget;
    }
  }
  const tokens = tokenizeCommand(command, os);
  if (
    tokens.some((token) => /^LESS(?:OPEN|CLOSE)=/i.test(token)) &&
    tokens.some((token) => commandName(token) === "less")
  ) {
    result.unsafeDynamicTarget = true;
  }
  const commandIndexes = commandPositions(tokens, os);
  const variables = new Map<string, string>();
  addAssignments(tokens, variables);
  addInterpreterFallbackTargets(result, command, os, variables);
  for (let index = 0; index < tokens.length; index++) {
    if (tokens[index] === ">") {
      pushTarget(result, tokens[index + 1], "target", os, variables);
      continue;
    }
    const name = commandName(tokens[index]);
    const segment = operandsUntilBoundary(tokens, index + 1, os);
    const rawSegment = tokens.slice(index + 1, segment.end);
    const powerShellScript = commandIndexes.has(index)
      ? powerShellCommandScript(name, rawSegment, os)
      : undefined;
    if (powerShellScript && depth < 3) {
      const nested = parseShellWriteTargetsWithSyntax(
        powerShellScript,
        os,
        depth + 1,
        "powershell",
      );
      result.targets.push(...nested.targets);
      result.unsafeDynamicTarget ||= nested.unsafeDynamicTarget;
    }
    if (commandIndexes.has(index)) {
      // Scan explicit output options before any read-only allowlist decision.
      addExplicitOutputTargets(
        result,
        rawSegment,
        os,
        variables,
        !isKnownReadOnlyCommand(name, rawSegment, os),
      );
      if (name === "find") {
        addFindOutputTargets(result, rawSegment, os, variables);
      }
      if (name === "sort") {
        addSortOutputTargets(result, rawSegment, os, variables);
        addSortTemporaryTargets(result, rawSegment, os, variables);
      }
      if (name === "less") {
        addLessWriteTargets(result, rawSegment, os, variables);
      }
      if (name === "git") {
        // Git read commands may still refresh an index. Context options that
        // point at protected repositories therefore remain potential writes.
        addGitContextTargets(result, rawSegment, os, variables);
      }
    if (name === "awk") {
        addAwkPotentialWrites(result, rawSegment, os, variables);
      }
    }
    // The first positional argument of an interpreter is the script being
    // executed, not a write target. Keep scanning later arguments because a
    // script may legitimately receive an output path that still needs the
    // protected-path guard.
    if (
      commandIndexes.has(index) &&
      /^(?:python3?|node|deno|perl|ruby)$/.test(name)
    ) {
      const codeFlag = rawSegment.findIndex((token) =>
        /^(?:-c|-e|--eval|eval)$/.test(token)
      );
      if (codeFlag >= 0) continue;
      const scriptIndex = rawSegment.findIndex((token) =>
        token !== "--" && !isOption(token, os)
      );
      if (scriptIndex >= 0) {
        addPotentialWriteOperands(
          result,
          rawSegment.slice(scriptIndex + 1),
          os,
          variables,
        );
      }
      continue;
    }
    if (
      commandIndexes.has(index) &&
      powerShellScript && depth < 3
    ) {
      // The extracted script was recursively audited using PowerShell syntax.
      // Do not reinterpret the entire script text as an unknown executable's
      // path operand after that audit.
      continue;
    }
    const allOperandWriter = POSIX_ALL_OPERAND_WRITERS.has(name) ||
      (os === "windows" && WINDOWS_ALL_OPERAND_WRITERS.has(name));
    const lastOperandWriter = POSIX_LAST_OPERAND_WRITERS.has(name) ||
      (os === "windows" && WINDOWS_LAST_OPERAND_WRITERS.has(name));
    if (name === "dd") {
      const output = rawSegment.find((token) => /^of=/i.test(token));
      if (output) {
        pushTarget(
          result,
          output.slice(output.indexOf("=") + 1),
          "destination",
          os,
          variables,
        );
      } else if (rawSegment.some((token) => /^of$/i.test(token))) {
        result.unsafeDynamicTarget = true;
      }
      continue;
    }
    if (name === "sed") {
      const inPlace = rawSegment.some((token) =>
        /^-i(?:[^-].*)?$/.test(token) || token === "--in-place" ||
        token.startsWith("--in-place=")
      );
      if (inPlace) {
        for (const operand of sedFileOperands(rawSegment)) {
          pushTarget(result, operand, "target", os, variables);
        }
      }
      continue;
    }
    if (name === "ln") {
      pushTarget(result, segment.operands.at(-2), "capability", os, variables);
      pushTarget(result, segment.operands.at(-1), "destination", os, variables);
      continue;
    }
    if (os === "windows" && name === "mklink") {
      pushTarget(result, segment.operands.at(-1), "capability", os, variables);
      pushTarget(result, segment.operands.at(-2), "destination", os, variables);
      continue;
    }
    if (os === "windows" && name === "robocopy") {
      pushTarget(result, segment.operands[0], "capability", os, variables);
      pushTarget(result, segment.operands[1], "destination", os, variables);
      continue;
    }
    if (lastOperandWriter) {
      const namedSource = namedParameter(rawSegment, ["-path", "-literalpath"]);
      const destination = namedParameter(rawSegment, [
        "-destination",
        "-newname",
      ]) ??
        segment.operands.at(-1);
      const sources = namedSource
        ? namedSource.split(",").filter(Boolean)
        : segment.operands.slice(0, -1);
      let effectiveDestination = destination;
      if (
        os === "windows" && WINDOWS_RENAME_WRITERS.has(name) && sources[0] &&
        destination
      ) {
        const expandedSource = expandTarget(sources[0], os, variables);
        const expandedDestination = expandTarget(destination, os, variables);
        if (
          !expandedSource.dynamic && !expandedDestination.dynamic &&
          win32.isAbsolute(expandedSource.path) &&
          !win32.isAbsolute(expandedDestination.path)
        ) {
          effectiveDestination = win32.resolve(
            win32.dirname(expandedSource.path),
            expandedDestination.path,
          );
        }
      }
      if (WINDOWS_SOURCE_MUTATING_LAST_WRITERS.has(name)) {
        for (const source of sources) {
          pushTarget(result, source, "source", os, variables);
        }
      } else if (copyPreservesCapabilities(name, rawSegment, os)) {
        for (const source of sources) {
          pushTarget(result, source, "capability", os, variables);
        }
      }
      pushTarget(result, effectiveDestination, "destination", os, variables);
      continue;
    }
    if (allOperandWriter) {
      if (os === "windows" && WINDOWS_MULTI_PATH_WRITERS.has(name)) {
        const namedPaths = namedParameter(rawSegment, [
          "-path",
          "-literalpath",
        ]);
        const paths = (namedPaths ? [namedPaths] : segment.operands)
          .flatMap((path) => path.split(","))
          .filter(Boolean);
        for (const path of paths) {
          pushTarget(result, path, "target", os, variables);
        }
        continue;
      }
      if (
        os === "windows" &&
        WINDOWS_NAMED_PATH_WRITERS.has(name)
      ) {
        const path = namedParameter(rawSegment, [
          "-path",
          "-literalpath",
          "-filepath",
        ]) ?? segment.operands[0];
        pushTarget(result, path, "target", os, variables);
        if (
          (name === "new-item" || name === "ni") &&
          /^(?:junction|symboliclink)$/i.test(
            namedParameter(rawSegment, ["-itemtype"]) ?? "",
          )
        ) {
          pushTarget(
            result,
            namedParameter(rawSegment, ["-target", "-value"]),
            "capability",
            os,
            variables,
          );
        }
        continue;
      }
      for (const operand of segment.operands) {
        pushTarget(result, operand, "target", os, variables);
      }
      continue;
    }
    if (
      commandIndexes.has(index) &&
      !isKnownReadOnlyCommand(name, rawSegment, os)
    ) {
      // Unknown executables and interpreters may write through path operands.
      // Treat them as potential writes; protected targets are denied while
      // ordinary read commands above remain usable.
      addPotentialWriteOperands(result, rawSegment, os, variables);
    }
  }
  return result;
}

export const defaultProtectedPathPolicy = createDefaultProtectedPathPolicy();
