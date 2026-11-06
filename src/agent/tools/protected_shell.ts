import type { AgentTool } from "@earendil-works/pi-agent-core";
import { type ProtectedPathPolicy } from "../../platform/path_policy.ts";
import {
  inspectResolvedToolCallForPlatform,
  inspectToolCallForPlatform,
} from "../sandbox.ts";
import { wrapProtectedShellCommand } from "../../platform/shell_sandbox.ts";
import { withMutationLock } from "./mutation_lock.ts";

const protectedShellTools = new WeakSet<object>();
const protectedShellWrappers = new WeakMap<
  object,
  WeakMap<ProtectedPathPolicy, Map<string, AgentTool<any, any>>>
>();

export function hasBackgroundShellOperator(command: string): boolean {
  let quote: "" | "'" | '"' = "";
  let escaped = false;
  for (let index = 0; index < command.length; index++) {
    const char = command[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\" && quote !== "'") {
      escaped = true;
      continue;
    }
    if (quote) {
      if (char === quote) quote = "";
      continue;
    }
    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }
    if (char !== "&") continue;
    const previous = command[index - 1] ?? "";
    const next = command[index + 1] ?? "";
    if (previous === ">" || previous === "&" || next === "&") continue;
    return true;
  }
  return false;
}

function blockedResult(reason: string) {
  return {
    content: [{
      type: "text" as const,
      text: `[安全中心拦截]: ${reason}`,
    }],
    details: { error: true, protectedPath: true },
    isError: true,
  };
}

/** Final execution-boundary guard around vendor and Windows shell tools. */
export function protectShellTool<T extends AgentTool<any, any>>(
  tool: T,
  policy: ProtectedPathPolicy,
  options: { lockPath?: string } = {},
): T {
  if (protectedShellTools.has(tool as object)) return tool;
  const byPolicy = protectedShellWrappers.get(tool as object);
  const lockKey = options.lockPath ?? "default";
  const cached = byPolicy?.get(policy)?.get(lockKey);
  if (cached) return cached as T;
  const originalExecute = tool.execute;
  const executeDescriptor = findPropertyDescriptor(tool as object, "execute");
  const wrapped = Object.create(Object.getPrototypeOf(tool));
  const descriptors = Object.getOwnPropertyDescriptors(tool);
  // Define the guarded execute implementation once so even a non-configurable
  // source descriptor can be preserved without first installing the original.
  Reflect.deleteProperty(descriptors, "execute");
  Object.defineProperties(wrapped, descriptors);
  Object.defineProperty(wrapped, "execute", {
    configurable: executeDescriptor?.configurable ?? true,
    enumerable: executeDescriptor?.enumerable ?? false,
    writable: "writable" in (executeDescriptor ?? {})
      ? (executeDescriptor as PropertyDescriptor).writable
      : true,
    value: async (
      id: string,
      input: { command?: unknown; CommandLine?: unknown },
      signal?: AbortSignal,
      onUpdate?: unknown,
    ) => {
      return await withMutationLock(policy, async () => {
        const command = String(input?.command ?? input?.CommandLine ?? "");
        if (
          !policy.nativeShellProtection && (
            hasBackgroundShellOperator(command) ||
            /\b(?:nohup|disown|setsid|start-process)\b/i.test(command) ||
            /(?:^|\s)start\s+\/b\b/i.test(command)
          )
        ) {
          return blockedResult("background shell commands are not allowed");
        }
        const lexical = inspectToolCallForPlatform(
          policy.os,
          "bash",
          input,
          undefined,
          policy,
        );
        if (!lexical.allowed) {
          return blockedResult(lexical.reason ?? "protected path");
        }
        const resolved = await inspectResolvedToolCallForPlatform(
          policy.os,
          "bash",
          input,
          policy,
        );
        if (!resolved.allowed) {
          return blockedResult(resolved.reason ?? "protected path");
        }
        return await originalExecute.call(
          tool,
          id,
          { ...input, command: wrapProtectedShellCommand(command, policy) } as any,
          signal,
          onUpdate as any,
        );
      }, { lockPath: options.lockPath });
    },
  });
  protectedShellTools.add(wrapped as object);
  const nextByPolicy = byPolicy ?? new WeakMap();
  const byLockPath = nextByPolicy.get(policy) ?? new Map();
  byLockPath.set(lockKey, wrapped);
  nextByPolicy.set(policy, byLockPath);
  if (!byPolicy) protectedShellWrappers.set(tool as object, nextByPolicy);
  return wrapped as T;
}

function findPropertyDescriptor(
  value: object,
  key: PropertyKey,
): PropertyDescriptor | undefined {
  let current: object | null = value;
  while (current) {
    const descriptor = Object.getOwnPropertyDescriptor(current, key);
    if (descriptor) return descriptor;
    current = Object.getPrototypeOf(current);
  }
  return undefined;
}

export function isProtectedShellTool(tool: object): boolean {
  return protectedShellTools.has(tool);
}
