import { createHash } from "node:crypto";

import type { QueryResultRow } from "pg";

import { assertExpertContextBudget } from "../../../agent/prompt-runtime/expert-budget.ts";
import { expertRevision } from "../../expert/node/binding.ts";
import type { Database } from "../../../infra/db.ts";
import { fail } from "../../../shared/errors.ts";
import { UUID } from "../../../shared/validation.ts";
import {
  parseSkillFiles,
  parseZipFiles,
  validatePackagePath,
  type ParsedSkillFile,
} from "../../skill/node/package.ts";
import type {
  SkillHubExpertArchiveInstaller,
  SkillHubPackageSource,
} from "./install.ts";

const EXPERT_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const SKILL_DECLARATION = /^\.\/skills\/([a-z0-9]+(?:-[a-z0-9]+)*)$/;
const PLUGIN_PATH = ".picoddy-plugin/plugin.json";
const MAX_MANIFEST_BYTES = 256 * 1024;
const MAX_PROMPT_BYTES = 128 * 1024;
const MAX_AVATAR_BYTES = 512 * 1024;
const MAX_BUNDLED_SKILLS = 64;
const MAX_EXPERT_DATA_BYTES = 64 * 1024 * 1024;
const UUID_NAMESPACE_DNS = Buffer.from("6ba7b8109dad11d180b400c04fd430c8", "hex");
const textDecoder = new TextDecoder("utf-8", { fatal: true });

