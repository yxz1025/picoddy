import {
  mkdir,
  readFile,
  rename,
  lstat,
  realpath,
  rm,
  readdir,
  writeFile,
} from "node:fs/promises";
import { join, relative, resolve, isAbsolute, sep } from "node:path";

import { platformPaths } from "../../platform/paths.ts";
import {
  resolveInstalledExpertPackage,
  InstalledExpertPackageError,
  type InstalledExpertRefreshResult,
  type InstalledExpertScanOptions,
  type ResolvedInstalledExpertPackage,
} from "./installed_catalog.ts";

const ID_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
const MAX_DRAFT_ENTRIES = 4096;
const MAX_DRAFT_BYTES = 64 * 1024 * 1024;

export type InstalledExpertManagementErrorCode =
  | "EXPERT_MANAGEMENT_INVALID_ID"
  | "EXPERT_MANAGEMENT_CONFLICT"
  | "EXPERT_MANAGEMENT_RESOLVE_FAILED"
  | "EXPERT_MANAGEMENT_IO_FAILED"
  | "EXPERT_MANAGEMENT_ROLLBACK_FAILED"
  | "EXPERT_REVISION_CONFLICT"
  | "EXPERT_DRAFT_INVALID"
  | "EXPERT_UNINSTALL_FAILED"
  | "EXPERT_RUNTIME_RELEASE_FAILED"
  | "INVALID_EXPERT_ID"
  | "MARKETPLACE_UNAVAILABLE"
  | "INVALID_MARKETPLACE"
  | "EXPERT_NOT_REGISTERED"
  | "SOURCE_OUTSIDE_PLUGINS"
  | "EXPERT_NOT_DIRECTORY"
  | "EXPERT_SYMLINK"
  | "EXPERT_PATH_ESCAPE"
  | "PLUGIN_MANIFEST_INVALID"
  | "PLUGIN_NAME_MISMATCH"
  | "EXPERT_SCHEMA_VERSION_UNSUPPORTED"
  | "NOT_AGENT_PACKAGE";

export class InstalledExpertManagementError extends Error {
  readonly code: InstalledExpertManagementErrorCode;
  readonly status: number;

  constructor(
    code: InstalledExpertManagementErrorCode,
    status: number,
    message: string,
    options?: { cause?: unknown },
  ) {
    // Messages are deliberately bounded and never include local filesystem paths.
    super(message.slice(0, 240), options);
    this.name = "InstalledExpertManagementError";
    this.code = code;
    this.status = status;
  }
}

export interface InstalledExpertManagementDependencies {
  appDataDir?: string;
  scanOptions?: InstalledExpertScanOptions;
  refresh?: () => Promise<InstalledExpertRefreshResult>;
}

export interface UninstallDependencies {
  releaseSessions(ids: string[]): Promise<void>;
  listConversationIds(id: string): string[];
  clearBindings(id: string): string[];
  refresh(): Promise<InstalledExpertRefreshResult>;
}

export interface CreateEditDraftResult {
  expertId: string;
  targetRevision: string;
  draftRoot: string;
}

export interface PublishEditInput {
  /** Conversation that owns the generated draft; used to prevent draft swaps. */
  conversationId: string;
  draftRoot: string;
  targetRevision: string;
  /** Task 3 supplies authoritative draft validation before replacement. */
  validate?: () => Promise<void>;
  /** Re-register the replacement package through the authoritative script. */
  register?: (installedExpertRoot: string) => Promise<void>;
}

interface MarketplaceSnapshot {
  text: string;
  value: Record<string, unknown>;
}

function validateId(expertId: string): string {
  const id = expertId.trim();
  if (!ID_RE.test(id)) {
    throw new InstalledExpertManagementError(
      "EXPERT_MANAGEMENT_INVALID_ID",
      400,
      "expert id is invalid",
    );
  }
  return id;
}

function within(root: string, target: string): boolean {
  const offset = relative(resolve(root), resolve(target));
  return offset !== "" && !isAbsolute(offset) && offset !== ".." && !offset.startsWith(`..${sep}`);
}

function validConversationId(value: string): boolean {
  return /^[A-Za-z0-9_-]+$/.test(value);
}

async function canonicalDraftsRoot(appDataDir: string): Promise<{ lexical: string; real: string }> {
  const lexical = resolve(appDataDir, "expert-drafts");
  await mkdir(lexical, { recursive: true });
  const info = await lstat(lexical);
  if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("managed draft root is not a regular directory");
  return { lexical, real: await realpath(lexical) };
}

