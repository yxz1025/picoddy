/** Where an expert definition came from. */
export type ExpertCatalogSource = "builtin" | "installed" | "catalog";

export type ExpertType = "agent";

/** Where the resolved prompt body came from. */
export type ExpertPromptSource = "cache" | "remote" | "inline";

/** Safe representation used by catalog/list APIs. It intentionally has no prompt body. */
export interface ExpertSummary {
  id: string;
  name: string;
  expertType: ExpertType;
  nickname?: string;
  categoryId: string;
  description: string;
  icon: string;
  tags: string[];
  quickPrompts: string[];
  badge?: string;
  catalogSource: ExpertCatalogSource;
  revision: string;
  available: boolean;
}

/** Package-local Skill material loaded only for installed expert execution. */
export interface InstalledExpertSkill {
  name: string;
  root: string;
  body: string;
  description: string;
  revision: string;
}

/** Complete, internal definition of an expert. */
export interface ExpertManifest extends ExpertSummary {
  prompt: {
    inline?: string;
    remotePath?: string;
    sha256?: string;
    maxBytes: number;
  };
  guidelines: string[];
  capabilityHints: {
    preferredTools: string[];
    bundledSkills: string[];
  };
  installedSkills?: InstalledExpertSkill[];
  outputPolicy?: string[];
  riskNotes?: string[];
}

/** The value persisted on a conversation. */
export interface ExpertBinding {
  expertId: string;
  revision: string;
  catalogSource: ExpertCatalogSource;
}
