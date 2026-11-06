import { randomUUID } from 'node:crypto';
import {expertPackageSkills,expertPackageFiles,freezeExpertForRun,assertRunSnapshotBudget} from '../../agent/expert-package.ts';
import { snapshotWorkspace } from '../../domains/workspace/node/files.ts';
import { expertRevision } from '../../domains/expert/node/binding.ts';
import { buildCloudPromptEnvelope } from '../../agent/prompt-runtime/envelope-builder.ts';
import { PromptRuntimeError } from '../../agent/prompt-runtime/diagnostics.ts';
import { readPromptSettings } from '../../domains/settings/node/preferences.ts';
import type { PoolClient, QueryResultRow } from 'pg';
import { database as defaultDatabase, type Database } from '../../infra/db.ts';
import { fail } from '../../shared/errors.ts';
import { UUID, string, optionalUuid, uuidArray } from '../../shared/validation.ts';
import type {
  CloudRunCategory,
  CloudRunMode,
  CloudRunPermission,
  CloudRuntimeProfile,
  ReferenceExpertProfileSnapshot,
  RunSelection,
} from './types.ts';
export const ACTIVE_RUN_STATUSES = [
  "queued",
  "provisioning",
  "running",
  "waiting_approval",
  "cancelling",
  "cleanup_pending",
] as const;

export interface ApiRun {
  id: string;
  conversationId: string;
  status: string;
  prompt: string;
  selection: unknown;
  cancelRequested: boolean;
  error: string | null;
  usage: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  finishedAt?: string;
}

interface RunRow extends QueryResultRow {
  id: string;
  owner_id: string;
  conversation_id: string;
  status: string;
  prompt: string;
  selection: RunSelection;
  cancel_requested: boolean;
  error: string | null;
  usage: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
  started_at?: Date | string | null;
  finished_at?: Date | string | null;
}

export interface PublicRunRow extends QueryResultRow {
  id: string;
  conversation_id: string;
  status: string;
  prompt: string;
  selection: Record<string, unknown>;
  cancel_requested: boolean;
  error: string | null;
  usage: Record<string, unknown> | null;
  created_at: Date | string;
  updated_at: Date | string;
  started_at?: Date | string | null;
  finished_at?: Date | string | null;
}

interface ResourceRow extends QueryResultRow {
  id: string;
  name: string;
  data: Record<string, unknown>;
  secret: string | null;
}

interface ReferenceExpertRow extends QueryResultRow {
  id: string;
  name: string;
  data: Record<string, unknown>;
}

interface FileSnapshot extends QueryResultRow {
  id: string;
  owner_id: string;
  name: string;
  mime_type: string;
  object_key: string;
  size: number | string;
  sha256: string;
  created_at: Date | string;
}

interface ParsedRunBody {
  prompt: string;
  skillIds: string[];
  connectorIds: string[];
  fileIds: string[];
  expertId?: string;
  referenceExpertId?: string;
  modelId?: string;
  idempotencyKey: string;
  runtimeProfile: CloudRuntimeProfile;
  permission: CloudRunPermission;
}

interface Queryable {
  query<T extends QueryResultRow = QueryResultRow>(
    sql: string,
    values?: unknown[],
  ): Promise<{ rows: T[]; rowCount: number | null }>;
}

export function parseRunRuntimeSelection(value: Record<string, unknown>): {
  runtimeProfile: CloudRuntimeProfile;
  permission: CloudRunPermission;
} {
  const rawMode = value.mode ?? 'craft';
  if (rawMode !== 'ask' && rawMode !== 'plan' && rawMode !== 'craft') {
    fail(400, 'MODE_UNSUPPORTED', 'mode must be ask, plan, or craft');
  }
  const mode: CloudRunMode = rawMode;

  const rawCategory = value.category ?? 'assistant';
  if (!['assistant','skill_creator','expert_creator'].includes(rawCategory as string)) {
    fail(400, 'CATEGORY_UNSUPPORTED', 'Unsupported run category');
  }
  const category = rawCategory as CloudRunCategory;

  const rawPermission = value.permission ?? 'default';
  if (rawPermission !== 'default' && rawPermission !== 'full' && rawPermission !== 'readonly') {
    fail(400, 'PERMISSION_UNSUPPORTED', 'permission must be default, full, or readonly');
  }
  const permission: CloudRunPermission = rawPermission === 'readonly' ? 'readonly' : 'full';
  return { runtimeProfile: { mode, category }, permission };
}

