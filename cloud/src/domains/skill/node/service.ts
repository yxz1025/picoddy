import type { Database } from "../../../infra/db.ts";
import { parseDocument } from 'yaml';
import { fail } from "../../../shared/errors.ts";
import { object } from "../../../shared/validation.ts";
import { parseSkillPackage, type ParsedSkillPackage } from "./package.ts";
import { createSkillStore, type SkillRow, type SkillVersionRow } from "./store.ts";

export interface SkillDto {
  id: string;
  name: string;
  description: string;
  version: string | undefined;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface SkillVersionDto {
  version: string;
  description: string;
  files: Array<{ path: string }>;
  createdAt: string;
}

export interface SkillContentDto {
  version: string;
  description: string;
  body: string;
  hasExtraFrontmatter: boolean;
  files: Array<{ path: string }>;
}

export interface SkillServiceDependencies {
  database: Database;
  maxUploadBytes: number;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function skillDto(row: SkillRow): SkillDto {
  return {
    id: row.id,
    name: row.name,
    description: row.data.description ?? "",
    version: row.data.currentVersion,
    enabled: row.data.enabled !== false,
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function versionDto(row: SkillVersionRow): SkillVersionDto {
  return {
    version: row.version,
    description: row.description,
    files: row.files.map((file) => ({ path: file.path })),
    createdAt: iso(row.created_at),
  };
}

function bodyFromValidatedSkillMarkdown(source: string): string {
  const withoutBom = source.replace(/^\uFEFF/, "");
  const frontmatter = /^---[ \t]*\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(withoutBom);
  if (!frontmatter) {
    fail(500, "INVALID_STORED_SKILL", "The current skill version has invalid SKILL.md content");
  }
  return withoutBom.slice(frontmatter[0].length).replace(/^(?:\r?\n)+/, "");
}

function hasExtraFrontmatter(source: string): boolean {
  const match = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(source.replace(/^\uFEFF/, ''));
  if (!match) fail(500, 'INVALID_STORED_SKILL', 'Invalid skill frontmatter');
  const metadata = parseDocument(match[1], { schema: 'core', merge: false, uniqueKeys: true }).toJS({ maxAliasCount: 0 });
  return Object.keys(metadata).some(key => key !== 'name' && key !== 'description');
}

function decodePackage(value: unknown, maxUploadBytes: number): Uint8Array {
  if (
    typeof value !== "string" || value.length % 4 !== 0 ||
    !/^(?:[A-Za-z\d+/]{4})*(?:[A-Za-z\d+/]{2}==|[A-Za-z\d+/]{3}=)?$/.test(value)
  ) {
    fail(400, "INVALID_BASE64", "contentBase64 must be canonical base64");
  }
  const bytes = new Uint8Array(Buffer.from(value, "base64"));
  if (bytes.byteLength > maxUploadBytes) {
    fail(413, "UPLOAD_TOO_LARGE", "Skill package exceeds the configured upload limit");
  }
  return bytes;
}

async function packageFromInput(
  input: unknown,
  maxUploadBytes: number,
): Promise<ParsedSkillPackage> {
  const body = object(input);
  if (typeof body.filename !== "string" || !body.filename || body.filename.length > 255) {
    fail(400, "INVALID_FILENAME", "filename is required");
  }
  const bytes = decodePackage(body.contentBase64, maxUploadBytes);
  try {
    return await parseSkillPackage(body.filename, bytes);
  } catch (error) {
    fail(
      400,
      "INVALID_SKILL_PACKAGE",
      error instanceof Error ? error.message : "Skill package is invalid",
    );
  }
}

function expectedVersionFrom(input: unknown, required: boolean): string | undefined {
  const body = object(input);
  const value = body.expectedVersion;
  if (value === undefined && !required) return undefined;
  if (typeof value !== "string" || !value) {
    fail(
      400,
      required ? "EXPECTED_VERSION_REQUIRED" : "INVALID_REQUEST",
      required ? "expectedVersion is required" : "expectedVersion must be a non-empty string",
    );
  }
  return value;
}

function isUniqueViolation(error: unknown): boolean {
  return !!error && typeof error === "object" && "code" in error && error.code === "23505";
}

export function createSkillService({ database, maxUploadBytes }: SkillServiceDependencies) {
  const store = createSkillStore(database);

  return {
    async rollback(ownerId: string, skillId: string, input: unknown): Promise<SkillDto> {
      const expected = expectedVersionFrom(input, true)!;
      const body = object(input);
      if (typeof body.version !== 'string' || !/^[a-f0-9]{64}$/.test(body.version)) fail(400, 'INVALID_VERSION', 'A valid version hash is required');
      try {
        const row = await store.rollback(ownerId, skillId, expected, body.version);
        if (!row) fail(404, 'NOT_FOUND', 'Skill or version not found');
        return skillDto(row);
      } catch (error) {
        if (error instanceof Error && error.message === 'SKILL_VERSION_CHANGED') fail(409, 'VERSION_CONFLICT', 'Installed skill changed; refresh before rollback');
        throw error;
      }
    },
    async list(ownerId: string): Promise<SkillDto[]> {
      return (await store.list(ownerId)).map(skillDto);
    },

    async create(ownerId: string, input: unknown): Promise<SkillDto> {
      const parsed = await packageFromInput(input, maxUploadBytes);
      try {
        return skillDto(await store.create(ownerId, parsed));
      } catch (error) {
        if (isUniqueViolation(error)) {
          fail(409, "SKILL_ALREADY_EXISTS", "A skill with this name or version already exists");
        }
        throw error;
      }
    },

    async versions(ownerId: string, skillId: string): Promise<SkillVersionDto[]> {
      const rows = await store.versions(ownerId, skillId);
      if (!rows) fail(404, "NOT_FOUND", "Skill not found");
      return rows.map(versionDto);
    },

    async content(ownerId: string, skillId: string): Promise<SkillContentDto> {
      const row = await store.currentVersion(ownerId, skillId);
      if (!row) fail(404, "NOT_FOUND", "Skill not found");
      const skillFile = row.files.find((file) => file.path === "SKILL.md");
      if (!skillFile) {
        fail(500, "INVALID_STORED_SKILL", "The current skill version has no SKILL.md");
      }

      const bytes = new Uint8Array(Buffer.from(skillFile.contentBase64, "base64"));
      let parsed: ParsedSkillPackage;
      try {
        parsed = await parseSkillPackage("SKILL.md", bytes);
      } catch {
        fail(500, "INVALID_STORED_SKILL", "The current skill version has invalid SKILL.md content");
      }
      if (parsed.name !== row.name) {
        fail(500, "INVALID_STORED_SKILL", "The current skill version name does not match its resource");
      }
      const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
      return {
        version: row.version,
        description: parsed.description,
        body: bodyFromValidatedSkillMarkdown(source),
        hasExtraFrontmatter: hasExtraFrontmatter(source),
        files: row.files.map((file) => ({ path: file.path })),
      };
    },

    async addVersion(ownerId: string, skillId: string, input: unknown): Promise<SkillDto> {
      const expectedVersion = expectedVersionFrom(input, true)!;
      const parsed = await packageFromInput(input, maxUploadBytes);
      try {
        const result = await store.addVersion(ownerId, skillId, expectedVersion, parsed);
        if (result.kind === "not_found") fail(404, "NOT_FOUND", "Skill not found");
        if (result.kind === "version_conflict") {
          fail(409, "VERSION_CONFLICT", "Skill version changed; refresh and retry");
        }
        if (result.kind === "name_mismatch") {
          fail(400, "SKILL_NAME_MISMATCH", "A new version must retain the skill name");
        }
        return skillDto(result.row);
      } catch (error) {
        if (isUniqueViolation(error)) {
          fail(409, "VERSION_ALREADY_EXISTS", "This immutable skill version already exists");
        }
        throw error;
      }
    },

    async update(ownerId: string, skillId: string, input: unknown): Promise<SkillDto> {
      const body = object(input);
      const expectedVersion = expectedVersionFrom(body, false);
      if (typeof body.enabled !== "boolean") {
        fail(400, "INVALID_REQUEST", "enabled must be a boolean");
      }
      const result = await store.updateEnabled(ownerId, skillId, body.enabled, expectedVersion);
      if (result.kind === "not_found") fail(404, "NOT_FOUND", "Skill not found");
      if (result.kind === "version_conflict") {
        fail(409, "VERSION_CONFLICT", "Skill version changed; refresh and retry");
      }
      return skillDto(result.row);
    },

    async remove(ownerId: string, skillId: string): Promise<void> {
      if (!await store.remove(ownerId, skillId)) fail(404, "NOT_FOUND", "Skill not found");
    },
  };
}

export type SkillService = ReturnType<typeof createSkillService>;
