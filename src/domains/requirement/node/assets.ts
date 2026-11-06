import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile, rename, lstat } from "node:fs/promises";
import { join } from "node:path";

export interface RequirementAsset {
  id: string; name: string; stage: number; hash: string; path: string;
  versionPath: string; syncStatus: "local-only" | "pending" | "synced" | "failed";
  originKey?: string; sourceConversationId?: string; sourcePath?: string; sourceHash?: string; confirmed?: boolean;
  syncedHash?: string; syncedField?: string; customField?: string; sourceId?: string; error?: string;
  uploadReceipt?: unknown;
}
const locks = new Map<string, Promise<unknown>>();
const digest = (value: Uint8Array | string) => createHash("sha256").update(value).digest("hex");
const maxBytes = 10 * 1024 * 1024;
export function createRequirementAssets(root: string, account: string, space: string) {
  // Never use external IDs or filenames as directory components.
  const dir = join(root, "requirement-assets", digest(account), digest(space));
  const manifest = join(dir, "index.json");
  async function list(): Promise<RequirementAsset[]> {
    try { return JSON.parse(await readFile(manifest, "utf8")); }
    catch (e) { if ((e as NodeJS.ErrnoException).code === "ENOENT") return []; throw e; }
  }
  async function exclusive<T>(fn: () => Promise<T>): Promise<T> {
    const previous = locks.get(dir) ?? Promise.resolve();
    const next = previous.catch(() => {}).then(fn);
    locks.set(dir, next);
    try { return await next; } finally { if (locks.get(dir) === next) locks.delete(dir); }
  }
  async function saveIndex(rows: RequirementAsset[]) {
    await mkdir(dir, { recursive: true });
    const tmp = join(dir, `${randomUUID()}.tmp`);
    await writeFile(tmp, JSON.stringify(rows), { mode: 0o600 });
    await rename(tmp, manifest);
  }
  async function save(input: { name: string; stage: number; bytes: Uint8Array; sourceId?: string; customField?: string; originKey?: string; sourceConversationId?: string; sourcePath?: string; sourceHash?: string; confirmed?: boolean }, upload?: (asset: RequirementAsset, bytes: Uint8Array) => Promise<unknown>) {
    return exclusive(async () => {
      if (!Number.isInteger(input.stage) || input.stage < 0 || input.stage > 9) throw new Error("阶段无效");
      if (!input.bytes.length || input.bytes.length > maxBytes) throw new Error("资产必须为 10MB 以内的非空文件");
      const name = input.name.replace(/[\\/:*?"<>|\x00-\x1f]/g, "_").slice(0, 120).replace(/[. ]+$/, "");
      if (!name || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(name)) throw new Error("资产文件名无效");
      const rows = await list();
      const old = rows.find((a) => input.originKey ? a.originKey === input.originKey : input.sourceId ? a.sourceId === input.sourceId && a.stage === input.stage : a.name === name && a.stage === input.stage && !a.sourceId && !a.originKey);
      const id = old?.id ?? randomUUID();
      const hash = digest(input.bytes);
      if (old && input.sourceHash && old.sourceHash === input.sourceHash && input.confirmed === false && !upload) return old;
      if (old?.hash === hash && !upload && input.confirmed !== true) return old;
      const versionDir = join(dir, "versions", id, hash);
      await mkdir(versionDir, { recursive: true });
      const versionPath = join(versionDir, name);
      await writeFile(versionPath, input.bytes, { flag: "wx", mode: 0o600 }).catch((e) => { if (e.code !== "EEXIST") throw e; });
      const workingDir = join(dir, "working", id);
      await mkdir(workingDir, { recursive: true });
      const path = join(workingDir, name);
      // Atomic replacement avoids following a symlink placed at the working filename.
      const tmp = join(workingDir, `${randomUUID()}.tmp`);
      await writeFile(tmp, input.bytes, { mode: 0o600 }); await rename(tmp, path);
      const asset: RequirementAsset = { ...old, id, name, stage: input.stage, hash, path, versionPath,
        syncedHash: old?.syncedHash ?? (input.sourceId ? hash : undefined), syncedField: old?.syncedField ?? (old?.syncStatus === "synced" ? old.customField : undefined),
        originKey: input.originKey, sourceConversationId: input.sourceConversationId, sourcePath: input.sourcePath, sourceHash: input.sourceHash, confirmed: input.confirmed ?? true,
        sourceId: input.sourceId, customField: input.customField ?? old?.customField,
        syncStatus: (old?.syncedHash === hash || (!old && input.sourceId)) ? "synced" : upload ? "pending" : "local-only", error: undefined };
      const next = [...rows.filter((a) => a.id !== id), asset];
      await saveIndex(next); // Local version survives remote failure.
      if (upload && (asset.syncedHash !== hash || asset.syncStatus === "failed" || (asset.syncedField !== asset.customField && !asset.sourceId))) {
        try { asset.uploadReceipt = await upload(asset, input.bytes); asset.syncedHash = hash; asset.syncedField = asset.customField; asset.syncStatus = "synced"; }
        catch (e) { asset.syncStatus = "failed"; asset.error = e instanceof Error ? e.message : String(e); }
        await saveIndex(next);
      }
      return asset;
    });
  }
  return { list, save,
    async commit(id: string, upload?: (asset: RequirementAsset, bytes: Uint8Array) => Promise<unknown>, customField?: string) {
      const asset = (await list()).find((a) => a.id === id);
      if (!asset) throw new Error("资产不存在或不属于当前需求");
      const info = await lstat(asset.path);
      if (!info.isFile() || info.isSymbolicLink() || info.size > maxBytes) throw new Error("本地资产文件无效");
      return save({ ...asset, customField: customField ?? asset.customField, bytes: await readFile(asset.path), confirmed: true }, upload);
    },
    async context(stage: number, refs?: Array<{ id: string; hash: string }>) {
      const available = (await list()).filter((a) => a.stage <= stage);
      const assets = refs === undefined ? available.filter(a => a.confirmed !== false) : refs.map(ref => {
        const asset = available.find(a => a.id === ref.id);
        if (!asset || (asset.confirmed === false && asset.hash === ref.hash) || !/^[a-f0-9]{64}$/.test(ref.hash)) throw new Error("资产引用不属于本阶段或版本无效");
        return { ...asset, hash: ref.hash, versionPath: join(dir, "versions", asset.id, ref.hash, asset.name) };
      });
      const unique = [...new Map(assets.map(asset => [`${asset.id}:${asset.hash}`, asset])).values()];
      const result = [];
      for (const asset of unique) {
        const bytes = await readFile(asset.versionPath);
        if (digest(bytes) !== asset.hash) throw new Error(`资产版本校验失败：${asset.name}`);
        const isText = /\.(md|txt|json|csv)$/i.test(asset.name);
        result.push({ id: asset.id, name: asset.name, stage: asset.stage, hash: asset.hash, path: asset.versionPath, workingPath: asset.path,
          bytes: bytes.length, format: isText ? 'text' as const : 'binary' as const });
      }
      return result;
    },
  };
}