function parseRunBody(value: Record<string, unknown>): ParsedRunBody {
  return {
    prompt: string(value.prompt, "prompt", 1, 100_000),
    skillIds: uuidArray(value.skillIds, "skillIds"),
    connectorIds: uuidArray(value.connectorIds, "connectorIds"),
    fileIds: uuidArray(value.fileIds, "fileIds"),
    expertId: optionalUuid(value.expertId, "expertId"),
    referenceExpertId: optionalUuid(value.referenceExpertId, "referenceExpertId"),
    modelId: optionalUuid(value.modelId, "modelId"),
    idempotencyKey: string(value.idempotencyKey, "idempotencyKey", 1, 200),
    ...parseRunRuntimeSelection(value),
  };
}

function iso(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function publicSelection(selection: RunSelection): Record<string, unknown> {
  return {
    skills: selection.skills.map(({ id, name, version }) => ({ id, name, version })),
    connectors: selection.connectors.map(({ id, name }) => ({ id, name })),
    model: selection.model ? { id: selection.model.id, name: selection.model.name } : null,
    expert: selection.expert ? { id: selection.expert.id, name: selection.expert.name } : undefined,
    referenceExpertId: selection.referenceExpertId,
    files: selection.files.map(({ id, name, mime_type, size }) => ({
      id,
      name,
      mimeType: mime_type,
      size: Number(size),
    })),
    memories: (selection.memories ?? []).map(({ id, name }) => ({ id, name })),
    runtimeProfile: selection.runtimeProfile ?? { mode: 'craft', category: 'assistant' },
    permission: selection.permission ?? 'full',
  };
}

export function mapRun(row: RunRow): ApiRun {
  const result: ApiRun = {
    id: row.id,
    conversationId: row.conversation_id,
    status: row.status,
    prompt: row.prompt,
    selection: publicSelection(row.selection),
    cancelRequested: row.cancel_requested,
    error: row.error,
    usage: row.usage ?? {},
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
  if (row.started_at) result.startedAt = iso(row.started_at);
  if (row.finished_at) result.finishedAt = iso(row.finished_at);
  return result;
}

export function mapPublicRun(row: PublicRunRow): ApiRun {
  const result: ApiRun = {
    id: row.id,
    conversationId: row.conversation_id,
    status: row.status,
    prompt: row.prompt,
    selection: row.selection,
    cancelRequested: row.cancel_requested,
    error: row.error,
    usage: row.usage ?? {},
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
  if (row.started_at) result.startedAt = iso(row.started_at);
  if (row.finished_at) result.finishedAt = iso(row.finished_at);
  return result;
}

function publicSelectionSql(alias: string): string {
  const selection = `${alias}.selection`;
  return `jsonb_build_object(
    'skills', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', item->'id', 'name', item->'name', 'version', item->'version'
      ) ORDER BY ordinality)
      FROM jsonb_array_elements(coalesce(${selection}->'skills','[]'::jsonb))
           WITH ORDINALITY AS skill(item, ordinality)
    ), '[]'::jsonb),
    'connectors', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', item->'id', 'name', item->'name') ORDER BY ordinality)
      FROM jsonb_array_elements(coalesce(${selection}->'connectors','[]'::jsonb))
           WITH ORDINALITY AS connector(item, ordinality)
    ), '[]'::jsonb),
    'model', CASE
      WHEN ${selection}->'model' IS NULL OR ${selection}->'model'='null'::jsonb THEN 'null'::jsonb
      ELSE jsonb_build_object('id', ${selection}->'model'->'id', 'name', ${selection}->'model'->'name')
    END,
    'expert', CASE
      WHEN ${selection}->'expert' IS NULL OR ${selection}->'expert'='null'::jsonb THEN 'null'::jsonb
      ELSE jsonb_build_object('id', ${selection}->'expert'->'id', 'name', ${selection}->'expert'->'name')
    END,
    'referenceExpertId', ${selection}->'referenceExpertId',
    'files', coalesce((
      SELECT jsonb_agg(jsonb_build_object(
        'id', item->'id', 'name', item->'name', 'mimeType', item->'mime_type',
        'size', to_jsonb(coalesce((item->>'size')::bigint, 0))
      ) ORDER BY ordinality)
      FROM jsonb_array_elements(coalesce(${selection}->'files','[]'::jsonb))
           WITH ORDINALITY AS selected_file(item, ordinality)
    ), '[]'::jsonb),
    'memories', coalesce((
      SELECT jsonb_agg(jsonb_build_object('id', item->'id', 'name', item->'name') ORDER BY ordinality)
      FROM jsonb_array_elements(coalesce(${selection}->'memories','[]'::jsonb))
           WITH ORDINALITY AS memory(item, ordinality)
    ), '[]'::jsonb),
    'runtimeProfile', coalesce(
      ${selection}->'runtimeProfile',
      '{"mode":"craft","category":"assistant"}'::jsonb
    ),
    'permission', coalesce(${selection}->'permission', '"full"'::jsonb)
  )`;
}

export function publicRunColumns(alias: string): string {
  return `${alias}.id,${alias}.conversation_id,${alias}.status,${alias}.prompt,
    ${publicSelectionSql(alias)} AS selection,
    ${alias}.cancel_requested,${alias}.error,${alias}.usage,
    ${alias}.created_at,${alias}.updated_at,${alias}.started_at,${alias}.finished_at`;
}

async function resourcesByIds(
  client: Queryable,
  ownerId: string,
  kind: string,
  ids: string[],
): Promise<ResourceRow[]> {
  if (ids.length === 0) return [];
  const result = await client.query<ResourceRow>(
    `SELECT id, name, data, secret
       FROM resources
      WHERE owner_id=$1 AND kind=$2 AND id=ANY($3::uuid[]) AND deleted_at IS NULL`,
    [ownerId, kind, ids],
  );
  if (result.rows.length !== ids.length) {
    fail(400, "INVALID_SELECTION", `One or more selected ${kind} resources are unavailable`);
  }
  const rows = new Map(result.rows.map((row) => [row.id, row]));
  return ids.map((id) => rows.get(id)!);
}

function referenceText(
  value: unknown,
  field: string,
  maximumCharacters: number,
  fallback = '',
): string {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== 'string') {
    fail(400, 'INVALID_REFERENCE_EXPERT', `Reference expert ${field} is invalid`);
  }
  if (value.length > maximumCharacters) {
    fail(400, 'REFERENCE_EXPERT_TOO_LARGE', `Reference expert ${field} is too large`);
  }
  return value;
}

function referenceTextList(
  value: unknown,
  field: string,
  maximumItems: number,
  maximumCharacters: number,
): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value) || value.length > maximumItems) {
    fail(400, 'INVALID_REFERENCE_EXPERT', `Reference expert ${field} is invalid`);
  }
  return value.map((item, index) =>
    referenceText(item, `${field}[${index}]`, maximumCharacters));
}

