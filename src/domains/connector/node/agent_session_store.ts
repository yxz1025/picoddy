// 主会话与隐藏 connector child 会话的持久化关联。
// 每 (parent_conversation_id, connector_id) 唯一；child 以 connector-agent 类别隐藏，
// 默认会话列表不展示；parent 删除时级联销毁 child 数据。

import type { DatabaseSync } from "node:sqlite";

export interface AgentChildRecord {
  parentConversationId: string;
  connectorId: string;
  childConversationId: string;
  catalogVersion: string;
  installedVersion: string;
  createdAt: number;
}

const SELECT_AGENT_CHILD = `
  SELECT
    parent_conversation_id AS parentConversationId,
    connector_id AS connectorId,
    child_conversation_id AS childConversationId,
    catalog_version AS catalogVersion,
    installed_version AS installedVersion,
    created_at AS createdAt
  FROM connector_agent_sessions
`;

export function findAgentChild(
  db: DatabaseSync,
  parentConversationId: string,
  connectorId: string,
): AgentChildRecord | undefined {
  return db.prepare(
    `${SELECT_AGENT_CHILD} WHERE parent_conversation_id = ? AND connector_id = ?`,
  ).get(parentConversationId, connectorId) as AgentChildRecord | undefined;
}

export function createAgentChild(
  db: DatabaseSync,
  input: Omit<AgentChildRecord, "createdAt">,
): void {
  db.prepare(`
    INSERT INTO connector_agent_sessions (
      parent_conversation_id,
      connector_id,
      child_conversation_id,
      catalog_version,
      installed_version,
      created_at
    ) VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    input.parentConversationId,
    input.connectorId,
    input.childConversationId,
    input.catalogVersion,
    input.installedVersion,
    Date.now(),
  );
}

export function deleteAgentChild(
  db: DatabaseSync,
  parentConversationId: string,
  connectorId: string,
): void {
  db.prepare(
    "DELETE FROM connector_agent_sessions WHERE parent_conversation_id = ? AND connector_id = ?",
  ).run(parentConversationId, connectorId);
}

export function listAgentChildrenByParent(
  db: DatabaseSync,
  parentConversationId: string,
): AgentChildRecord[] {
  return db.prepare(
    `${SELECT_AGENT_CHILD} WHERE parent_conversation_id = ? ORDER BY created_at ASC`,
  ).all(parentConversationId) as unknown as AgentChildRecord[];
}

/** 删除隐藏 child 会话的全部数据行（消息/产物/会话），parent 删除时级联。 */
export function deleteChildConversationRows(
  db: DatabaseSync,
  childConversationId: string,
): void {
  db.prepare("DELETE FROM artifacts WHERE conversation_id = ?").run(childConversationId);
  db.prepare("DELETE FROM messages WHERE conversation_id = ?").run(childConversationId);
  db.prepare("DELETE FROM conversations WHERE id = ?").run(childConversationId);
}

/** 删除 parent 的全部隐藏 child 关联与会话数据。 */
export function deleteAgentChildrenForParent(
  db: DatabaseSync,
  parentConversationId: string,
): void {
  for (const child of listAgentChildrenByParent(db, parentConversationId)) {
    deleteAgentChild(db, parentConversationId, child.connectorId);
    deleteChildConversationRows(db, child.childConversationId);
  }
}
