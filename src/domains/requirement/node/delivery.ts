import { createHash } from "node:crypto";
import { lstat, readFile, readdir, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve } from "node:path";
import type { DatabaseSync } from "node:sqlite";
import { createRequirementAssets } from "./assets.ts";
import { stageIndex } from "./repositories.ts";

export function requirementDelivery(db: DatabaseSync, appRoot: string, artifactsRoot: string, accountId: string, conversationId: string) {
  const row = db.prepare(`SELECT r.space_id,r.request_key,s.account_id,w.dir_path FROM requirement_conversations r
    JOIN requirement_spaces s ON s.id=r.space_id JOIN conversations c ON c.id=r.conversation_id
    LEFT JOIN workspaces w ON w.id=c.workspace_id WHERE r.conversation_id=?`).get(conversationId);
  if (!row || row.account_id !== accountId) throw new Error("无权访问该需求会话");
  // Historical stage sessions still own deliverables after their entry points are removed.
  const stage = stageIndex(String(row.request_key), true); if (stage < 0) throw new Error("当前会话未绑定研发阶段");
  const assets = createRequirementAssets(appRoot, accountId, String(row.space_id));
  const workspacePath = row.dir_path;
  async function collect() {
    const isolated = join(artifactsRoot, "sessions", conversationId);
    const root = await realpath(workspacePath ? String(workspacePath) : isolated).catch((e) => { if (e.code === "ENOENT") return undefined; throw e; });
    const candidates = new Set<string>();
    // Only persisted successful tool deliveries count outside the isolated output directory.
    for (const message of db.prepare("SELECT content FROM messages WHERE conversation_id=? AND tool_name='present_files' AND (is_error IS NULL OR is_error=0)").all(conversationId)) {
      try {
        const result = JSON.parse(String(message.content));
        for (const file of result.details?.files || []) if (typeof file.path === "string" && file.exists === true) candidates.add(resolve(root || isolated, file.path));
      } catch { /* Old non-JSON tool output is not evidence of a file. */ }
    }
    for (const file of db.prepare("SELECT file_path FROM artifacts WHERE conversation_id=?").all(conversationId)) candidates.add(String(file.file_path));
    // Scan only this session's dedicated output directory, never a bound repository.
    let visited = 0;
    async function walk(dir: string, depth: number) {
      if (depth > 8) throw new Error("会话产物目录层级过深，请整理交付目录");
      const entries = await readdir(dir, { withFileTypes: true }).catch((e) => { if (e.code === "ENOENT") return []; throw e; });
      for (const item of entries) {
        if (++visited > 500) throw new Error("会话产物过多，请整理交付目录");
        if (item.name.startsWith(".") || ["node_modules", "__pycache__"].includes(item.name) || item.isSymbolicLink()) continue;
        const path = join(dir, item.name);
        if (item.isDirectory()) await walk(path, depth + 1);
        else if (/\.(md|txt|pdf|docx|xlsx|pptx|csv|json|html|png|jpg|jpeg|svg|zip)$/i.test(item.name)) candidates.add(path);
      }
    }
    if (!workspacePath) await walk(isolated, 0);
    const result = [];
    for (const path of candidates) {
      if (!root) throw new Error("会话产物目录不存在");
      const canonical = await realpath(path).catch(e => { if (e.code === "ENOENT") return undefined; throw e; });
      if (!canonical) continue;
      const rel = relative(root, canonical);
      // Chat may present repository files outside this session's delivery scope.
      // Exclude them before reading or saving; they must not block valid outputs.
      if (rel.startsWith("..") || isAbsolute(rel) || rel.split(/[\\/]/).some(p => p.startsWith("."))) continue;
      const info = await lstat(canonical);
      if (!info.isFile() || info.size <= 0 || info.size > 10 * 1024 * 1024) throw new Error(`交付文件必须为 10MB 以内的非空普通文件：${basename(path)}`);
      const bytes = await readFile(canonical);
      result.push(await assets.save({ name: basename(path), stage, bytes, sourceHash: createHash("sha256").update(bytes).digest("hex"), originKey: `${conversationId}:${rel}`, sourceConversationId: conversationId, sourcePath: canonical, confirmed: false }));
    }
    return result;
  }
  return { collect, stage, spaceId: String(row.space_id), stageKey: String(row.request_key), assets };
}

