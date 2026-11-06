import { basename, dirname, join, resolve, sep } from "node:path";
import { copyFile, open, rm, mkdir, stat } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import { Readable } from "node:stream";
import { pipeline } from "node:stream/promises";

import { readDoc } from "../../doc/node/reader.ts";
import {
  type AttachmentRecord,
  claimUnlinkedAttachment,
  deleteAttachmentRecord,
  getAttachment,
  insertAttachment,
  restoreClaimedAttachment,
} from "./store.ts";
import { platformPaths } from "../../../platform/paths.ts";
import type { AttachmentContextItem } from "../../../agent/prompt-runtime/types.ts";
import { startOperation } from "../../../infra/operation_log.ts";

export const MAX_ATTACHMENT_BYTES = 25 * 1024 * 1024;
export const MAX_ATTACHMENTS_PER_MESSAGE = 10;
export const MAX_INLINE_ATTACHMENT_TEXT_BYTES = 16 * 1024;
export const MAX_LOCAL_EXTRACTION_BYTES = 12 * 1024;

const MAX_LOCAL_EXTRACTION_FIELDS = 8;
const MAX_LOCAL_EXTRACTION_VALUES_PER_FIELD = 500;
const MAX_LOCAL_EXTRACTION_STRING_CHARS = 512;

export const ASSET_ONLY_ATTACHMENT_EXTENSIONS = new Set([
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "svg",
  "ico",
  "ttf",
  "otf",
  "woff",
  "woff2",
]);

export const ALLOWED_ATTACHMENT_EXTENSIONS = new Set([
  "pdf",
  "docx",
  "xlsx",
  "csv",
  "pptx",
  "txt",
  "md",
  "markdown",
  "json",
  "ts",
  "tsx",
  "js",
  "jsx",
  "py",
  "java",
  "go",
  "rs",
  "c",
  "cpp",
  "h",
  "css",
  "html",
  "xml",
  "yaml",
  "yml",
  "toml",
  "sql",
  "sh",
  ...ASSET_ONLY_ATTACHMENT_EXTENSIONS,
]);

const DIRECT_TEXT_ATTACHMENT_EXTENSIONS = new Set([
  "txt",
  "md",
  "markdown",
  "csv",
  "json",
  "ts",
  "tsx",
  "js",
  "jsx",
  "py",
  "java",
  "go",
  "rs",
  "c",
  "cpp",
  "h",
  "css",
  "html",
  "xml",
  "yaml",
  "yml",
  "toml",
  "sql",
  "sh",
]);

export function resolveAttachmentTurnQuery(
  visibleText: string,
  attachmentIds: string[],
): string {
  if (visibleText.trim() === "" && attachmentIds.length > 0) {
    return "请分析附件内容";
  }
  return visibleText;
}

interface ValidatedUpload {
  file: File;
  name: string;
  extension: string;
}

export interface LocalAttachmentFile {
  path: string;
  mimeType?: string;
}

function attachmentsRoot(): string {
  return platformPaths.join(platformPaths.appDataDir, "attachments");
}

function validateUpload(file: File): ValidatedUpload {
  if (file.size > MAX_ATTACHMENT_BYTES) {
    throw new Error("Attachment exceeds the 25 MB size limit");
  }
  if (file.name.includes("\0")) {
    throw new Error("Attachment has an invalid filename");
  }

  const name = basename(file.name.replaceAll("\\", "/"));
  if (name === "" || name === "." || name === "..") {
    throw new Error("Attachment has an invalid filename");
  }

  const extensionIndex = name.lastIndexOf(".");
  const bareExtension = extensionIndex < 0
    ? ""
    : name.slice(extensionIndex + 1).toLowerCase();
  if (!ALLOWED_ATTACHMENT_EXTENSIONS.has(bareExtension)) {
    throw new Error("Attachment has an unsupported file extension");
  }

  return { file, name, extension: bareExtension };
}

async function removeDirectoryIfPresent(path: string): Promise<void> {
  try {
    await rm(path, { recursive: true });
  } catch (error) {
    if (!((error as { code?: string }).code === "ENOENT")) throw error;
  }
}