interface ExpertResourceRow extends QueryResultRow {
  id: string;
  name: string;
  data: Record<string, unknown>;
  secret: string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

interface LocalizedValue {
  zh?: unknown;
  en?: unknown;
}

interface NormalizedExpertPackage {
  name: string;
  data: Record<string, unknown>;
  encodedData: string;
  summary: Omit<SkillHubInstalledExpert, "id" | "createdAt" | "updatedAt">;
  packageVersion: string;
}

export interface SkillHubInstalledExpert {
  id: string;
  name: string;
  expertType: "agent";
  nickname?: string;
  categoryId: string;
  description: string;
  icon: string;
  tags: string[];
  quickPrompts: string[];
  badge: string;
  catalogSource: "installed";
  revision: string;
  available: true;
  createdAt: string;
  updatedAt: string;
}

class InvalidExpertPackage extends Error {}

function invalid(message: string): never {
  throw new InvalidExpertPackage(message);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function decodeFile(file: ParsedSkillFile, label: string, maximum: number): Uint8Array {
  const bytes = new Uint8Array(Buffer.from(file.contentBase64, "base64"));
  if (bytes.byteLength > maximum) invalid(`${label} is too large`);
  return bytes;
}

function decodeText(file: ParsedSkillFile, label: string, maximum: number): string {
  try {
    return textDecoder.decode(decodeFile(file, label, maximum));
  } catch (error) {
    if (error instanceof InvalidExpertPackage) throw error;
    return invalid(`${label} must be valid UTF-8`);
  }
}

function localized(value: unknown, fallback = ""): string {
  if (!isRecord(value)) return fallback;
  const fields = value as LocalizedValue;
  if (typeof fields.zh === "string" && fields.zh.trim()) return fields.zh.trim();
  if (typeof fields.en === "string" && fields.en.trim()) return fields.en.trim();
  return fallback;
}

function localizedList(
  value: unknown,
  label: string,
  maximumItems: number,
  maximumLength: number,
): string[] {
  if (value == null) return [];
  if (!Array.isArray(value) || value.length > maximumItems) {
    invalid(`${label} must be an array of at most ${maximumItems} localized values`);
  }
  const result = value.map((entry, index) => {
    const item = localized(entry);
    if (!item || item.length > maximumLength || /[\u0000-\u001f\u007f]/u.test(item)) {
      invalid(`${label}[${index}] is invalid`);
    }
    return item;
  });
  if (new Set(result).size !== result.length) invalid(`${label} contains duplicates`);
  return result;
}

function printable(value: string, label: string, maximum: number): string {
  const normalized = value.trim();
  if (!normalized || normalized.length > maximum || /[\u0000-\u001f\u007f]/u.test(normalized)) {
    invalid(`${label} is invalid`);
  }
  return normalized;
}

function packageHash(files: ParsedSkillFile[]): string {
  return createHash("sha256").update(JSON.stringify(files)).digest("hex");
}

function deterministicUuid(value: string): string {
  const bytes = createHash("sha1")
    .update(UUID_NAMESPACE_DNS)
    .update(value, "utf8")
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function normalizeSource(source: SkillHubPackageSource): SkillHubPackageSource {
  const namespace = typeof source?.namespace === "string" ? source.namespace.trim() : "";
  const slug = typeof source?.slug === "string" ? source.slug.trim() : "";
  const version = typeof source?.version === "string" ? source.version.trim() : "";
  const coordinate = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
  if (
    !coordinate.test(namespace) || namespace.endsWith(".") || namespace.endsWith("-") ||
    !coordinate.test(slug) || slug.endsWith(".") || slug.endsWith("-") ||
    !version || version.length > 128 || version.startsWith("-") ||
    version === "." || version === ".." || /[\/\\\u0000-\u001f\u007f]/u.test(version)
  ) {
    invalid("SkillHub source coordinates are invalid");
  }
  return { namespace, slug, version };
}

function avatarDataUrl(
  files: Map<string, ParsedSkillFile>,
  avatar: unknown,
): string {
  if (typeof avatar !== "string" || !avatar.trim()) return "";
  const candidate = avatar.trim().startsWith("./") ? avatar.trim().slice(2) : avatar.trim();
  let path: string;
  try { path = validatePackagePath(candidate); }
  catch { return ""; }
  const file = files.get(path);
  if (!file) return "";
  const extension = path.slice(path.lastIndexOf(".")).toLowerCase();
  const mime = extension === ".png" ? "image/png"
    : extension === ".jpg" || extension === ".jpeg" ? "image/jpeg"
    : extension === ".webp" ? "image/webp"
    : "";
  if (!mime) return "";
  const bytes = new Uint8Array(Buffer.from(file.contentBase64, "base64"));
  if (bytes.byteLength > MAX_AVATAR_BYTES) return "";
  return `data:${mime};base64,${Buffer.from(bytes).toString("base64")}`;
}

function bundledSkills(
  files: ParsedSkillFile[],
  declarations: unknown,
  source: SkillHubPackageSource,
): Array<{ id: string; name: string; version: string; files: ParsedSkillFile[] }> {
  if (declarations === undefined) {
    if (files.some(file => file.path.startsWith("skills/"))) {
      invalid("expert package contains undeclared skill files");
    }
    return [];
  }
  if (!Array.isArray(declarations) || declarations.length > MAX_BUNDLED_SKILLS) {
    invalid(`skills must contain at most ${MAX_BUNDLED_SKILLS} declarations`);
  }
  const names: string[] = [];
  const declared = new Set<string>();
  for (const value of declarations) {
    if (typeof value !== "string") invalid("each skill declaration must be a string");
    const match = SKILL_DECLARATION.exec(value);
    const name = match?.[1];
    if (!name || name.length > 64 || name === "expert-manager" || declared.has(name)) {
      invalid("skill declarations must be unique ./skills/<safe-kebab-name> paths");
    }
    declared.add(name);
    names.push(name);
  }
  for (const file of files) {
    if (!file.path.startsWith("skills/")) continue;
    const name = file.path.split("/", 2)[1];
    if (!name || !declared.has(name)) invalid("expert package contains undeclared skill files");
  }
  return names.map(name => {
    const prefix = `skills/${name}/`;
    const skillFiles = files
      .filter(file => file.path.startsWith(prefix))
      .map(file => ({ path: file.path.slice(prefix.length), contentBase64: file.contentBase64 }));
    if (skillFiles.length === 0) invalid(`declared skill ${name} contains no files`);
    let parsed;
    try { parsed = parseSkillFiles(skillFiles); }
    catch { return invalid(`declared skill ${name} is invalid`); }
    if (parsed.name !== name) invalid(`declared skill ${name} has a mismatched SKILL.md name`);
    return {
      id: deterministicUuid(`${source.namespace}\0${source.slug}\0${name}`),
      name: parsed.name,
      version: parsed.version,
      files: parsed.files,
    };
  });
}

function normalizeExpertPackage(
  sourceValue: SkillHubPackageSource,
  archive: Uint8Array,
): NormalizedExpertPackage {
  const source = normalizeSource(sourceValue);
  let files: ParsedSkillFile[];
  try { files = parseZipFiles(archive, PLUGIN_PATH); }
  catch { return invalid("archive is invalid"); }
  const byPath = new Map(files.map(file => [file.path, file]));
  const pluginFile = byPath.get(PLUGIN_PATH);
  if (!pluginFile) invalid("plugin manifest is missing");
  let manifest: Record<string, unknown>;
  try {
    const parsed = JSON.parse(decodeText(pluginFile, "plugin manifest", MAX_MANIFEST_BYTES)) as unknown;
    if (!isRecord(parsed)) invalid("plugin manifest must be an object");
    manifest = parsed;
  } catch (error) {
    if (error instanceof InvalidExpertPackage) throw error;
    return invalid("plugin manifest is invalid JSON");
  }
  if (manifest.schemaVersion !== 2) invalid("schemaVersion must be 2");
  if (manifest.name !== source.slug || typeof manifest.name !== "string" || !EXPERT_ID.test(manifest.name)) {
    invalid("plugin name must match the SkillHub slug");
  }
  if (manifest.expertType !== "agent") invalid("expertType must be agent");
  const agentName = typeof manifest.agentName === "string" ? manifest.agentName.trim() : "";
  if (!EXPERT_ID.test(agentName)) invalid("agentName is invalid");
  if (!Array.isArray(manifest.agents) || manifest.agents.some(value => typeof value !== "string")) {
    invalid("agents must be an array of paths");
  }
  const agentPath = `agents/${agentName}.md`;
  if (!manifest.agents.includes(`./${agentPath}`)) invalid("primary agent is not declared");
  const promptFile = byPath.get(agentPath);
  if (!promptFile) invalid("primary agent file is missing");
  const prompt = decodeText(promptFile, "primary agent", MAX_PROMPT_BYTES);
  if (!prompt.trim() || prompt.includes("[TODO")) invalid("primary agent is incomplete");

  const name = printable(
    localized(manifest.profession, localized(manifest.displayName, source.slug)),
    "expert name",
    200,
  );
  const nicknameValue = localized(manifest.displayName);
  const nickname = nicknameValue && nicknameValue !== name
    ? printable(nicknameValue, "expert nickname", 200)
    : undefined;
  const description = printable(localized(manifest.displayDescription), "expert description", 2_000);
  const tags = localizedList(manifest.tags, "tags", 20, 64);
  const quickPrompts = localizedList(manifest.quickPrompts, "quickPrompts", 20, 500);
  if (manifest.defaultInitPrompt != null && !localized(manifest.defaultInitPrompt)) {
    invalid("defaultInitPrompt must contain non-empty localized text");
  }
  const categoryId = typeof manifest.categoryId === "string" && manifest.categoryId.trim()
    ? printable(manifest.categoryId, "categoryId", 100)
    : "12-IndustryConsultant";
  assertExpertContextBudget({
    trust: "user-supplied-untrusted",
    id: "00000000-0000-4000-8000-000000000000",
    name,
    instructions: prompt,
  });

  const packageVersion = packageHash(files);
  const icon = avatarDataUrl(byPath, manifest.avatar);
  const bundles = bundledSkills(files, manifest.skills, source);
  const data = {
    prompt,
    skillIds: [],
    expertType: "agent" as const,
    ...(nickname ? { nickname } : {}),
    categoryId,
    description,
    icon,
    tags,
    quickPrompts,
    badge: "专家市场",
    catalogSource: "installed" as const,
    available: true,
    bundledSkills: bundles,
    skillhubPackage: {
      source,
      files,
      manifest,
      version: packageVersion,
    },
  };
  const revision = expertRevision({ name, data });
  const storedData = { ...data, revision };
  const summary = {
    name,
    expertType: data.expertType,
    ...(nickname ? { nickname } : {}),
    categoryId,
    description,
    icon,
    tags,
    quickPrompts,
    badge: data.badge,
    catalogSource: data.catalogSource,
    revision,
    available: true as const,
  };
  const encodedData = JSON.stringify(storedData);
  if (Buffer.byteLength(encodedData, "utf8") > MAX_EXPERT_DATA_BYTES) {
    invalid("normalized expert data exceeds the 64 MiB limit");
  }
  return {
    name,
    packageVersion,
    summary,
    data: storedData,
    encodedData,
  };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function present(
  row: ExpertResourceRow,
  summary: NormalizedExpertPackage["summary"],
): SkillHubInstalledExpert {
  return {
    id: row.id,
    ...summary,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function storedPackage(value: unknown): { source?: Record<string, unknown>; version?: unknown } {
  return isRecord(value) ? value : {};
}

export function createSkillHubExpertArchiveInstaller(
  database: Database,
): SkillHubExpertArchiveInstaller<SkillHubInstalledExpert> {
  return {
    async validateAndInstall(input) {
      if (!UUID.test(input.ownerId)) fail(400, "INVALID_OWNER", "Owner is invalid");
      let normalized: NormalizedExpertPackage;
      try { normalized = normalizeExpertPackage(input.source, input.archive); }
      catch (error) {
        if (error && typeof error === "object" && "status" in error) throw error;
        fail(400, "INVALID_SKILLHUB_EXPERT_PACKAGE", "Downloaded SkillHub expert package is invalid");
      }
      const source = (normalized.data.skillhubPackage as { source: SkillHubPackageSource }).source;
      return database.transaction(async client => {
        const owner = await client.query(
          "SELECT id FROM users WHERE id=$1 AND disabled_at IS NULL FOR UPDATE",
          [input.ownerId],
        );
        if (!owner.rows[0]) fail(404, "NOT_FOUND", "Owner not found");
        const current = await client.query<ExpertResourceRow>(
          `SELECT id,name,data,secret,created_at,updated_at FROM resources
            WHERE owner_id=$1 AND kind='expert' AND deleted_at IS NULL
              AND data->'skillhubPackage'->'source'->>'namespace'=$2
              AND data->'skillhubPackage'->'source'->>'slug'=$3
            FOR UPDATE`,
          [input.ownerId, source.namespace, source.slug],
        );
        const existing = current.rows[0];
        if (existing) {
          const stored = storedPackage(existing.data.skillhubPackage);
          const storedSource = isRecord(stored.source) ? stored.source : {};
          if (storedSource.version === source.version) {
            if (stored.version !== normalized.packageVersion) {
              fail(
                409,
                "SKILLHUB_VERSION_CHANGED",
                "The published SkillHub version changed unexpectedly",
              );
            }
            return present(existing, normalized.summary);
          }
          const updated = await client.query<ExpertResourceRow>(
            `UPDATE resources SET name=$3,data=$4::jsonb,updated_at=now()
              WHERE id=$1 AND owner_id=$2 AND kind='expert' AND deleted_at IS NULL
              RETURNING id,name,data,secret,created_at,updated_at`,
            [existing.id, input.ownerId, normalized.name, normalized.encodedData],
          );
          if (!updated.rows[0]) fail(409, "EXPERT_CHANGED", "Installed expert changed during update");
          return present(updated.rows[0], normalized.summary);
        }
        const created = await client.query<ExpertResourceRow>(
          `INSERT INTO resources(owner_id,kind,name,data)
            VALUES($1,'expert',$2,$3::jsonb)
            RETURNING id,name,data,secret,created_at,updated_at`,
          [input.ownerId, normalized.name, normalized.encodedData],
        );
        return present(created.rows[0]!, normalized.summary);
      });
    },
  };
}
