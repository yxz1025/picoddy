import { createHash } from "node:crypto";

import type { LoadedPromptFragment } from "./prompt-packs.ts";
import type {
  PromptContextSnapshot,
  PromptManifest,
  RuntimeProfile,
} from "./types.ts";

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, nested]) => [key, canonicalize(nested)]),
  );
}

export function canonicalJson(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

export function buildPromptManifest(input: {
  profile: RuntimeProfile;
  snapshot: PromptContextSnapshot;
  fragments: readonly LoadedPromptFragment[];
}): PromptManifest {
  const { profile, snapshot } = input;
  const fragments = input.fragments.map((fragment) => ({
    id: fragment.id,
    surface: fragment.surface,
    order: fragment.order,
    contentHash: fragment.contentHash,
    bytes: fragment.bytes,
  }));
  const sources = Object.entries(snapshot.sourceRevisions).map(
    ([id, revision]) => ({ id, ...revision }),
  );
  const permissionSummary =
    `${profile.permissionPolicy.platform}:${profile.permissionPolicy.level}`;
  const deterministic = {
    schemaVersion: 2,
    route: {
      mode: profile.mode.id,
      category: profile.category.id,
      ...(profile.expert ? { expertId: profile.expert.expertId } : {}),
    },
    structuralHash: profile.structuralHash,
    fragments,
    sources,
    activeTools: profile.activeToolNames,
    skillNames: (profile.resources.skills ?? []).map((skill) => skill.name),
    promptTemplateNames: (profile.resources.promptTemplates ?? []).map(
      (template) => template.name,
    ),
    permissionSummary,
  };
  return {
    schemaVersion: 2,
    snapshotId: snapshot.snapshotId,
    contentHash: createHash("sha256")
      .update(canonicalJson(deterministic))
      .digest("hex"),
    route: deterministic.route,
    fragments,
    sources,
    activeTools: [...profile.activeToolNames],
    skillNames: deterministic.skillNames,
    promptTemplateNames: deterministic.promptTemplateNames,
    permissionSummary,
    diagnostics: [...profile.diagnostics, ...snapshot.diagnostics],
  };
}
