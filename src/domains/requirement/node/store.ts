import { randomUUID } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

/** Resolve descendants through parent links without changing category semantics. */
export const ordinaryConversationCondition = `id NOT IN (
  WITH RECURSIVE owned(id) AS (
    SELECT conversation_id FROM requirement_conversations
    UNION
    SELECT c.id FROM conversations c JOIN owned o ON c.parent_id = o.id
  ) SELECT id FROM owned
)`;

export function createRequirementStore(db: DatabaseSync) {
  db.exec(`CREATE TABLE IF NOT EXISTS requirement_stage_experts (
    space_id TEXT NOT NULL REFERENCES requirement_spaces(id), stage_key TEXT NOT NULL, expert_id TEXT NOT NULL,
    PRIMARY KEY(space_id, stage_key))`);
  function assertOwner(spaceId: string, accountId: string) {
    if (!accountId || !db.prepare(
      "SELECT id FROM requirement_spaces WHERE id = ? AND account_id = ?",
    ).get(spaceId, accountId)) throw new Error("需求空间不存在或无权访问");
  }

  return {
    getStageExpert(accountId: string, spaceId: string, stageKey: string): string | undefined {
      assertOwner(spaceId, accountId);
      const row = db.prepare("SELECT expert_id FROM requirement_stage_experts WHERE space_id = ? AND stage_key = ?").get(spaceId, stageKey);
      return row ? String(row.expert_id) : undefined;
    },
    setStageExpert(accountId: string, spaceId: string, stageKey: string, expertId: string) {
      assertOwner(spaceId, accountId);
      db.prepare("INSERT INTO requirement_stage_experts VALUES (?, ?, ?) ON CONFLICT(space_id, stage_key) DO UPDATE SET expert_id = excluded.expert_id").run(spaceId, stageKey, expertId);
    },
    // Caller must validate this external identity against TAPD before opening.
    open(accountId: string, origin: string, workspaceId: string, storyId: string): string {
      if (![accountId, origin, workspaceId, storyId].every((v) => v.trim())) {
        throw new Error("需求标识不完整");
      }
      const canonicalOrigin = new URL(origin).origin;
      db.prepare(`INSERT INTO requirement_spaces
        (id, account_id, tapd_origin, tapd_workspace_id, tapd_story_id, created_at)
        VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`
      ).run(randomUUID(), accountId, canonicalOrigin, workspaceId, storyId, Date.now());
      return String(db.prepare(`SELECT id FROM requirement_spaces WHERE
        account_id = ? AND tapd_origin = ? AND tapd_workspace_id = ? AND tapd_story_id = ?`
      ).get(accountId, canonicalOrigin, workspaceId, storyId)!.id);
    },
    createTask(accountId: string, spaceId: string, title: string): string {
      assertOwner(spaceId, accountId);
      if (!title.trim()) throw new Error("任务标题不能为空");
      const id = randomUUID();
      db.prepare("INSERT INTO requirement_work_items VALUES (?, ?, ?, ?)")
        .run(id, spaceId, title.trim(), Date.now());
      return id;
    },
    listConversationIds(accountId: string, spaceId: string): string[] {
      assertOwner(spaceId, accountId);
      return db.prepare("SELECT conversation_id FROM requirement_conversations WHERE space_id = ? ORDER BY created_at")
        .all(spaceId).map((row) => String(row.conversation_id));
    },
    /** Callback must synchronously persist through this same database, with no events or network IO. */
    createConversation(
      accountId: string, spaceId: string, taskId: string | null, requestKey: string,
      persist: () => { id: string },
    ): string {
      assertOwner(spaceId, accountId);
      if (!requestKey.trim()) throw new Error("缺少创建请求标识");
      const previous = db.prepare(
        "SELECT conversation_id, work_item_id FROM requirement_conversations WHERE space_id = ? AND request_key = ?",
      ).get(spaceId, requestKey);
      if (previous) {
        if (previous.work_item_id !== taskId) throw new Error("创建请求标识已用于其他任务");
        return String(previous.conversation_id);
      }
      if (taskId && !db.prepare("SELECT id FROM requirement_work_items WHERE id = ? AND space_id = ?").get(taskId, spaceId)) {
        throw new Error("任务不属于当前需求");
      }
      db.exec("SAVEPOINT requirement_create");
      try {
        const conversation = persist();
        db.prepare("INSERT INTO requirement_conversations VALUES (?, ?, ?, ?, ?)")
          .run(conversation.id, spaceId, taskId, requestKey, Date.now());
        db.exec("RELEASE requirement_create");
        return conversation.id;
      } catch (error) {
        db.exec("ROLLBACK TO requirement_create");
        db.exec("RELEASE requirement_create");
        throw error;
      }
    },
  };
}