interface Workflow { current: string; currentLabel: string; targets: Array<{ value: string; label: string }> }
interface CompletionDependencies {
  collect: ReturnType<typeof requirementDelivery>["collect"];
  assets: ReturnType<typeof createRequirementAssets>;
  workflow: () => Promise<Workflow>;
  upload: (name: string, bytes: Uint8Array, field: string) => Promise<unknown>;
  transition: (expected: string, target: string) => Promise<Workflow>;
}
const completions = new Set<string>();
export async function collectTestingDelivery(db: DatabaseSync, conversationId: string, collect: CompletionDependencies['collect'], since = 0) {
  // Retry the latest explicitly presented workbook set, never older task outputs or input files.
  for (const row of db.prepare("SELECT content FROM messages WHERE conversation_id=? AND tool_name='present_files' AND (is_error IS NULL OR is_error=0) AND created_at>=? ORDER BY created_at DESC,rowid DESC").all(conversationId, since)) {
    try {
      const files = JSON.parse(String(row.content)).details?.files;
      if (!Array.isArray(files)) continue;
      const declared: string[] = files.filter(file => file && typeof file.path === 'string' && file.exists === true).map(file => file.path);
      if (!declared.some(path => /测试用例\.xlsx$/i.test(path))) continue;
      const paths = new Set(await Promise.all(declared.map(path => realpath(path).catch(error => {
        if (error.code === 'ENOENT') return undefined;
        throw error;
      }))));
      return (await collect()).filter(asset => asset.sourcePath && paths.has(asset.sourcePath));
    } catch (error) {
      if (error instanceof SyntaxError) continue;
      throw error;
    }
  }
  return [];
}
export async function uploadTestingDelivery(conversationId: string, field: string, requirementUrl: string, dependencies: Pick<CompletionDependencies, 'collect' | 'assets' | 'upload'>) {
  if (!field.trim()) throw new Error('请配置 TAPD 用例附件字段');
  if (completions.has(conversationId)) throw new Error('本阶段正在上传，请稍候');
  completions.add(conversationId);
  try {
    const outputs = (await dependencies.collect()).filter(asset => /(?:测试用例\.xlsx|测试覆盖矩阵\.md|测试问题清单\.md)$/i.test(asset.name));
    if (!outputs.some(asset => /\.xlsx$/i.test(asset.name))) throw new Error('尚未生成正式测试用例 Excel，未上传');
    if (!outputs.some(asset => /测试覆盖矩阵\.md$/i.test(asset.name))) throw new Error('尚未生成测试覆盖矩阵，未上传');
    const { validateTestCaseWorkbook } = await import('./test_case_workbook.ts');
    const checked = [];
    // Validate every workbook and immutable version before making any remote write.
    for (const output of outputs) {
      const bytes = await readFile(output.versionPath);
      if (createHash('sha256').update(bytes).digest('hex') !== output.hash) throw new Error(`产物版本校验失败：${output.name}`);
      if (/\.xlsx$/i.test(output.name)) await validateTestCaseWorkbook(bytes, requirementUrl);
      checked.push({ output, bytes });
    }
    const results = [];
    for (const { output, bytes } of checked) {
      const asset = await dependencies.assets.save({ ...output, bytes, customField: field, confirmed: true }, (a, data) => dependencies.upload(a.name, data, field));
      results.push({ id: asset.id, name: asset.name, syncStatus: asset.syncStatus, error: asset.error });
    }
    const failed = results.filter(asset => asset.syncStatus !== 'synced');
    if (failed.length) throw new Error(`测试产物已保存在需求资产，附件上传未全部完成：${failed.map(asset => `${asset.name}：${asset.error || '请重试'}`).join('；')}`);
    return { count: checked.length, results };
  } finally { completions.delete(conversationId); }
}
export async function completeRequirementStage(db: DatabaseSync, conversationId: string, expected: string, target: string, field: string, dependencies: CompletionDependencies) {
  if (completions.has(conversationId)) throw new Error("本阶段正在提交，请稍候");
  if (!target || !field.trim() || !expected) throw new Error("请先选择完成后的 TAPD 状态和附件字段");
  completions.add(conversationId);
  try {
    db.exec("CREATE TABLE IF NOT EXISTS requirement_completions (key TEXT PRIMARY KEY, conversation_id TEXT NOT NULL, target TEXT NOT NULL, state TEXT NOT NULL)");
    const outputs = await dependencies.collect();
    if (!outputs.length) throw new Error("当前会话尚未生成可提交的产物，请先让专家完成文档交付");
    const key = createHash("sha256").update(JSON.stringify([conversationId, target, field, outputs.map(a => [a.id, a.hash]).sort()])).digest("hex");
    const previous = db.prepare("SELECT state FROM requirement_completions WHERE key=?").get(key);
    const before = await dependencies.workflow();
    if (before.current === target && previous?.state === "completed") return { ...before, count: outputs.length };
    if (before.current !== expected && !(before.current === target && previous?.state === "uploaded")) throw new Error("TAPD 状态已变化，请刷新后重新提交");
    if (before.current === target && !previous) throw new Error("目标状态与当前状态相同，请刷新后选择流转目标");
    if (before.current !== target && !before.targets.some(t => t.value === target)) throw new Error("目标状态不允许从当前状态流转");
    db.prepare("INSERT OR IGNORE INTO requirement_completions VALUES (?,?,?,'uploading')").run(key, conversationId, target);
    for (const output of outputs) {
      const bytes = await readFile(output.versionPath);
      if (createHash("sha256").update(bytes).digest("hex") !== output.hash) throw new Error(`产物版本校验失败：${output.name}`);
      const asset = await dependencies.assets.save({ ...output, bytes, customField: field, confirmed: true }, (a, data) => dependencies.upload(a.name, data, field));
      if (asset.syncStatus !== "synced") throw new Error(`产物上传失败，TAPD 状态未推进：${asset.name}；${asset.error || "请重试"}`);
    }
    db.prepare("UPDATE requirement_completions SET state='uploaded' WHERE key=?").run(key);
    const after = await dependencies.transition(expected, target);
    db.prepare("UPDATE requirement_completions SET state='completed' WHERE key=?").run(key);
    return { ...after, count: outputs.length };
  } finally { completions.delete(conversationId); }
}