async function readMarketplace(path: string): Promise<MarketplaceSnapshot> {
  try {
    const text = await readFile(path, "utf-8");
    const value = JSON.parse(text) as unknown;
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("invalid marketplace");
    const marketplace = value as Record<string, unknown>;
    if (!Array.isArray(marketplace.plugins) || marketplace.plugins.some(
      (entry) => !entry || typeof entry !== "object" || Array.isArray(entry),
    )) throw new Error("invalid marketplace plugins");
    return { text, value: marketplace };
  } catch (cause) {
    throw new InstalledExpertManagementError(
      "EXPERT_MANAGEMENT_RESOLVE_FAILED",
      404,
      "my-experts marketplace is unavailable or invalid",
      { cause },
    );
  }
}

async function writeAtomically(path: string, text: string): Promise<void> {
  const dir = resolve(path, "..");
  await mkdir(dir, { recursive: true });
  const temporary = join(dir, `.${path.split(sep).pop() ?? "manifest"}.${process.pid}.${Date.now()}.tmp`);
  try {
    await writeFile(temporary, text, "utf-8");
    await rename(temporary, path);
  } catch (cause) {
    try { await rename(temporary, join(dir, `.failed-${Date.now()}`)); } catch { /* best effort */ }
    throw cause;
  }
}

async function copyOrdinaryTree(source: string, destination: string): Promise<{ entries: number; bytes: number }> {
  let entries = 0;
  let bytes = 0;
  async function visit(from: string, to: string): Promise<void> {
    const info = await lstat(from);
    if (info.isSymbolicLink()) throw new Error("draft source contains a symbolic link");
    if (info.isDirectory()) {
      await mkdir(to, { recursive: true });
      const children = await readdir(from);
      for (const child of children) {
        entries += 1;
        if (entries > MAX_DRAFT_ENTRIES) throw new Error("draft exceeds entry limit");
        await visit(join(from, child), join(to, child));
      }
      return;
    }
    if (!info.isFile()) throw new Error("draft source contains a special file");
    bytes += info.size;
    if (bytes > MAX_DRAFT_BYTES) throw new Error("draft exceeds size limit");
    const data = await readFile(from);
    await writeFile(to, data);
  }
  await visit(source, destination);
  return { entries, bytes };
}

function revisionForPackage(pkg: ResolvedInstalledExpertPackage): string {
  return pkg.revision ?? "";
}

export class InstalledExpertManagement {
  private readonly appDataDir: string;
  private readonly scanOptions: InstalledExpertScanOptions;
  private readonly refreshCallback?: () => Promise<InstalledExpertRefreshResult>;
  private readonly locks = new Map<string, Promise<void>>();

  constructor(dependencies: InstalledExpertManagementDependencies = {}) {
    this.appDataDir = dependencies.appDataDir ?? platformPaths.appDataDir;
    this.scanOptions = dependencies.scanOptions ?? {};
    this.refreshCallback = dependencies.refresh;
  }

