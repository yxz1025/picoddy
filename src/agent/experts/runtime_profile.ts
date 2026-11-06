import { join } from "node:path";
import type {
  ExpertBinding,
  ExpertManifest,
  ExpertPromptSource,
  InstalledExpertSkill,
} from "./types.ts";
import type { ResolvedExpertPrompt } from "./prompt_resolver.ts";
import type { Skill } from "@earendil-works/pi-coding-agent";

export interface ControlledPromptBlock {
  id: string;
  content: string;
  revision: string;
  trust: "controlled-extension";
}

/** 技能清单引用（循序加载：只引用 SKILL.md 位置，不承载正文）。 */
export interface SkillRef {
  name: string;
  description: string;
  location: string;
}

export interface ExpertRuntimeProfile extends ExpertBinding {
  promptSource: ExpertPromptSource;
  persona: ControlledPromptBlock;
  workflow: { items: string[] };
  alwaysOnSkills: SkillRef[];
  resourceSkills: Skill[];
  capabilityHints: string[];
}

export interface BuildExpertRuntimeProfileOptions {
  manifest: ExpertManifest;
  resolvedPrompt: ResolvedExpertPrompt;
  availableTools: ReadonlySet<string>;
  availableSkills: ReadonlySet<string>;
}

function filteredNames(
  names: readonly string[] | undefined,
  available: ReadonlySet<string>,
): string[] {
  return (names ?? []).filter((name): name is string =>
    typeof name === "string" && available.has(name)
  );
}

function installedSkillsFor(
  manifest: ExpertManifest,
): readonly InstalledExpertSkill[] {
  return manifest.installedSkills ?? [];
}

export function buildExpertRuntimeProfile(
  options: BuildExpertRuntimeProfileOptions,
): ExpertRuntimeProfile {
  const { manifest, resolvedPrompt } = options;
  const installedSkills = installedSkillsFor(manifest);
  const preferredTools = filteredNames(
    manifest.capabilityHints?.preferredTools,
    options.availableTools,
  );
  const bundledSkills = installedSkills.length > 0
    ? installedSkills.map((skill) => skill.name)
    : manifest.catalogSource === "installed"
    ? []
    : filteredNames(
      manifest.capabilityHints?.bundledSkills,
      options.availableSkills,
    );
  const alwaysOnSkills = installedSkills.map((skill) => ({
    name: skill.name,
    description: skill.description,
    location: join(skill.root, "SKILL.md"),
  }));
  const resourceSkills = installedSkills.map((skill): Skill => ({
    name: skill.name,
    description: skill.description,
    baseDir: skill.root,
    sourceInfo: { path: skill.root, source: "path", scope: "user", origin: "top-level" },
    disableModelInvocation: false,
    filePath: join(skill.root, "SKILL.md"),
  }));
  return {
    expertId: manifest.id,
    revision: manifest.revision,
    catalogSource: manifest.catalogSource,
    promptSource: resolvedPrompt.promptSource,
    persona: {
      id: `expert/${manifest.id}/persona`,
      content: resolvedPrompt.text,
      revision: resolvedPrompt.revision,
      trust: "controlled-extension",
    },
    workflow: { items: [...manifest.guidelines] },
    alwaysOnSkills,
    resourceSkills,
    capabilityHints: [
      ...preferredTools.map((name) => `preferred-tool:${name}`),
      ...bundledSkills.map((name) => `bundled-skill:${name}`),
    ],
  };
}
