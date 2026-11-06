import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";
import { createRequirementAssets } from "./assets.ts";
import { createRepositoryStore, referenceRepository, stageIndex, type Selection } from "./repositories.ts";

export function createRequirementInputs(db: DatabaseSync, root: string, account: string, space: string) {
  const repositories = createRepositoryStore(db, account, space);
  const assets = createRequirementAssets(root, account, space);
  async function get(key: string) {
    const stage = stageIndex(key); if (stage < 0) throw new Error("阶段无效");
    const available = (await assets.list()).filter(a => a.stage <= stage && a.confirmed !== false);
    const selection = repositories.selection(key) ?? { repositories: repositories.list().map(r => r.id), assets: available.map(a => ({ id: a.id, hash: a.hash })), discussionOnly: false, repositoryScopes: Object.fromEntries(repositories.list().map(r => [r.id, r.scope])) };
    // Freeze first-entry defaults so new documents never silently change saved selections.
    if (!repositories.selection(key)) repositories.select(key, selection);
    return { repositories: repositories.list().map(r => ({ ...r, scope: selection.repositoryScopes?.[r.id] ?? r.scope })), assets: available, selection };
  }
  return { repositories, get,
    async select(key: string, selection: Selection) {
      await assets.context(stageIndex(key), selection.assets);
      repositories.select(key, selection);
      return get(key);
    },
    async freeze(key: string, conversationId: string) {
      if (!db.prepare("SELECT conversation_id FROM requirement_conversations WHERE conversation_id=? AND space_id=?").get(conversationId, space)) throw new Error("会话不属于当前需求");
      const value = await get(key);
      if (stageIndex(key) >= 3 && stageIndex(key) !== 7 && !value.selection.discussionOnly && !value.selection.repositories.length) throw new Error("请关联代码仓库，或选择仅讨论方案");
      const id = randomUUID();
      const selected = value.selection.discussionOnly ? [] : value.selection.repositories.map(id => {
        const repo = value.repositories.find(r => r.id === id); if (!repo) throw new Error("仓库关联已失效"); return repo;
      });
      const references = [];
      for (const repo of selected) references.push(await referenceRepository(repo));
      const assetRefs = await assets.context(stageIndex(key), value.selection.assets);
      // This freezes input selections and revision metadata, not a copy of the source tree.
      const hasPreviews = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='requirement_preview_targets'").get();
      const previews = hasPreviews && !value.selection.discussionOnly
        ? db.prepare("SELECT data FROM requirement_preview_targets WHERE space_id=?").all(space)
          .map(row => JSON.parse(String(row.data)))
          .filter(target => target.stageKey === key && value.selection.repositories.includes(target.repositoryId)) : [];
      const snapshot = { ...(previews.length ? { previews } : {}), id, stage: key, createdAt: new Date().toISOString(), discussionOnly: value.selection.discussionOnly,
        repositories: references, assets: assetRefs };
      db.prepare("INSERT INTO requirement_input_snapshots VALUES (?,?,NULL,?)").run(id, conversationId, JSON.stringify(snapshot));
      return snapshot;
    },
  };
}
