import { randomUUID, createHash } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { DatabaseSync } from 'node:sqlite';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import { createPreviewStore, relativePath } from './store.ts';
import { contained, verifyWorkspace } from './workspace.ts';
import { createRepositoryStore, stageIndex } from '../../requirement/node/repositories.ts';
import { createRequirementAssets } from '../../requirement/node/assets.ts';
import type { PreviewDelivery, PreviewTarget } from '../shared/contracts.ts';
const hash = (data: string | Uint8Array) => createHash('sha256').update(data).digest('hex');
const exec = promisify(execFile);
export function deliveryStore(db: DatabaseSync, account: string, space: string) {
  createRepositoryStore(db, account, space);
  db.exec(`CREATE TABLE IF NOT EXISTS requirement_preview_deliveries(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,data TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS requirement_preview_design_reads(id TEXT PRIMARY KEY,space_id TEXT NOT NULL,data TEXT NOT NULL);`);
  return {
    list: (): PreviewDelivery[] => db.prepare('SELECT data FROM requirement_preview_deliveries WHERE space_id=? ORDER BY rowid DESC LIMIT 100').all(space).map(r => JSON.parse(String(r.data))),
    get(id: string): PreviewDelivery { const row = db.prepare('SELECT data FROM requirement_preview_deliveries WHERE id=? AND space_id=?').get(id, space); if (!row) throw new Error('交付物不属于当前需求'); return JSON.parse(String(row.data)); },
    save(value: PreviewDelivery) { db.prepare('INSERT INTO requirement_preview_deliveries VALUES (?,?,?)').run(value.id, space, JSON.stringify(value)); return value; },
    reads: () => db.prepare('SELECT data FROM requirement_preview_design_reads WHERE space_id=? ORDER BY rowid DESC LIMIT 100').all(space).map(r => JSON.parse(String(r.data))),
    saveRead(value: Record<string, unknown> & { id: string }) { db.prepare('INSERT INTO requirement_preview_design_reads VALUES (?,?,?)').run(value.id, space, JSON.stringify(value)); },
  };
}
type AuthoringScope = { conversationId: string; sourceMessageId: string; stageKey: string };
export function previewAuthoring(db: DatabaseSync, root: string, account: string, space: string, scope: AuthoringScope,
  load: (name: string) => Promise<AgentTool<any>[]>, assertIdentity: () => void) {
  const store = createPreviewStore(db, account, space), records = deliveryStore(db, account, space);
  function inputs() {
    assertIdentity();
    const owned = db.prepare('SELECT request_key FROM requirement_conversations WHERE conversation_id=? AND space_id=?').get(scope.conversationId, space);
    if (!owned || owned.request_key !== scope.stageKey) throw new Error('会话阶段与需求不一致');
    const row = db.prepare('SELECT data FROM requirement_input_snapshots WHERE conversation_id=? AND message_id=? ORDER BY rowid DESC LIMIT 1').get(scope.conversationId, scope.sourceMessageId);
    if (!row) throw new Error('本轮需求输入尚未保存');
    const data = JSON.parse(String(row.data));
    if (data.discussionOnly) throw new Error('仅讨论模式不能读取代码设计或登记代码交付');
    return data;
  }
  async function target(id: string) {
    const selected = inputs(); const value = store.target(id);
    if (value.stageKey !== scope.stageKey || !selected.repositories.some((r: any) => r.id === value.repositoryId)) throw new Error('预览目标不属于本轮选中的阶段与仓库');
    const repo = createRepositoryStore(db, account, space).list().find(r => r.id === value.repositoryId);
    if (!repo) throw new Error('关联仓库已移除');
    const code = await verifyWorkspace(repo, value.workspace); assertIdentity();
    return { value, code, selected };
  }
  async function designTools(value: PreviewTarget) {
    if (!value.design.server) throw new Error('请先绑定已配置的 Figma MCP；链接本身不能读取设计');
    const tools = (await load(value.design.server)).filter(t => /_(get_design_context|get_screenshot|get_metadata|get_variable_defs|get_code_connect_map)$/.test(t.name));
    assertIdentity();
    if (!tools.length) throw new Error('该 MCP 没有公开可用的 Figma 只读设计工具，请检查配置与授权');
    return tools;
  }
  return { inputs,
    async tools(id: string) { const { value } = await target(id); return (await designTools(value)).map(t => ({ name: t.name, description: t.description, parameters: t.parameters })); },
    async read(id: string, toolName: string, args: Record<string, unknown>, signal?: AbortSignal) {
      const { value } = await target(id);
      const tool = (await designTools(value)).find(t => t.name === toolName);
      if (!tool) throw new Error('只能调用绑定 MCP 当前公开的 Figma 只读工具');
      const parameters = { ...args };
      if (value.design.url) {
        const url = new URL(value.design.url), segments = url.pathname.split('/').filter(Boolean);
        const expected: Record<string, string | null> = { fileKey: segments[1] || null, nodeId: url.searchParams.get('node-id')?.replaceAll('-', ':') || null };
        const properties = (tool.parameters as any)?.properties || {};
        for (const [key, value] of Object.entries(expected)) if (value && key in properties) {
          if (parameters[key] !== undefined && String(parameters[key]).replaceAll('-', ':') !== value) throw new Error('读取节点与绑定设计范围不一致');
          parameters[key] = value;
        }
      }
      const result = await tool.execute(randomUUID(), parameters, signal); assertIdentity();
      if ((result as any).isError) throw new Error('Figma MCP 读取失败');
      const serialized = JSON.stringify(result);
      const receiptId = randomUUID();
      const receipt = { id: receiptId, targetId: value.id, revision: value.revision, conversationId: scope.conversationId, sourceMessageId: scope.sourceMessageId,
        server: value.design.server, url: value.design.url, tool: tool.name, parameters, resultHash: hash(serialized), createdAt: Date.now() };
      const content = Buffer.byteLength(serialized) < 8 * 1024 * 1024 ? result : { truncated: true, text: result.content.filter(c => c.type === 'text').map(c => c.text).join('\n').slice(0, 100000), resultHash: receipt.resultHash };
      const asset = await createRequirementAssets(root, account, space).save({ name: `Figma设计读取-${receiptId.slice(0, 8)}.json`, stage: stageIndex(scope.stageKey), originKey: `figma:${receiptId}`, confirmed: false, bytes: Buffer.from(JSON.stringify({ receipt, content }, null, 2)) });
      assertIdentity(); records.saveRead({ ...receipt, assetId: asset.id });
      return { ...result, content: [...result.content, { type: 'text' as const, text: `Figma MCP 已实际读取；凭据 ${receiptId}，设计资产 ${asset.id}。` }] };
    },
    async deliver(id: string, summary: string, pending: string, paths: string[]) {
      const { value, code, selected } = await target(id);
      if (!summary?.trim() || summary.length > 4000 || pending.length > 4000 || !Array.isArray(paths) || !paths.length || paths.length > 100) throw new Error('交付需要摘要、待验证说明及 1 至 100 个实际代码文件');
      const reads = records.reads().filter(r => r.targetId === id && r.revision === value.revision && r.conversationId === scope.conversationId && r.sourceMessageId === scope.sourceMessageId);
      if ((value.design.server || value.design.url) && !reads.length) throw new Error('本轮尚未通过绑定的 Figma MCP 读取设计，不能登记为基于该设计的交付');
      const files: PreviewDelivery['files'] = [];
      for (const input of [...new Set(paths)]) {
        const path = relativePath(input, '交付代码文件'), actual = await contained(value.workspace!.path, path);
        const info = await stat(actual); if (!info.isFile() || info.size > 5 * 1024 * 1024) throw new Error('代码文件必须为 5MB 内的普通文件');
        const bytes = await readFile(actual);
        let change: 'added' | 'modified' | 'unchanged' = 'added';
        try { const head = await exec('git', ['-C', value.workspace!.path, 'show', `HEAD:${path}`], { encoding: 'buffer', maxBuffer: 6 * 1024 * 1024, timeout: 10000, windowsHide: true }); change = hash(head.stdout) === hash(bytes) ? 'unchanged' : 'modified'; }
        catch (e) { if (!(e as any).code || typeof (e as any).code !== 'number') throw e; }
        files.push({ path, hash: hash(bytes), change });
      }
      assertIdentity(); await target(id);
      const delivery: PreviewDelivery = { id: randomUUID(), target: value, conversationId: scope.conversationId, sourceMessageId: scope.sourceMessageId, createdAt: Date.now(), summary: summary.trim(), pending,
        ...code, files, assetRefs: selected.assets.map((a: any) => ({ id: a.id, hash: a.hash })), designReadIds: reads.map(r => r.id), recordAssetId: '' };
      const asset = await createRequirementAssets(root, account, space).save({ name: `${value.name}-设计实现-${delivery.id.slice(0, 8)}.md`, stage: stageIndex(scope.stageKey), sourceConversationId: scope.conversationId,
        originKey: `preview-delivery:${delivery.id}`, confirmed: false, bytes: Buffer.from(`# 设计代码交付\n\n${summary}\n\n待验证：${pending || '尚未进行预览验收'}\n\n代码保留在关联仓库当前分支。此记录不代表预览已就绪或评审已通过。\n\n\`\`\`json\n${JSON.stringify(delivery, null, 2)}\n\`\`\`\n`) });
      assertIdentity(); delivery.recordAssetId = asset.id; return records.save(delivery);
    },
  };
}