export async function saveUploadedFiles(
  files: File[],
): Promise<AttachmentRecord[]> {
  if (files.length === 0) {
    throw new Error("At least one attachment is required");
  }
  if (files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new Error("A message can have at most 10 attachments");
  }

  const uploads = files.map(validateUpload);
  const records: AttachmentRecord[] = [];
  const savedDirectories: string[] = [];

  try {
    for (const upload of uploads) {
      const id = crypto.randomUUID();
      const directory = join(attachmentsRoot(), id);
      const filePath = join(directory, upload.name);
      const record: AttachmentRecord = {
        id,
        name: upload.name,
        filePath,
        mimeType: upload.file.type,
        extension: upload.extension,
        size: upload.file.size,
      };

      try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        const destination = await open(filePath, "wx", 0o600);
        try {
          await pipeline(
            Readable.fromWeb(upload.file.stream()),
            destination.createWriteStream(),
          );
        } catch (error) {
          try {
            destination.close();
          } catch {
            // pipeline may already have closed the file.
          }
          throw error;
        }
        insertAttachment(record);
      } catch {
        try {
          await removeDirectoryIfPresent(directory);
        } catch {
          // Preserve the primary save failure.
        }
        throw new Error(`Failed to save attachment "${upload.name}"`);
      }

      records.push(record);
      savedDirectories.push(directory);
    }

    return records;
  } catch (primaryError) {
    for (let index = records.length - 1; index >= 0; index--) {
      try {
        deleteAttachmentRecord(records[index].id);
      } catch {
        // Preserve the primary save failure.
      }
      try {
        await removeDirectoryIfPresent(savedDirectories[index]);
      } catch {
        // Preserve the primary save failure.
      }
    }
    throw primaryError;
  }
}

export async function saveLocalFiles(
  files: readonly LocalAttachmentFile[],
): Promise<AttachmentRecord[]> {
  if (files.length === 0) {
    throw new Error("At least one attachment is required");
  }
  if (files.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new Error("A message can have at most 10 attachments");
  }

  const records: AttachmentRecord[] = [];
  const savedDirectories: string[] = [];

  try {
    for (const source of files) {
      if (typeof source.path !== "string" || source.path.length === 0) {
        throw new Error("Attachment path is invalid");
      }
      const sourceInfo = await stat(source.path);
      if (!sourceInfo.isFile()) throw new Error("Attachment is not a file");

      const name = basename(source.path);
      const extensionIndex = name.lastIndexOf(".");
      const extension = extensionIndex < 0
        ? ""
        : name.slice(extensionIndex + 1).toLowerCase();
      if (sourceInfo.size > MAX_ATTACHMENT_BYTES) {
        throw new Error("Attachment exceeds the 25 MB size limit");
      }
      if (!ALLOWED_ATTACHMENT_EXTENSIONS.has(extension)) {
        throw new Error("Attachment has an unsupported file extension");
      }

      const id = crypto.randomUUID();
      const directory = join(attachmentsRoot(), id);
      const filePath = join(directory, name);
      const record: AttachmentRecord = {
        id,
        name,
        filePath,
        mimeType: source.mimeType || "application/octet-stream",
        extension,
        size: sourceInfo.size,
      };

      try {
        await mkdir(directory, { recursive: true, mode: 0o700 });
        await copyFile(source.path, filePath, fsConstants.COPYFILE_EXCL);
        insertAttachment(record);
      } catch {
        try {
          await removeDirectoryIfPresent(directory);
        } catch {
          // Preserve the primary save failure.
        }
        throw new Error(`Failed to save attachment "${name}"`);
      }

      records.push(record);
      savedDirectories.push(directory);
    }

    return records;
  } catch (primaryError) {
    for (let index = records.length - 1; index >= 0; index--) {
      try {
        deleteAttachmentRecord(records[index].id);
      } catch {
        // Preserve the primary save failure.
      }
      try {
        await removeDirectoryIfPresent(savedDirectories[index]);
      } catch {
        // Preserve the primary save failure.
      }
    }
    throw primaryError;
  }
}

function assertServiceManagedPath(record: AttachmentRecord): string {
  const root = resolve(attachmentsRoot());
  const directory = resolve(join(root, record.id));
  const expectedPath = resolve(join(directory, record.name));
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i
      .test(record.id) ||
    !directory.startsWith(`${root}${sep}`) ||
    dirname(resolve(record.filePath)) !== directory ||
    resolve(record.filePath) !== expectedPath
  ) {
    throw new Error("Attachment storage metadata is invalid");
  }
  return directory;
}

export async function deleteUnlinkedAttachment(id: string): Promise<boolean> {
  return (await deleteUnlinkedAttachmentDetailed(id)) === "deleted";
}

