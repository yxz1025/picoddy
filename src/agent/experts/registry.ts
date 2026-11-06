import { createHash } from "node:crypto";
import type {
  ExpertCatalogSource,
  ExpertManifest,
  ExpertSummary,
  InstalledExpertSkill,
} from "./types.ts";

const EXPERT_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/;
const DEFAULT_PROMPT_MAX_BYTES = 128 * 1024;

export interface ExpertRegistryDiagnostic {
  code: "INVALID_EXPERT_TYPE" | "INVALID_ID" | "DUPLICATE_ID" | "ID_COLLISION";
  id?: string;
  source: ExpertCatalogSource;
  message: string;
}

export interface ExpertRegistry {
  list(source?: ExpertCatalogSource): ExpertSummary[];
  get(id: string): ExpertManifest | undefined;
  diagnostics(): readonly ExpertRegistryDiagnostic[];
  replaceInstalled(entries: ExpertManifest[]): void;
  replaceCachedCatalog(entries: ExpertManifest[]): void;
}

export interface ExpertRegistryInput {
  builtins: ExpertManifest[];
  catalog: ExpertManifest[];
  installed?: ExpertManifest[];
}

export function isValidExpertId(id: string): boolean {
  return EXPERT_ID_PATTERN.test(id);
}

function stringValue(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}

function cloneInstalledSkills(value: unknown): InstalledExpertSkill[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((skill) => {
    if (!skill || typeof skill !== "object" || Array.isArray(skill)) return [];
    const candidate = skill as Partial<InstalledExpertSkill>;
    if (typeof candidate.name !== "string" || typeof candidate.root !== "string" ||
      typeof candidate.body !== "string" || typeof candidate.revision !== "string") {
      return [];
    }
    return [{
      name: candidate.name,
      root: candidate.root,
      body: candidate.body,
      description: typeof candidate.description === "string" ? candidate.description : "",
      revision: candidate.revision,
    }];
  });
}

function stableRevision(manifest: ExpertManifest): string {
  const material = JSON.stringify({
    id: manifest.id,
    name: manifest.name,
    description: manifest.description,
    prompt: manifest.prompt,
    guidelines: manifest.guidelines,
    capabilityHints: manifest.capabilityHints,
    installedSkills: manifest.installedSkills,
  });
  return createHash("sha256").update(material).digest("hex").slice(0, 16);
}

function normalizeManifest(
  input: ExpertManifest,
  source: ExpertCatalogSource,
): ExpertManifest | undefined {
  const candidate = input as Partial<ExpertManifest>;
  if (candidate.expertType !== "agent") return undefined;
  const prompt = candidate.prompt ?? { maxBytes: DEFAULT_PROMPT_MAX_BYTES };
  const maxBytes = Number.isFinite(prompt.maxBytes) && prompt.maxBytes > 0
    ? Math.floor(prompt.maxBytes)
    : DEFAULT_PROMPT_MAX_BYTES;
  const installedSkills = cloneInstalledSkills(candidate.installedSkills);
  const normalized: ExpertManifest = {
    id: stringValue(candidate.id),
    name: stringValue(candidate.name, stringValue(candidate.id)),
    expertType: "agent",
    ...(candidate.nickname ? { nickname: stringValue(candidate.nickname) } : {}),
    categoryId: stringValue(candidate.categoryId, "uncategorized"),
    description: stringValue(candidate.description),
    icon: stringValue(candidate.icon),
    tags: stringArray(candidate.tags),
    quickPrompts: stringArray(candidate.quickPrompts),
    ...(candidate.badge ? { badge: stringValue(candidate.badge) } : {}),
    catalogSource: source,
    revision: stringValue(candidate.revision),
    available: Boolean(candidate.available),
    prompt: {
      ...(typeof prompt.inline === "string" ? { inline: prompt.inline } : {}),
      ...(typeof prompt.remotePath === "string"
        ? { remotePath: prompt.remotePath }
        : {}),
      ...(typeof prompt.sha256 === "string" ? { sha256: prompt.sha256 } : {}),
      maxBytes,
    },
    guidelines: stringArray(candidate.guidelines),
    capabilityHints: {
      preferredTools: stringArray(candidate.capabilityHints?.preferredTools),
      bundledSkills: stringArray(candidate.capabilityHints?.bundledSkills),
    },
    ...(installedSkills.length > 0
      ? { installedSkills }
      : {}),
    ...(candidate.outputPolicy
      ? { outputPolicy: stringArray(candidate.outputPolicy) }
      : {}),
    ...(candidate.riskNotes ? { riskNotes: stringArray(candidate.riskNotes) } : {}),
  };

  if (!normalized.revision) normalized.revision = stableRevision(normalized);
  if (typeof candidate.available !== "boolean") {
    normalized.available = Boolean(
      normalized.prompt.inline?.trim() || normalized.prompt.remotePath?.trim(),
    );
  }
  return normalized;
}