function referenceExpertProfile(expert: ReferenceExpertRow): ReferenceExpertProfileSnapshot {
  return {
    name: referenceText(expert.name, 'name', 500),
    prompt: referenceText(expert.data.prompt, 'prompt', 8_000),
    skillIds: uuidArray(expert.data.skillIds ?? [], 'referenceExpert.skillIds'),
    description: referenceText(expert.data.description, 'description', 2_000),
    tags: referenceTextList(expert.data.tags, 'tags', 3, 120),
    quickPrompts: referenceTextList(expert.data.quickPrompts, 'quickPrompts', 3, 500),
    icon: referenceText(expert.data.icon, 'icon', 120, '🤖'),
    categoryId: referenceText(expert.data.categoryId, 'categoryId', 120, 'cloud'),
  };
}

async function snapshotSelection(
  client: Queryable,
  ownerId: string,
  conversation: { id: string; workspace_id: string | null; expert_id: string | null },
  body: ParsedRunBody,
): Promise<RunSelection> {
  let referenceExpert: RunSelection['referenceExpert'];
  if (body.referenceExpertId) {
    const reference = await client.query<ReferenceExpertRow>(
      `SELECT id,name,data FROM resources
        WHERE id=$1 AND owner_id=$2 AND kind='expert' AND deleted_at IS NULL
        FOR SHARE`,
      [body.referenceExpertId, ownerId],
    );
    if (!reference.rows[0]) {
      fail(400, 'INVALID_REFERENCE_EXPERT', 'Reference expert is unavailable');
    }
    const selected = reference.rows[0];
    referenceExpert = {
      id: selected.id,
      revision: expertRevision(selected),
      profile: referenceExpertProfile(selected),
    };
  }
  let expert: ResourceRow | undefined;
  let skillIds = body.skillIds;
  const expertId = body.expertId ?? conversation.expert_id;
  if (expertId) {
    [expert] = await resourcesByIds(client, ownerId, "expert", [expertId]);
    const expertSkills = uuidArray(expert.data.skillIds, "expert.skillIds");
    skillIds = [...new Set([...skillIds, ...expertSkills])];
    if (conversation.expert_id === expertId) await client.query('UPDATE conversations SET expert_revision=$3 WHERE id=$1 AND owner_id=$2', [conversation.id, ownerId, expertRevision(expert)]);
  }

  let skills: RunSelection["skills"] = [];
  if (skillIds.length > 0) {
    const size = await client.query<{ bytes: string; count: string }>(
      `SELECT count(*)::text AS count,
              coalesce(sum(octet_length(sv.files::text)),0)::text AS bytes
         FROM resources r
         JOIN skill_versions sv
           ON sv.skill_id=r.id AND sv.version=r.data->>'currentVersion'
        WHERE r.owner_id=$1 AND r.kind='skill' AND r.id=ANY($2::uuid[])
          AND r.deleted_at IS NULL AND coalesce((r.data->>'enabled')::boolean, true)`,
      [ownerId, skillIds],
    );
    if (Number(size.rows[0]?.count ?? 0) !== skillIds.length) {
      fail(400, "INVALID_SELECTION", "One or more selected skills are unavailable");
    }
    if (Number(size.rows[0]?.bytes ?? 0) > 64 * 1024 * 1024) {
      fail(413, "SKILL_SELECTION_TOO_LARGE", "Selected skill files exceed the 64 MiB run limit");
    }
    const result = await client.query<{
      id: string;
      name: string;
      data: Record<string, unknown>;
      version: string;
      files: RunSelection["skills"][number]["files"];
    }>(
      `SELECT r.id, r.name, r.data, sv.version, sv.files
         FROM resources r
         JOIN skill_versions sv
           ON sv.skill_id=r.id AND sv.version=r.data->>'currentVersion'
        WHERE r.owner_id=$1 AND r.kind='skill' AND r.id=ANY($2::uuid[])
          AND r.deleted_at IS NULL AND coalesce((r.data->>'enabled')::boolean, true)`,
      [ownerId, skillIds],
    );
    if (result.rows.length !== skillIds.length) {
      fail(400, "INVALID_SELECTION", "One or more selected skills are unavailable");
    }
    const rows = new Map(result.rows.map((row) => [row.id, row]));
    skills = skillIds.map((id) => {
      const row = rows.get(id)!;
      return { id: row.id, name: row.name, version: row.version, files: row.files };
    });
  }

  if(expert) {
    expertPackageFiles(expert);
    const bundled=expertPackageSkills(expert);
    if(Buffer.byteLength(JSON.stringify([...skills,...bundled]))>64*1024*1024) {
      fail(413,'SKILL_SELECTION_TOO_LARGE','Selected skill files exceed the 64 MiB run limit');
    }
    skills.push(...bundled);
  }

  const connectorRows = await resourcesByIds(
    client,
    ownerId,
    "connector",
    body.connectorIds,
  );
  const connectors = connectorRows.map(({ id, name, data, secret }) => ({
    id,
    name,
    data,
    secret,
  }));

  let model: ResourceRow | undefined;
  if (body.modelId) {
    [model] = await resourcesByIds(client, ownerId, "model", [body.modelId]);
  } else {
    const result = await client.query<ResourceRow>(
      `SELECT id, name, data, secret
         FROM resources
        WHERE owner_id=$1 AND kind='model' AND deleted_at IS NULL
        ORDER BY ((data->>'isDefault')='true') DESC NULLS LAST, created_at ASC
        LIMIT 1`,
      [ownerId],
    );
    model = result.rows[0];
  }
  if (!model) fail(400, "MODEL_REQUIRED", "Configure or select a model before starting a run");
  if (!model.secret) fail(400, "MODEL_KEY_REQUIRED", "The selected model has no configured API key");

  let files: RunSelection['files'] = [];
  if (body.fileIds.length > 0) {
    const result = await client.query<FileSnapshot>(
      `SELECT id, owner_id, name, mime_type, object_key, size, sha256, created_at
         FROM files WHERE owner_id=$1 AND id=ANY($2::uuid[]) FOR SHARE`,
      [ownerId, body.fileIds],
    );
    if (result.rows.length !== body.fileIds.length) {
      fail(400, "INVALID_SELECTION", "One or more selected files are unavailable");
    }
    const rows = new Map(result.rows.map((row) => [row.id, row]));
    files = body.fileIds.map((id) => ({ ...rows.get(id)!, size: Number(rows.get(id)!.size) }));
  }

  let memories: RunSelection["memories"] = [];
  const memoryStats = await client.query<{ count: string; bytes: string }>(
    `SELECT count(*)::text AS count,
            coalesce(sum(octet_length(data::text)),0)::text AS bytes
       FROM resources
      WHERE owner_id=$1 AND kind='memory' AND deleted_at IS NULL
        AND (coalesce(data->>'scope','user')='user' OR (data->>'scope'='working' AND data->>'conversationId'=$3::text))
        AND (
          NOT (data ? 'workspaceId') OR data->>'workspaceId' IS NULL
          OR ($2::uuid IS NOT NULL AND data->>'workspaceId'=$2::text)
        )`,
    [ownerId, conversation.workspace_id, conversation.id],
  );
  if (
    Number(memoryStats.rows[0]?.count ?? 0) > 100 ||
    Number(memoryStats.rows[0]?.bytes ?? 0) > 100_000
  ) {
    fail(413, "MEMORY_SELECTION_TOO_LARGE", "Applicable memories exceed the run context limit");
  }
  const memoryResult = await client.query<ResourceRow>(
    `SELECT id, name, data, secret
       FROM resources
      WHERE owner_id=$1 AND kind='memory' AND deleted_at IS NULL
        AND (coalesce(data->>'scope','user')='user' OR (data->>'scope'='working' AND data->>'conversationId'=$3::text))
        AND (
          NOT (data ? 'workspaceId') OR data->>'workspaceId' IS NULL
          OR ($2::uuid IS NOT NULL AND data->>'workspaceId'=$2::text)
        )
      ORDER BY updated_at DESC, id`,
    [ownerId, conversation.workspace_id, conversation.id],
  );
  memories = memoryResult.rows.map(({ id, name, data }) => ({ id, name, data }));
  const settings = await readPromptSettings(client, ownerId);

  const selection: RunSelection = {
    workspace: await snapshotWorkspace(client, ownerId, conversation),
    skills,
    connectors,
    model: { id: model.id, name: model.name, data: model.data, secret: model.secret },
    expert: freezeExpertForRun(expert),
    ...(referenceExpert ? {
      referenceExpertId: referenceExpert.id,
      referenceExpert,
    } : {}),
    files,
    memories,
    runtimeProfile: body.runtimeProfile,
    permission: body.permission,
    settings,
  };
  assertRunSnapshotBudget(selection);
  return selection;
}

