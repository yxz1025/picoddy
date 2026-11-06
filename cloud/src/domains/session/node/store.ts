import type { QueryResultRow } from "pg";

import type { Database } from "../../../infra/db.ts";
import { fail } from "../../../shared/errors.ts";

export interface SessionRow extends QueryResultRow {
  id: string;
  title: string;
  workspace_id: string | null;
  category: 'assistant' | 'skill_creator' | 'expert_creator';
  expert_id: string | null;
  expert_revision: string | null;
  parent_id?: string | null;
  expert_draft?: { operation: 'create' | 'edit'; expert_id: string | null; base_revision: string | null } | null;
  created_at: Date | string;
  updated_at: Date | string;
}

export interface SessionMessageRow extends QueryResultRow {
  id: string;
  content: {
    role?: unknown;
    content?: unknown;
    toolCallId?: unknown;
    toolName?: unknown;
    details?: unknown;
    isError?: unknown;
  };
  created_at: Date | string;
}

export interface UpdateSessionRecord {
  title: string | undefined;
  workspaceId: string | null | undefined;
}

const ACTIVE_RUN_STATUSES = [
  "queued",
  "provisioning",
  "running",
  "waiting_approval",
  "cancelling",
  "cleanup_pending",
] as const;

export function createSessionStore(database: Database) {
  return {
    async list(ownerId: string): Promise<SessionRow[]> {
      const result = await database.query<SessionRow>(
        `SELECT id,title,workspace_id,category,expert_id,expert_revision,parent_id,created_at,updated_at,
          (SELECT jsonb_build_object('operation',d.operation,'expert_id',d.expert_id,'base_revision',d.base_revision)
           FROM expert_drafts d WHERE d.conversation_id=conversations.id AND d.owner_id=conversations.owner_id) AS expert_draft FROM conversations
          WHERE owner_id=$1 ORDER BY updated_at DESC,id`,
        [ownerId],
      );
      return result.rows;
    },

    async workspaceExists(ownerId: string, workspaceId: string): Promise<boolean> {
      const result = await database.query(
        "SELECT id FROM resources WHERE id=$1 AND owner_id=$2 AND kind='workspace' AND deleted_at IS NULL",
        [workspaceId, ownerId],
      );
      return Boolean(result.rows[0]);
    },

    async create(
      ownerId: string,
      title: string,
      workspaceId: string | null,
      category: 'assistant' | 'skill_creator' | 'expert_creator' = 'assistant',
    ): Promise<SessionRow> {
      const result = await database.query<SessionRow>(
        `INSERT INTO conversations (owner_id,title,workspace_id,category) VALUES($1,$2,$3,$4)
         RETURNING id,title,workspace_id,category,expert_id,expert_revision,created_at,updated_at`,
        [ownerId, title, workspaceId, category],
      );
      return result.rows[0];
    },

    async get(ownerId: string, id: string): Promise<SessionRow | undefined> {
      const result = await database.query<SessionRow>(
        `SELECT id,title,workspace_id,category,expert_id,expert_revision,parent_id,created_at,updated_at,
          (SELECT jsonb_build_object('operation',d.operation,'expert_id',d.expert_id,'base_revision',d.base_revision)
           FROM expert_drafts d WHERE d.conversation_id=conversations.id AND d.owner_id=conversations.owner_id) AS expert_draft FROM conversations
          WHERE id=$1 AND owner_id=$2`,
        [id, ownerId],
      );
      return result.rows[0];
    },

    async update(
      ownerId: string,
      id: string,
      update: UpdateSessionRecord,
    ): Promise<SessionRow | undefined> {
      const result = await database.query<SessionRow>(
        `UPDATE conversations SET
           title=coalesce($3,title),
           workspace_id=CASE WHEN $4 THEN $5::uuid ELSE workspace_id END,
           updated_at=now()
         WHERE id=$1 AND owner_id=$2
         RETURNING id,title,workspace_id,category,expert_id,expert_revision,parent_id,created_at,updated_at,
          (SELECT jsonb_build_object('operation',d.operation,'expert_id',d.expert_id,'base_revision',d.base_revision)
           FROM expert_drafts d WHERE d.conversation_id=conversations.id AND d.owner_id=conversations.owner_id) AS expert_draft`,
        [
          id,
          ownerId,
          update.title ?? null,
          update.workspaceId !== undefined,
          update.workspaceId ?? null,
        ],
      );
      return result.rows[0];
    },

    async remove(ownerId: string, id: string): Promise<void> {
      await database.transaction(async (client) => {
        await client.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [ownerId]);
        const conversation = await client.query(
          "SELECT id FROM conversations WHERE id=$1 AND owner_id=$2 FOR UPDATE",
          [id, ownerId],
        );
        if (!conversation.rows[0]) {
          fail(404, "NOT_FOUND", "Conversation not found");
        }
        const active = await client.query(
          `SELECT r.id FROM runs r WHERE r.owner_id=$2 AND r.status=ANY($3::text[]) AND
            (r.conversation_id=$1 OR r.parent_run_id IN (SELECT id FROM runs WHERE conversation_id=$1 AND owner_id=$2)) LIMIT 1`,
          [id, ownerId, [...ACTIVE_RUN_STATUSES]],
        );
        if (active.rows[0]) {
          fail(
            409,
            "RUN_ALREADY_ACTIVE",
            "Cancel the active run before deleting this conversation",
          );
        }
        await client.query(
          "UPDATE resources SET deleted_at=now(),updated_at=now() WHERE owner_id=$2 AND kind='memory' AND deleted_at IS NULL AND data->>'scope'='working' AND data->>'conversationId'=$1",
          [id, ownerId],
        );
        await client.query(
          "DELETE FROM conversations WHERE id=$1 AND owner_id=$2",
          [id, ownerId],
        );
      });
    },

    async messages(
      ownerId: string,
      id: string,
    ): Promise<SessionMessageRow[] | undefined> {
      const conversation = await database.query(
        "SELECT id FROM conversations WHERE id=$1 AND owner_id=$2",
        [id, ownerId],
      );
      if (!conversation.rows[0]) return undefined;

      const result = await database.query<SessionMessageRow>(
        `SELECT id,content,created_at FROM (
           SELECT id::text,content,created_at FROM messages
            WHERE conversation_id=$1 AND owner_id=$2
           UNION ALL
           SELECT 'delivery:' || e.id::text,
             jsonb_build_object('role','toolResult','toolName','present_files',
               'toolCallId',e.payload->>'toolCallId','isError',false,
               'content',jsonb_build_array(jsonb_build_object('type','text','text',
                 coalesce(e.payload->'details'->>'explanation','已交付文件'))),
               'details',e.payload->'details'), e.created_at
            FROM events e JOIN runs r ON r.id=e.run_id AND r.owner_id=e.owner_id
            WHERE r.conversation_id=$1 AND e.owner_id=$2 AND e.type='delivery_batch'
              AND NOT EXISTS (
                SELECT 1 FROM messages m WHERE m.conversation_id=$1 AND m.owner_id=$2
                  AND m.run_id=e.run_id AND m.content->>'role'='toolResult'
                  AND m.content->>'toolName'='present_files'
                  AND m.content->>'toolCallId'=e.payload->>'toolCallId'
              )
         ) history ORDER BY created_at,id`,
        [id, ownerId],
      );
      return result.rows;
    },
  };
}

export type SessionStore = ReturnType<typeof createSessionStore>;