export type DeleteUnlinkedAttachmentResult = "deleted" | "linked" | "missing";

export async function deleteUnlinkedAttachmentDetailed(
  id: string,
): Promise<DeleteUnlinkedAttachmentResult> {
  const claim = claimUnlinkedAttachment(id);
  if (claim.status !== "claimed") return claim.status;

  try {
    const directory = assertServiceManagedPath(claim.record);
    await removeDirectoryIfPresent(directory);
  } catch (error) {
    try {
      restoreClaimedAttachment(claim.record);
    } catch (restoreError) {
      console.error(
        "[attachments] failed to restore metadata after delete failure:",
        restoreError,
      );
    }
    throw new Error("Failed to delete attachment", { cause: error });
  }
  return "deleted";
}

type AttachmentReader = (
  path: string,
) => Promise<{ kind: string; text: string }>;

export interface AttachmentPromptBuildOptions {
  query?: string;
}

type JsonScalar = string | number | boolean | null;

function isJsonScalar(value: unknown): value is JsonScalar {
  return value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "boolean";
}

function boundedJsonScalar(value: JsonScalar): JsonScalar {
  if (typeof value !== "string" || value.length <= MAX_LOCAL_EXTRACTION_STRING_CHARS) {
    return value;
  }
  return `${value.slice(0, MAX_LOCAL_EXTRACTION_STRING_CHARS)}…`;
}

function collectJsonKeys(value: unknown): string[] {
  const found = new Map<string, string>();
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index--) {
        stack.push(current[index]);
      }
      continue;
    }
    for (const [key, nested] of Object.entries(current)) {
      const normalized = key.toLocaleLowerCase("en-US");
      if (!found.has(normalized)) found.set(normalized, key);
      stack.push(nested);
    }
  }
  return [...found.values()];
}

function requestedJsonFields(query: string, keys: readonly string[]): string[] {
  const byNormalized = new Map(
    keys.map((key) => [key.toLocaleLowerCase("en-US"), key]),
  );
  const requested: string[] = [];
  const seen = new Set<string>();
  const add = (key: string | undefined) => {
    if (!key) return;
    const normalized = key.toLocaleLowerCase("en-US");
    if (seen.has(normalized)) return;
    seen.add(normalized);
    requested.push(key);
  };

  for (const token of query.match(/[A-Za-z_$][A-Za-z0-9_$.-]*/g) ?? []) {
    add(byNormalized.get(token.toLocaleLowerCase("en-US")));
    if (requested.length >= MAX_LOCAL_EXTRACTION_FIELDS) return requested;
  }
  for (const key of keys) {
    if (/^[\x00-\x7F]+$/.test(key) || !query.includes(key)) continue;
    add(key);
    if (requested.length >= MAX_LOCAL_EXTRACTION_FIELDS) break;
  }
  return requested;
}

function scalarIdentity(value: JsonScalar): string {
  return `${value === null ? "null" : typeof value}:${JSON.stringify(value)}`;
}

function collectScalars(value: unknown): JsonScalar[] {
  const values: JsonScalar[] = [];
  const stack: unknown[] = [value];
  while (stack.length > 0) {
    const current = stack.pop();
    if (isJsonScalar(current)) {
      values.push(current);
    } else if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index--) {
        stack.push(current[index]);
      }
    }
  }
  return values;
}

function extractJsonFields(
  text: string,
  query: string,
): AttachmentContextItem["localExtraction"] | undefined {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return undefined;
  }
  const requested = requestedJsonFields(query, collectJsonKeys(parsed));
  if (requested.length === 0) return undefined;

  const requestedByNormalized = new Map(
    requested.map((name) => [name.toLocaleLowerCase("en-US"), name]),
  );
  const allValues = new Map<string, JsonScalar[]>(
    requested.map((name) => [name, []]),
  );
  const stack: unknown[] = [parsed];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current || typeof current !== "object") continue;
    if (Array.isArray(current)) {
      for (let index = current.length - 1; index >= 0; index--) {
        stack.push(current[index]);
      }
      continue;
    }
    for (const [key, nested] of Object.entries(current)) {
      const requestedName = requestedByNormalized.get(
        key.toLocaleLowerCase("en-US"),
      );
      if (requestedName) {
        allValues.get(requestedName)?.push(...collectScalars(nested));
      }
      stack.push(nested);
    }
  }

  const extraction: NonNullable<AttachmentContextItem["localExtraction"]> = {
    kind: "json_fields",
    fields: requested.map((name) => {
      const sourceValues = allValues.get(name) ?? [];
      const unique = new Set(sourceValues.map(scalarIdentity));
      return {
        name,
        valueCount: sourceValues.length,
        uniqueValueCount: unique.size,
        values: sourceValues
          .slice(0, MAX_LOCAL_EXTRACTION_VALUES_PER_FIELD)
          .map(boundedJsonScalar),
        truncated: sourceValues.length > MAX_LOCAL_EXTRACTION_VALUES_PER_FIELD,
      };
    }),
  };

  while (
    Buffer.byteLength(JSON.stringify(extraction), "utf8") >
      MAX_LOCAL_EXTRACTION_BYTES
  ) {
    const largest = extraction.fields
      .filter((field) => field.values.length > 0)
      .sort((left, right) => right.values.length - left.values.length)[0];
    if (!largest) return undefined;
    largest.values.pop();
    largest.truncated = true;
  }
  return extraction;
}

