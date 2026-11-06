// deno-lint-ignore-file no-explicit-any
import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { ProtectedPathPolicy } from "../../platform/path_policy.ts";
import { assertResolvedWritableTarget } from "../../platform/path_policy.ts";
import {
  inspectResolvedToolCallForPlatform,
  inspectToolCallForPlatform,
} from "../sandbox.ts";
import { withMutationLock } from "./mutation_lock.ts";

const guardedTools = new WeakMap<
  object,
  WeakMap<ProtectedPathPolicy, Map<string, AgentTool<any, any>>>
>();
const protectedFileTools = new WeakSet<object>();

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

/** Guard actual execution, so direct tool.execute calls cannot bypass hooks. */
export function protectFileTool<T extends AgentTool<any, any>>(
  tool: T,
  policy: ProtectedPathPolicy,
  options: {
    genericPathArguments?: boolean;
    resolveTargets?: (input: unknown) => string[] | Promise<string[]>;
    lockPath?: string;
  } = {},
): T {
  if (protectedFileTools.has(tool as object)) return tool;
  const byPolicy = guardedTools.get(tool as object);
  const guardMode = options.resolveTargets
    ? "resolved-targets"
    : options.genericPathArguments
    ? "generic"
    : "named";
  const mode = `${guardMode}:${options.lockPath ?? "default"}`;
  const cached = byPolicy?.get(policy)?.get(mode);
  if (cached) return cached as T;
  const originalExecute = tool.execute;
  const wrapped = Object.create(Object.getPrototypeOf(tool));
  const descriptors = Object.getOwnPropertyDescriptors(tool);
  Reflect.deleteProperty(descriptors, "execute");
  Object.defineProperties(wrapped, descriptors);
  const executeDescriptor = findPropertyDescriptor(tool as object, "execute");
  Object.defineProperty(wrapped, "execute", {
    configurable: executeDescriptor?.configurable ?? true,
    enumerable: executeDescriptor?.enumerable ?? false,
    writable: "writable" in (executeDescriptor ?? {})
      ? (executeDescriptor as PropertyDescriptor).writable
      : true,
    value: async (
      id: string,
      input: unknown,
      signal?: AbortSignal,
      onUpdate?: unknown,
    ) => {
      return await withMutationLock(policy, async () => {
        if (options.resolveTargets) {
          try {
            const targets = await options.resolveTargets(input);
            for (const target of targets) {
              await assertResolvedWritableTarget(target, policy);
            }
          } catch (error) {
            return blockedResult(
              error instanceof Error ? error.message : String(error),
            );
          }
          return await originalExecute.call(
            tool,
            id,
            input as any,
            signal,
            onUpdate as any,
          );
        }
        const inspectionName = options.genericPathArguments
          ? "move_file"
          : tool.name;
        const lexical = inspectToolCallForPlatform(
          policy.os,
          inspectionName,
          input,
          undefined,
          policy,
        );
        if (!lexical.allowed) {
          return blockedResult(lexical.reason ?? "protected path");
        }
        const resolved = await inspectResolvedToolCallForPlatform(
          policy.os,
          inspectionName,
          input,
          policy,
        );
        if (!resolved.allowed) {
          return blockedResult(resolved.reason ?? "protected path");
        }
        return await originalExecute.call(
          tool,
          id,
          input as any,
          signal,
          onUpdate as any,
        );
      }, { lockPath: options.lockPath });
    },
  });
  const nextByPolicy = byPolicy ?? new WeakMap();
  const byMode = nextByPolicy.get(policy) ?? new Map();
  byMode.set(mode, wrapped);
  nextByPolicy.set(policy, byMode);
  if (!byPolicy) guardedTools.set(tool as object, nextByPolicy);
  protectedFileTools.add(wrapped as object);
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

export function isProtectedFileTool(tool: object): boolean {
  return protectedFileTools.has(tool);
}