  private async locked<T>(expertId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.locks.get(expertId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolvePromise) => { release = resolvePromise; });
    const tail = previous.then(() => current);
    this.locks.set(expertId, tail);
    await previous;
    try {
      return await operation();
    } finally {
      release();
      if (this.locks.get(expertId) === tail) this.locks.delete(expertId);
    }
  }

  private async resolve(expertId: string): Promise<ResolvedInstalledExpertPackage> {
    try {
      return await resolveInstalledExpertPackage(expertId, this.scanOptions);
    } catch (cause) {
      if (cause instanceof InstalledExpertManagementError) throw cause;
      if (cause instanceof InstalledExpertPackageError) {
        const status = cause.code === "INVALID_EXPERT_ID" ? 400
          : cause.code === "MARKETPLACE_UNAVAILABLE" || cause.code === "EXPERT_NOT_REGISTERED" ? 404
          : 422;
        throw new InstalledExpertManagementError(cause.code, status, cause.message, { cause });
      }
      throw new InstalledExpertManagementError(
        "EXPERT_MANAGEMENT_RESOLVE_FAILED",
        404,
        "installed expert could not be resolved",
        { cause },
      );
    }
  }

  async resolveFolder(expertId: string): Promise<string> {
    const id = validateId(expertId);
    return (await this.resolve(id)).expertDir;
  }

  async createEditDraft(
    expertId: string,
    targetRevision: string,
    conversationId: string,
  ): Promise<CreateEditDraftResult> {
    const id = validateId(expertId);
    return await this.locked(id, async () => {
      const pkg = await this.resolve(id);
      const actualRevision = revisionForPackage(pkg);
      if (targetRevision.trim() !== actualRevision) {
        throw new InstalledExpertManagementError("EXPERT_REVISION_CONFLICT", 409, "installed expert changed; reopen the edit session");
      }
      if (!validConversationId(conversationId)) {
        throw new InstalledExpertManagementError("EXPERT_MANAGEMENT_IO_FAILED", 400, "conversation id is invalid");
      }
      try {
        const drafts = await canonicalDraftsRoot(this.appDataDir);
        const conversationDir = join(drafts.lexical, conversationId);
        try {
          const parentInfo = await lstat(conversationDir);
          if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink()) throw new Error("draft conversation directory is not regular");
        } catch (error) {
          if ((error as { code?: string }).code === "ENOENT") {
            await mkdir(conversationDir, { recursive: true });
          } else {
            throw error;
          }
        }
        const realConversationDir = await realpath(conversationDir);
        if (!within(drafts.real, realConversationDir)) throw new Error("draft conversation directory escapes managed root");
        const draftRoot = join(conversationDir, id);
        try {
          const existing = await lstat(draftRoot);
          if (existing.isSymbolicLink() || (!existing.isDirectory() && !existing.isFile())) {
            throw new Error("draft destination is not a regular path");
          }
          await rm(draftRoot, { recursive: true, force: true });
        } catch (error) {
          if ((error as { code?: string }).code !== "ENOENT") throw error;
        }
        await copyOrdinaryTree(pkg.expertDir, draftRoot);
        return { expertId: id, targetRevision: actualRevision, draftRoot: resolve(draftRoot) };
      } catch (cause) {
        throw new InstalledExpertManagementError("EXPERT_DRAFT_INVALID", 422, "installed expert could not be copied to a draft", { cause });
      }
    });
  }

  async publishEdit(expertId: string, input: PublishEditInput): Promise<{ expertId: string; revision: string }> {
    const id = validateId(expertId);
    return await this.locked(id, async () => {
      const pkg = await this.resolve(id);
      const actualRevision = revisionForPackage(pkg);
      if (input.targetRevision.trim() !== actualRevision) {
        throw new InstalledExpertManagementError("EXPERT_REVISION_CONFLICT", 409, "installed expert changed; reopen the edit session");
      }
      try {
        if (!validConversationId(input.conversationId)) throw new Error("conversation id is invalid");
        const drafts = await canonicalDraftsRoot(this.appDataDir);
        const expectedDraftRoot = resolve(drafts.lexical, input.conversationId, id);
        if (resolve(input.draftRoot) !== expectedDraftRoot || !within(drafts.real, expectedDraftRoot)) {
          throw new Error("draft root is not owned by this expert conversation");
        }
        const conversationInfo = await lstat(join(drafts.lexical, input.conversationId));
        if (!conversationInfo.isDirectory() || conversationInfo.isSymbolicLink()) {
          throw new Error("draft conversation directory is not regular");
        }
        const draftInfo = await lstat(input.draftRoot);
        if (!draftInfo.isDirectory() || draftInfo.isSymbolicLink()) throw new Error("draft root is not a regular directory");
        const [realDraftsRoot, realDraftRoot] = await Promise.all([
          Promise.resolve(drafts.real),
          realpath(input.draftRoot),
        ]);
        if (!within(realDraftsRoot, realDraftRoot)) throw new Error("draft root escapes the managed draft directory");
      } catch (cause) {
        throw new InstalledExpertManagementError("EXPERT_DRAFT_INVALID", 400, "draft root is invalid", { cause });
      }
      await input.validate?.();
      const marketplace = await readMarketplace(pkg.marketplacePath);
      const backup = join(pkg.pluginsDir, `.backup-${id}-${Date.now()}`);
      let oldMoved = false;
      let newMoved = false;
      try {
        await rename(pkg.expertDir, backup);
        oldMoved = true;
        await rename(input.draftRoot, pkg.expertDir);
        newMoved = true;
        await input.register?.(pkg.expertDir);
        const refreshed = await this.refreshCallback?.();
        void refreshed;
        const revision = revisionForPackage(await this.resolve(id));
        const trash = join(pkg.marketplaceDir, ".trash", `${id}-${Date.now()}-${actualRevision}`);
        await mkdir(join(pkg.marketplaceDir, ".trash"), { recursive: true });
        await rename(backup, trash);
        return { expertId: id, revision };
      } catch (cause) {
        try {
          if (newMoved) await rename(pkg.expertDir, input.draftRoot);
          if (oldMoved) await rename(backup, pkg.expertDir);
          await writeAtomically(pkg.marketplacePath, marketplace.text);
          await this.refreshCallback?.();
        } catch (rollbackCause) {
          throw new InstalledExpertManagementError("EXPERT_MANAGEMENT_ROLLBACK_FAILED", 500, "expert update failed and could not be fully restored", { cause: rollbackCause });
        }
        if (cause instanceof InstalledExpertManagementError) throw cause;
        const callbackCode = (cause as { code?: unknown }).code;
        const callbackStatus = (cause as { status?: unknown }).status;
        if (typeof callbackCode === "string" && typeof callbackStatus === "number") {
          throw cause;
        }
        throw new InstalledExpertManagementError("EXPERT_MANAGEMENT_IO_FAILED", 500, "expert update failed; original version was restored", { cause });
      }
    });
  }

  async uninstall(
    expertId: string,
    dependencies: UninstallDependencies,
  ): Promise<{ expertId: string; affectedConversationIds: string[] }> {
    const id = validateId(expertId);
    return await this.locked(id, async () => {
      const pkg = await this.resolve(id);
      const affectedConversationIds = dependencies.listConversationIds(id);
      try {
        await dependencies.releaseSessions(affectedConversationIds);
      } catch (cause) {
        const code = (cause as { code?: unknown }).code;
        if (code === "EXPERT_RUNTIME_RELEASE_FAILED") {
          throw new InstalledExpertManagementError(
            "EXPERT_RUNTIME_RELEASE_FAILED",
            typeof (cause as { status?: unknown }).status === "number"
              ? (cause as { status: number }).status
              : 409,
            "one or more expert sessions could not be safely released",
            { cause },
          );
        }
        throw new InstalledExpertManagementError(
          "EXPERT_UNINSTALL_FAILED",
          409,
          "one or more expert sessions could not be safely released",
          { cause },
        );
      }
      const marketplace = await readMarketplace(pkg.marketplacePath);
      const plugins = Array.isArray(marketplace.value.plugins) ? marketplace.value.plugins : [];
      const remaining = plugins.filter((entry) => {
        if (!entry || typeof entry !== "object" || Array.isArray(entry)) return true;
        const item = entry as Record<string, unknown>;
        return !(item.name === id && item.source === `./plugins/${id}`);
      });
      if (remaining.length === plugins.length) {
        throw new InstalledExpertManagementError("EXPERT_MANAGEMENT_RESOLVE_FAILED", 404, "installed expert is not registered");
      }
      marketplace.value.plugins = remaining;
      const unregisterText = `${JSON.stringify(marketplace.value, null, 2)}\n`;
      const trash = join(pkg.marketplaceDir, ".trash", `${id}-${Date.now()}-${revisionForPackage(pkg)}`);
      let manifestChanged = false;
      let moved = false;
      try {
        await writeAtomically(pkg.marketplacePath, unregisterText);
        manifestChanged = true;
        await mkdir(join(pkg.marketplaceDir, ".trash"), { recursive: true });
        await rename(pkg.expertDir, trash);
        moved = true;
        await dependencies.refresh();
        const cleared = dependencies.clearBindings(id);
        return { expertId: id, affectedConversationIds: cleared };
      } catch (cause) {
        try {
          if (moved) await rename(trash, pkg.expertDir);
          if (manifestChanged) await writeAtomically(pkg.marketplacePath, marketplace.text);
          await dependencies.refresh();
        } catch (rollbackCause) {
          throw new InstalledExpertManagementError("EXPERT_MANAGEMENT_ROLLBACK_FAILED", 500, "expert uninstall failed and could not be fully restored", { cause: rollbackCause });
        }
        if (cause instanceof InstalledExpertManagementError) throw cause;
        throw new InstalledExpertManagementError("EXPERT_UNINSTALL_FAILED", 500, "expert uninstall failed; original version was restored", { cause });
      }
    });
  }
}

export function createInstalledExpertManagement(
  dependencies: InstalledExpertManagementDependencies = {},
): InstalledExpertManagement {
  return new InstalledExpertManagement(dependencies);
}
