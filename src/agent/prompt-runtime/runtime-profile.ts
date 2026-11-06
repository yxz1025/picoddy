import { createHash } from "node:crypto";
import type { PromptResources } from "./types.ts";

import type { ProtectedPathPolicy } from "../../platform/path_policy.ts";
import type { SupportedPlatform } from "../../platform/runtime.ts";
import type { SessionRoot } from "../session_root.ts";
import {
  assertCategoryModeAllowed,
  resolveCategoryProfile,
} from "./category-policy.ts";
import { assertCapabilityAssignments } from "./capability-catalog.ts";
import { canonicalJson } from "./manifest.ts";
import { resolveModeProfile } from "./mode-policy.ts";
import { assertToolMetadata } from "./tool-audit.ts";
import type { ResolvedPermissionPolicy } from "./types.ts";
import type { ResolvedToolPolicy } from "./tool-policy.ts";
import type {
  CategoryProfile,
  ExpertRuntimeProfileRef,
  ModeProfile,
  RuntimeProfile,
  SessionIntent,
} from "./types.ts";

export interface ResolveRuntimeProfileInput {
  session: SessionIntent;
  sessionRoot: SessionRoot;
  platform: SupportedPlatform;
  protectedPathPolicy?: ProtectedPathPolicy;
}

export interface RuntimeProfileDependencies {
  resolveTools(input: {
    mode: ModeProfile;
    category: CategoryProfile;
    sessionRoot: SessionRoot;
    protectedPathPolicy?: ProtectedPathPolicy;
    selectedMcpTools: SessionIntent["selectedMcpTools"];
    subagent?: SessionIntent["subagent"];
  }): ResolvedToolPolicy;
  resolvePermission(input: {
    sessionId: string;
    platform: SupportedPlatform;
    permission: SessionIntent["permission"];
    protectedPathPolicy?: ProtectedPathPolicy;
  }): ResolvedPermissionPolicy;
  loadResources(session: SessionIntent): PromptResources;
  resolveExpert?(
    session: SessionIntent,
    capabilities: {
      activeToolNames: readonly string[];
      skillNames: readonly string[];
    },
  ): Promise<ExpertRuntimeProfileRef | undefined>;
}

export async function resolveRuntimeProfile(
  input: ResolveRuntimeProfileInput,
  dependencies: RuntimeProfileDependencies,
): Promise<RuntimeProfile> {
  const { session } = input;
  assertCategoryModeAllowed(session.category, session.interactionMode);
  const mode = resolveModeProfile(session.interactionMode);
  const category = resolveCategoryProfile(
    session.category,
    session.expertOperation,
    session.skillOperation,
  );
  const toolPolicy = dependencies.resolveTools({
    mode,
    category,
    sessionRoot: input.sessionRoot,
    protectedPathPolicy: input.protectedPathPolicy,
    selectedMcpTools: session.selectedMcpTools,
    subagent: session.subagent,
  });
  const profileTools = toolPolicy.tools.map((tool) => ({ ...tool }));
  assertToolMetadata(profileTools);
  assertCapabilityAssignments(
    profileTools,
    new Set(toolPolicy.selectedMcpToolNames),
  );
  const resources = dependencies.loadResources(session);
  const expert = await dependencies.resolveExpert?.(session, {
    activeToolNames: toolPolicy.activeToolNames,
    skillNames: (resources.skills ?? []).map((skill) => skill.name),
  });
  const permissionPolicy = dependencies.resolvePermission({
    sessionId: session.sessionId,
    platform: input.platform,
    permission: session.permission,
    protectedPathPolicy: input.protectedPathPolicy,
  });
  const structuralHash = createHash("sha256").update(canonicalJson({
    session: {
      sessionId: session.sessionId,
      modelProvider: session.modelProvider,
      modelId: session.modelId,
      category: session.category,
      interactionMode: session.interactionMode,
      workspace: session.workspace,
      expertBinding: session.expertBinding,
      ...(session.connector ? { connector: session.connector } : {}),
      ...(session.subagent ? { subagent: session.subagent } : {}),
      selectedSkillNames: session.selectedSkillNames,
      selectedMcpToolNames: toolPolicy.selectedMcpToolNames,
    },
    mode,
    category,
    expert,
    activeToolNames: toolPolicy.activeToolNames,
    resourceSkillNames: (resources.skills ?? []).map((skill) => skill.name),
    resourceTemplateNames: (resources.promptTemplates ?? []).map(
      (template) => template.name,
    ),
    permission: {
      level: permissionPolicy.level,
      platform: permissionPolicy.platform,
    },
  })).digest("hex");

  return {
    session,
    mode,
    category,
    expert,
    tools: profileTools,
    activeToolNames: toolPolicy.activeToolNames,
    selectedMcpToolNames: [...toolPolicy.selectedMcpToolNames],
    resources,
    permissionPolicy,
    structuralHash,
    diagnostics: [],
  };
}
