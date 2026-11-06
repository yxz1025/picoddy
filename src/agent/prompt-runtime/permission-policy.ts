import type { ProtectedPathPolicy } from "../../platform/path_policy.ts";
import type { ResolvedPathOptions } from "../../platform/path_policy.ts";
import type { SupportedPlatform } from "../../platform/runtime.ts";
import {
  checkToolPermissionForPlatform,
  normalizePermLevel,
  type PermLevel,
  type PermissionDecision,
} from "../permissions.ts";
import type { ResolvedPermissionPolicy } from "./types.ts";

type PermissionChecker = (
  platform: SupportedPlatform,
  sessionId: string,
  permission: PermLevel,
  toolName: string,
  args: unknown,
  protectedPathPolicy?: ProtectedPathPolicy,
  resolvedPathOptions?: ResolvedPathOptions,
) => Promise<PermissionDecision>;

export interface ResolvePermissionPolicyInput {
  sessionId: string;
  platform: SupportedPlatform;
  permission: PermLevel;
  protectedPathPolicy?: ProtectedPathPolicy;
  resolvedPathOptions?: ResolvedPathOptions;
  checkPermission?: PermissionChecker;
}

export function resolvePermissionPolicy(
  input: ResolvePermissionPolicyInput,
): ResolvedPermissionPolicy {
  const level = normalizePermLevel(input.permission);
  const checker = input.checkPermission ?? checkToolPermissionForPlatform;
  return {
    level,
    platform: input.platform,
    check: (toolName, args) => {
      const baseArgs = [
        input.platform,
        input.sessionId,
        level,
        toolName,
        args,
      ] as const;
      return input.protectedPathPolicy || input.resolvedPathOptions
        ? checker(
          ...baseArgs,
          input.protectedPathPolicy,
          input.resolvedPathOptions,
        )
        : checker(...baseArgs);
    },
  };
}