async function enqueueWithClient(
  ownerId: string,
  conversationId: string,
  rawBody: Record<string, unknown>,
  client: Queryable,
): Promise<{ run: ApiRun; created: boolean }> {
  if (!UUID.test(ownerId) || !UUID.test(conversationId)) {
    fail(400, "INVALID_REQUEST", "ownerId and conversationId must be UUIDs");
  }
  const body = parseRunBody(rawBody);
  const ownerResult = await client.query<{ id: string }>(
    "SELECT id FROM users WHERE id=$1 AND disabled_at IS NULL FOR UPDATE",
    [ownerId],
  );
  if (!ownerResult.rows[0]) fail(404, "NOT_FOUND", "User not found");
  const conversationResult = await client.query<{ id: string; workspace_id: string | null; expert_id: string | null; category: CloudRunCategory }>(
    `SELECT id, workspace_id, category, expert_id FROM conversations
      WHERE id=$1 AND owner_id=$2 FOR UPDATE`,
    [conversationId, ownerId],
  );
  const conversation = conversationResult.rows[0];
  if (!conversation) fail(404, "NOT_FOUND", "Conversation not found");
  if (rawBody.category !== undefined && rawBody.category !== conversation.category) fail(400, 'CATEGORY_MISMATCH', 'Run category must match the conversation');
  body.runtimeProfile.category = conversation.category;
  if (conversation.category !== 'assistant' && body.runtimeProfile.mode !== 'craft') fail(400, 'CATEGORY_MODE_NOT_ALLOWED', 'Creator conversations require Craft mode');
  if (conversation.category !== 'assistant' && (body.expertId || conversation.expert_id)) fail(400, 'EXPERT_CATEGORY_MISMATCH', 'Active experts are only available in assistant conversations');
  if (body.referenceExpertId && conversation.category !== 'expert_creator') {
    fail(400, 'REFERENCE_EXPERT_CATEGORY_MISMATCH', 'Reference experts are only available in expert_creator conversations');
  }

  const duplicate = await client.query<RunRow>(
    `SELECT * FROM runs
      WHERE owner_id=$1 AND conversation_id=$2 AND idempotency_key=$3`,
    [ownerId, conversationId, body.idempotencyKey],
  );
  if (duplicate.rows[0]) return { run: mapRun(duplicate.rows[0]), created: false };

  const ownerActive = await client.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM runs
      WHERE owner_id=$1 AND status=ANY($2::text[])`,
    [ownerId, [...ACTIVE_RUN_STATUSES]],
  );
  if (Number(ownerActive.rows[0]?.count ?? 0) >= 10) {
    fail(429, "RUN_CONCURRENCY_LIMIT", "The account already has 10 active runs");
  }

  const active = await client.query<{ id: string }>(
    `SELECT id FROM runs
      WHERE owner_id=$1 AND conversation_id=$2 AND status=ANY($3::text[])
      LIMIT 1`,
    [ownerId, conversationId, [...ACTIVE_RUN_STATUSES]],
  );
  if (active.rows[0]) {
    fail(409, "RUN_ALREADY_ACTIVE", "This conversation already has an active run");
  }

  const selection = await snapshotSelection(client, ownerId, conversation, body);
  const runId = randomUUID();
  // Validate the actual encoded prompt before queuing or writing the user message.
  // Do not leave valid-looking API input to fail as an opaque Worker error.
  try {
    buildCloudPromptEnvelope({ id: runId, conversation_id: conversationId, prompt: body.prompt,
      selection: { ...selection, files: selection.files.map(file => ({ ...file, size: Number(file.size) })) },
    });
  } catch (error) {
    if (error instanceof PromptRuntimeError) fail(400, error.code, error.message);
    throw error;
  }
  const inserted = await client.query<RunRow>(
    `INSERT INTO runs (
       id, owner_id, conversation_id, status, prompt, selection, idempotency_key
     ) VALUES ($1,$2,$3,'queued',$4,$5::jsonb,$6)
     RETURNING *`,
    [runId, ownerId, conversationId, body.prompt, JSON.stringify(selection), body.idempotencyKey],
  );
  const userMessage = {
    role: "user",
    content: [{ type: "text", text: body.prompt }],
    timestamp: Date.now(),
  };
  await client.query(
    `INSERT INTO messages (id, owner_id, conversation_id, run_id, content)
     VALUES ($1,$2,$3,$4,$5::jsonb)`,
    [randomUUID(), ownerId, conversationId, runId, JSON.stringify(userMessage)],
  );
  await client.query(
    `INSERT INTO events (owner_id, run_id, type, payload)
     VALUES ($1,$2,'status',$3::jsonb)`,
    [ownerId, runId, JSON.stringify({ status: "queued" })],
  );
  await client.query(
    "UPDATE conversations SET updated_at=now() WHERE id=$1 AND owner_id=$2",
    [conversationId, ownerId],
  );
  return { run: mapRun(inserted.rows[0]), created: true };
}

export async function enqueueUsingDatabase(
  database: Database,
  ownerId: string,
  conversationId: string,
  body: Record<string, unknown>,
  client?: PoolClient,
): Promise<{ run: ApiRun; created: boolean }> {
  if (client) return enqueueWithClient(ownerId, conversationId, body, client as Queryable);
  return database.transaction((transactionClient) =>
    enqueueWithClient(ownerId, conversationId, body, transactionClient as Queryable));
}

export function enqueueRun(
  ownerId: string,
  conversationId: string,
  body: Record<string, unknown>,
  client?: PoolClient,
): Promise<{ run: ApiRun; created: boolean }> {
  return enqueueUsingDatabase(defaultDatabase, ownerId, conversationId, body, client);
}
