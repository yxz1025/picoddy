import type { Database } from "../../../infra/db.ts";
import { fail } from "../../../shared/errors.ts";
import { object, optionalUuid, string } from "../../../shared/validation.ts";
import {
  createSessionStore,
  type SessionMessageRow,
  type SessionRow,
} from "./store.ts";

export interface SessionDto {
  id: string;
  title: string;
  workspaceId: string | null;
  category: 'assistant' | 'skill_creator' | 'expert_creator';
  expertId: string | null;
  expertRevision: string | null;
  parentId?: string | null;
  expertOperation?: 'create' | 'edit';
  expertTargetId?: string;
  expertTargetRevision?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SessionMessageDto {
  id: string;
  role: unknown;
  content: unknown;
  createdAt: string;
  toolCallId?: unknown;
  toolName?: unknown;
  details?: unknown;
  isError?: boolean;
}

export interface CreateSessionInput {
  title: string;
  category?: 'assistant' | 'skill_creator' | 'expert_creator';
  workspaceId?: string | null;
}

export interface UpdateSessionInput {
  title?: string;
  workspaceId?: string | null;
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function sessionDto(row: SessionRow): SessionDto {
  return {
    id: row.id,
    title: row.title,
    workspaceId: row.workspace_id,
    category: row.category,
    expertId: row.expert_id,
    expertRevision: row.expert_revision,
    ...(row.parent_id ? { parentId: row.parent_id } : {}),
    ...(row.category === 'expert_creator' ? {
      expertOperation: row.expert_draft?.operation ?? 'create',
      ...(row.expert_draft?.expert_id ? {expertTargetId: row.expert_draft.expert_id} : {}),
      ...(row.expert_draft?.base_revision ? {expertTargetRevision: row.expert_draft.base_revision} : {}),
    } : {}),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

function messageDto(row: SessionMessageRow): SessionMessageDto {
  return {
    id: row.id,
    role: row.content.role,
    content: row.content.content,
    ...(row.content.role === 'toolResult' ? {
      toolCallId: row.content.toolCallId,
      toolName: row.content.toolName,
      details: row.content.details,
      isError: row.content.isError === true,
    } : {}),
    createdAt: iso(row.created_at),
  };
}

export function createSessionService(database: Database) {
  const store = createSessionStore(database);

  async function withWorkspace<T>(ownerId: string, workspaceId: string | null | undefined, work: (scoped: typeof store) => Promise<T>): Promise<T> {
    if (!workspaceId) return work(store);
    return database.transaction(async client => {
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [ownerId]);
      const scoped = createSessionStore({ ...database, query: (sql, values) => client.query(sql, values ? [...values] : undefined) });
      if (!await scoped.workspaceExists(ownerId, workspaceId)) fail(400, 'INVALID_WORKSPACE', 'Workspace not found');
      return work(scoped);
    });
  }

  return {
    async list(ownerId: string): Promise<SessionDto[]> {
      return (await store.list(ownerId)).map(sessionDto);
    },

    async create(ownerId: string, input: CreateSessionInput): Promise<SessionDto> {
      const body = object(input);
      const title = string(body.title, "title", 1, 200);
      const workspaceId = optionalUuid(body.workspaceId, "workspaceId");
      const category = body.category ?? 'assistant';
      if (!['assistant','skill_creator','expert_creator'].includes(category as string)) fail(400, 'CATEGORY_UNSUPPORTED', 'Unsupported conversation category');
      if (category === 'skill_creator' || category === 'expert_creator') return database.transaction(async client => {
        await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [ownerId]);
        const scoped = createSessionStore({ ...database, query: (sql, values) => client.query(sql, values ? [...values] : undefined) });
        if (workspaceId && !await scoped.workspaceExists(ownerId, workspaceId)) fail(400, 'INVALID_WORKSPACE', 'Workspace not found');
        const row = await scoped.create(ownerId, title, workspaceId ?? null, category);
        if (category === 'skill_creator') await client.query('INSERT INTO skill_drafts(owner_id,conversation_id) VALUES($1,$2)', [ownerId, row.id]);
        else await client.query("INSERT INTO expert_drafts(owner_id,conversation_id,operation) VALUES($1,$2,'create')", [ownerId,row.id]);
        return sessionDto(row);
      });
      return withWorkspace(ownerId, workspaceId, async scoped => sessionDto(await scoped.create(ownerId, title, workspaceId ?? null)));
    },

    async get(ownerId: string, id: string): Promise<SessionDto> {
      const row = await store.get(ownerId, id);
      if (!row) fail(404, "NOT_FOUND", "Conversation not found");
      return sessionDto(row);
    },

    async update(
      ownerId: string,
      id: string,
      input: UpdateSessionInput,
    ): Promise<SessionDto> {
      const body = object(input);
      const title = body.title === undefined
        ? undefined
        : string(body.title, "title", 1, 200);
      const workspaceId = body.workspaceId === undefined
        ? undefined
        : body.workspaceId === null
          ? null
          : optionalUuid(body.workspaceId, "workspaceId");
      if (title === undefined && workspaceId === undefined) {
        fail(400, "INVALID_REQUEST", "No conversation fields were supplied");
      }
      const row = await withWorkspace(ownerId, workspaceId, scoped => scoped.update(ownerId, id, { title, workspaceId }));
      if (!row) fail(404, "NOT_FOUND", "Conversation not found");
      return sessionDto(row);
    },

    async remove(ownerId: string, id: string): Promise<void> {
      await store.remove(ownerId, id);
    },

    async messages(ownerId: string, id: string): Promise<SessionMessageDto[]> {
      const rows = await store.messages(ownerId, id);
      if (!rows) fail(404, "NOT_FOUND", "Conversation not found");
      return rows.map(messageDto);
    },
  };
}

export type SessionService = ReturnType<typeof createSessionService>;