function cloneManifest(manifest: ExpertManifest): ExpertManifest {
  return {
    ...manifest,
    ...(manifest.nickname ? { nickname: manifest.nickname } : {}),
    ...(manifest.badge ? { badge: manifest.badge } : {}),
    tags: [...manifest.tags],
    quickPrompts: [...manifest.quickPrompts],
    prompt: { ...manifest.prompt },
    guidelines: [...manifest.guidelines],
    capabilityHints: {
      preferredTools: [...manifest.capabilityHints.preferredTools],
      bundledSkills: [...manifest.capabilityHints.bundledSkills],
    },
    ...(manifest.installedSkills
      ? { installedSkills: cloneInstalledSkills(manifest.installedSkills) }
      : {}),
    ...(manifest.outputPolicy ? { outputPolicy: [...manifest.outputPolicy] } : {}),
    ...(manifest.riskNotes ? { riskNotes: [...manifest.riskNotes] } : {}),
  };
}

function toSummary(manifest: ExpertManifest): ExpertSummary {
  const { prompt: _prompt, guidelines: _guidelines, capabilityHints: _hints,
    installedSkills: _installedSkills, outputPolicy: _outputPolicy, riskNotes: _riskNotes, ...summary } = cloneManifest(manifest);
  return summary;
}

/**
 * Build the process-local expert catalog. Built-ins are inserted first and
 * always win an id collision with catalog data.
 */
export function createExpertRegistry(input: ExpertRegistryInput): ExpertRegistry {
  let installed = [...(input.installed ?? [])];
  let cachedCatalog: ExpertManifest[] = [];
  let manifests = new Map<string, ExpertManifest>();
  let diagnostics: ExpertRegistryDiagnostic[] = [];

  const rebuild = () => {
    const next = new Map<string, ExpertManifest>();
    const nextDiagnostics: ExpertRegistryDiagnostic[] = [];
    const sources: Array<[ExpertCatalogSource, ExpertManifest[]]> = [
      ["builtin", input.builtins],
      ["installed", installed],
      ["catalog", cachedCatalog],
      ["catalog", input.catalog],
    ];
    for (const [source, entries] of sources) {
      for (const raw of entries) {
        const manifest = normalizeManifest(raw, source);
        if (!manifest) {
          const id = stringValue(raw.id);
          nextDiagnostics.push({
            code: "INVALID_EXPERT_TYPE",
            id: id || undefined,
            source,
            message: `Expert ${id || "<empty>"} must have expertType \"agent\"`,
          });
          continue;
        }
        if (!isValidExpertId(manifest.id)) {
          nextDiagnostics.push({
            code: "INVALID_ID",
            id: manifest.id || undefined,
            source,
            message: `Invalid expert id: ${manifest.id || "<empty>"}`,
          });
          continue;
        }
        if (next.has(manifest.id)) {
          nextDiagnostics.push({
            code: source === "builtin" ? "DUPLICATE_ID" : "ID_COLLISION",
            id: manifest.id,
            source,
            message: `${source} expert ${manifest.id} ignored because a higher-priority definition exists`,
          });
          continue;
        }
        next.set(manifest.id, manifest);
      }
    }
    manifests = next;
    diagnostics = nextDiagnostics;
  };
  rebuild();

  return {
    list: (source) => [...manifests.values()]
      .filter((manifest) => !source || manifest.catalogSource === source)
      .map(toSummary),
    get: (id: string) => {
      if (!isValidExpertId(id)) return undefined;
      const manifest = manifests.get(id);
      return manifest ? cloneManifest(manifest) : undefined;
    },
    diagnostics: () => diagnostics.map((diagnostic) => ({ ...diagnostic })),
    replaceInstalled: (entries) => {
      installed = [...entries];
      rebuild();
    },
    replaceCachedCatalog: (entries) => {
      cachedCatalog = [...entries];
      rebuild();
    },
  };
}