export async function buildAttachmentPromptItemsFromRecords(
  records: readonly AttachmentRecord[],
  reader: AttachmentReader = readDoc,
  options: AttachmentPromptBuildOptions = {},
): Promise<AttachmentContextItem[]> {
  const operation = startOperation("attachment.prompt.build", {
    attachmentCount: records.length,
    attachments: records.map((record) => ({
      extension: record.extension,
      bytes: record.size,
    })),
  });
  const items: AttachmentContextItem[] = [];
  try {
    for (const record of records) {
      const base = {
        id: record.id,
        name: record.name,
        path: record.filePath,
        mimeType: record.mimeType,
        extension: record.extension,
        size: record.size,
      };
      if (ASSET_ONLY_ATTACHMENT_EXTENSIONS.has(record.extension.toLowerCase())) {
        items.push({ ...base, contentUnavailableReason: "binary_asset" });
        continue;
      }
      if (
        DIRECT_TEXT_ATTACHMENT_EXTENSIONS.has(record.extension.toLowerCase()) &&
        record.size > MAX_INLINE_ATTACHMENT_TEXT_BYTES
      ) {
        let localExtraction: AttachmentContextItem["localExtraction"];
        if (record.extension.toLowerCase() === "json" && options.query?.trim()) {
          try {
            const result = await reader(record.filePath);
            if (result.kind !== "error") {
              localExtraction = extractJsonFields(result.text, options.query);
            }
          } catch {
            // Local extraction is an optimization. The managed path remains
            // available for normal selective file/tool reads.
          }
        }
        items.push({
          ...base,
          ...(localExtraction ? { localExtraction } : {}),
          contentUnavailableReason: "large_text",
        });
        continue;
      }
      let result;
      try {
        result = await reader(record.filePath);
      } catch {
        throw new Error(`Failed to read attachment "${record.name}"`);
      }
      if (result.kind === "error") {
        throw new Error(`Failed to read attachment "${record.name}"`);
      }
      if (Buffer.byteLength(result.text, "utf8") > MAX_INLINE_ATTACHMENT_TEXT_BYTES) {
        items.push({ ...base, contentUnavailableReason: "large_text" });
      } else {
        items.push({ ...base, content: result.text });
      }
    }
    operation.success({
      parsedAttachmentCount: items.length,
      extractedChars: items.reduce((total, item) => total + (item.content?.length ?? 0), 0),
      localExtractionFieldCount: items.reduce(
        (total, item) => total + (item.localExtraction?.fields.length ?? 0),
        0,
      ),
    });
    return items;
  } catch (error) {
    operation.error(error, { parsedAttachmentCount: items.length });
    throw error;
  }
}

export async function buildAttachmentPromptItems(
  ids: string[],
  options: AttachmentPromptBuildOptions = {},
): Promise<AttachmentContextItem[]> {
  if (ids.length > MAX_ATTACHMENTS_PER_MESSAGE) {
    throw new Error("Attachment context can contain at most 10 files");
  }
  if (new Set(ids).size !== ids.length) {
    throw new Error("Duplicate attachment IDs are not allowed");
  }

  const records: AttachmentRecord[] = [];
  for (const id of ids) {
    const record = getAttachment(id);
    if (!record) throw new Error(`Attachment not found: ${id}`);
    records.push(record);
  }
  return await buildAttachmentPromptItemsFromRecords(records, readDoc, options);
}
