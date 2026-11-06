import { createHash } from 'node:crypto';
import type { PoolClient } from 'pg';

import { assertExpertContextBudget } from '../../../agent/prompt-runtime/expert-budget.ts';
import type { Database } from '../../../infra/db.ts';
import { fail, HttpError } from '../../../shared/errors.ts';
import { object, string, uuidArray } from '../../../shared/validation.ts';

export interface ExpertDraftProfile {
  name: string;
  prompt: string;
  skillIds: string[];
  description: string;
  tags: string[];
  quickPrompts: string[];
  icon: string;
  categoryId: string;
}

export interface ExpertDraftFence {
  id: string;
  owner_id: string;
  conversation_id: string;
  lease_token: string;
}

export interface ExpertDraftValidationItem {
  code: string;
  message: string;
  field?: string;
}

export interface ExpertDraftValidation {
  revision: number;
  valid: boolean;
  errors: ExpertDraftValidationItem[];
  warnings: ExpertDraftValidationItem[];
  checkedAt: number;
}

interface ExpertDraftRow {
  id: string;
  owner_id: string;
  conversation_id: string;
  operation: 'create' | 'edit';
  expert_id: string | null;
  base_revision: string | null;
  revision: number;
  status: 'editing' | 'valid' | 'published';
  profile: ExpertDraftProfile;
  preserved_data: Record<string, unknown>;
  validation: ExpertDraftValidation | null;
  validated_revision: number | null;
  published_revision: string | null;
  published_at: Date | string | null;
  created_at: Date | string;
  updated_at: Date | string;
}

const ACTIVE_RUN_STATUSES = [
  'queued',
  'provisioning',
  'running',
  'waiting_approval',
  'cancelling',
  'cleanup_pending',
];

const EDITABLE_DATA_FIELDS = new Set([
  'prompt',
  'skillIds',
  'description',
  'tags',
  'quickPrompts',
  'icon',
  'categoryId',
]);

function epoch(value: Date | string): number {
  return value instanceof Date ? value.getTime() : new Date(value).getTime();
}

function dto(row: ExpertDraftRow) {
  return {
    id: row.id,
    conversationId: row.conversation_id,
    operation: row.operation,
    status: row.status,
    revision: row.revision,
    profile: row.profile,
    expertId: row.expert_id ?? undefined,
    baseRevision: row.base_revision ?? undefined,
    publishedRevision: row.published_revision ?? undefined,
    validation: row.validation ?? undefined,
    publishedAt: row.published_at ? epoch(row.published_at) : undefined,
    createdAt: epoch(row.created_at),
    updatedAt: epoch(row.updated_at),
  };
}

function expectedRevision(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    fail(400, 'EXPECTED_REVISION_REQUIRED', 'expectedRevision is required');
  }
  return value;
}

function expectDraftRevision(row: ExpertDraftRow, value: number): void {
  if (row.revision !== expectedRevision(value)) {
    fail(409, 'DRAFT_CHANGED', 'Draft changed; refresh before continuing');
  }
}

export function normalizeExpertDraftProfile(value: unknown): ExpertDraftProfile {
  const profile = object(value, 'profile');
  const supported = new Set(['name', ...EDITABLE_DATA_FIELDS]);
  const unknown = Object.keys(profile).find(key => !supported.has(key));
  if (unknown) fail(400, 'EXPERT_PROFILE_FIELD_UNSUPPORTED', `Unsupported expert profile field: ${unknown}`);
  const normalized = {
    name: string(profile.name, 'profile.name', 1, 200),
    prompt: string(profile.prompt, 'profile.prompt', 1, 100_000),
    skillIds: uuidArray(profile.skillIds, 'profile.skillIds'),
    description: profile.description === undefined
      ? ''
      : string(profile.description, 'profile.description', 0, 2_000),
    tags: stringList(profile.tags, 'profile.tags', 20, 64),
    quickPrompts: stringList(profile.quickPrompts, 'profile.quickPrompts', 20, 500),
    icon: profile.icon === undefined ? '🤖' : string(profile.icon, 'profile.icon', 0, 2_048),
    categoryId: profile.categoryId === undefined
      ? 'cloud'
      : string(profile.categoryId, 'profile.categoryId', 1, 100),
  };
  assertExpertContextBudget({
    trust: 'user-supplied-untrusted',
    id: '00000000-0000-4000-8000-000000000000',
    name: normalized.name,
    instructions: normalized.prompt,
  });
  return normalized;
}

function stringList(value: unknown, label: string, maximumItems: number, maximumLength: number): string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.length > maximumItems) {
    fail(400, 'INVALID_REQUEST', `${label} must be an array of at most ${maximumItems} strings`);
  }
  const result = value.map((item, index) => string(item, `${label}[${index}]`, 1, maximumLength));
  if (new Set(result).size !== result.length) {
    fail(400, 'INVALID_REQUEST', `${label} must not contain duplicates`);
  }
  return result;
}

function preservedExpertData(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(data).filter(([key]) => !EDITABLE_DATA_FIELDS.has(key)));
}

function expertResourceData(
  profile: ExpertDraftProfile,
  preserved: Record<string, unknown>,
): Record<string, unknown> {
  return {
    ...preserved,
    prompt: profile.prompt,
    skillIds: profile.skillIds,
    description: profile.description,
    tags: profile.tags,
    quickPrompts: profile.quickPrompts,
    icon: profile.icon,
    categoryId: profile.categoryId,
  };
}

function canonical(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value as Record<string, unknown>)
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([key, item]) => [key, canonical(item)]),
    );
  }
  return value;
}

function draftExpertRevision(name: string, data: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify(canonical({ name, data }))).digest('hex');
}

function profileFromResource(name: string, data: Record<string, unknown>): ExpertDraftProfile {
  return normalizeExpertDraftProfile({
    name,
    prompt: data.prompt,
    skillIds: data.skillIds ?? [],
    description: data.description ?? String(data.prompt ?? '').slice(0, 160),
    tags: data.tags ?? [],
    quickPrompts: data.quickPrompts ?? [],
    icon: data.icon ?? '🤖',
    categoryId: data.categoryId ?? 'cloud',
  });
}

function revisionFromResource(name: string, data: Record<string, unknown>): string {
  const profile = profileFromResource(name, data);
  return draftExpertRevision(name, expertResourceData(profile, preservedExpertData(data)));
}

async function assertOwnedSkills(
  client: PoolClient,
  ownerId: string,
  skillIds: readonly string[],
): Promise<void> {
  if (skillIds.length === 0) return;
  const skills = await client.query<{ id: string }>(
    `SELECT id FROM resources
      WHERE owner_id=$1 AND kind='skill' AND deleted_at IS NULL
        AND id=ANY($2::uuid[])
      FOR SHARE`,
    [ownerId, skillIds],
  );
  if (skills.rows.length !== skillIds.length) {
    fail(400, 'INVALID_REFERENCE', 'profile.skillIds contains an unavailable resource');
  }
}

export function createExpertDraftService(database: Database, ownerId: string) {
  async function owned(id: string): Promise<ExpertDraftRow> {
    const result = await database.query<ExpertDraftRow>(
      'SELECT * FROM expert_drafts WHERE id=$1 AND owner_id=$2',
      [id, ownerId],
    );
    if (!result.rows[0]) fail(404, 'NOT_FOUND', 'Draft not found');
    return result.rows[0];
  }

  async function lockConversation(
    client: PoolClient,
    conversationId: string,
    fence?: ExpertDraftFence,
  ): Promise<void> {
    const user = await client.query(
      'SELECT id FROM users WHERE id=$1 AND disabled_at IS NULL FOR UPDATE',
      [ownerId],
    );
    if (!user.rows[0]) fail(404, 'NOT_FOUND', 'User not found');
    const conversation = await client.query<{ category: string }>(
      'SELECT category FROM conversations WHERE id=$1 AND owner_id=$2 FOR UPDATE',
      [conversationId, ownerId],
    );
    if (!conversation.rows[0]) fail(404, 'NOT_FOUND', 'Conversation not found');
    if (conversation.rows[0].category !== 'expert_creator') {
      fail(400, 'INVALID_CATEGORY', 'Expert drafts require an expert_creator conversation');
    }
    if (fence) {
      if (fence.owner_id !== ownerId || fence.conversation_id !== conversationId) {
        throw new Error('DRAFT_SCOPE_MISMATCH');
      }
      const run = await client.query(
        `SELECT id FROM runs
          WHERE id=$1 AND owner_id=$2 AND conversation_id=$3 AND lease_token=$4
            AND lease_until>now() AND NOT cancel_requested AND status='running'
          FOR UPDATE`,
        [fence.id, ownerId, conversationId, fence.lease_token],
      );
      if (!run.rows[0]) throw new Error('RUN_LEASE_LOST');
      return;
    }
    const busy = await client.query(
      `SELECT id FROM runs
        WHERE owner_id=$1 AND conversation_id=$2 AND status=ANY($3::text[])
        LIMIT 1`,
      [ownerId, conversationId, ACTIVE_RUN_STATUSES],
    );
    if (busy.rows[0]) {
      fail(409, 'RUN_ALREADY_ACTIVE', 'Wait for the active run before changing this draft');
    }
  }

  async function mutate<T>(
    id: string,
    fence: ExpertDraftFence | undefined,
    work: (client: PoolClient, row: ExpertDraftRow) => Promise<T>,
  ): Promise<T> {
    const preliminary = await owned(id);
    return database.transaction(async client => {
      await lockConversation(client, preliminary.conversation_id, fence);
      const result = await client.query<ExpertDraftRow>(
        'SELECT * FROM expert_drafts WHERE id=$1 AND owner_id=$2 FOR UPDATE',
        [id, ownerId],
      );
      if (!result.rows[0]) fail(404, 'NOT_FOUND', 'Draft not found');
      if (result.rows[0].conversation_id !== preliminary.conversation_id) {
        throw new Error('DRAFT_CONVERSATION_CHANGED');
      }
      return work(client, result.rows[0]);
    });
  }

  async function validateRow(
    client: PoolClient,
    row: ExpertDraftRow,
  ): Promise<{ profile?: ExpertDraftProfile; validation: ExpertDraftValidation }> {
    const errors: ExpertDraftValidationItem[] = [];
    let profile: ExpertDraftProfile | undefined;
    try {
      profile = normalizeExpertDraftProfile(row.profile);
      await assertOwnedSkills(client, ownerId, profile.skillIds);
      if (!profile.description) {
        errors.push({ code: 'DESCRIPTION_REQUIRED', field: 'description', message: 'description is required' });
      }
      if (profile.tags.length !== 3) {
        errors.push({ code: 'TAGS_REQUIRED', field: 'tags', message: 'exactly three tags are required' });
      }
      if (profile.quickPrompts.length !== 3) {
        errors.push({
          code: 'QUICK_PROMPTS_REQUIRED',
          field: 'quickPrompts',
          message: 'exactly three quick prompts are required',
        });
      }
      if (!profile.icon) {
        errors.push({ code: 'ICON_REQUIRED', field: 'icon', message: 'icon is required' });
      }
    } catch (error) {
      errors.push({
        code: error instanceof HttpError ? error.code : 'INVALID_EXPERT_PROFILE',
        message: error instanceof Error ? error.message : 'Invalid expert profile',
      });
    }
    const validation: ExpertDraftValidation = {
      revision: row.revision,
      valid: errors.length === 0,
      errors,
      warnings: [],
      checkedAt: Date.now(),
    };
    return { profile, validation };
  }

  return {
    async createEditSession(expertId: string, workspaceId?: string) {
      return database.transaction(async client => {
        const user = await client.query(
          'SELECT id FROM users WHERE id=$1 AND disabled_at IS NULL FOR UPDATE',
          [ownerId],
        );
        if (!user.rows[0]) fail(404, 'NOT_FOUND', 'User not found');
        if (workspaceId) {
          const workspace = await client.query(
            "SELECT id FROM resources WHERE id=$1 AND owner_id=$2 AND kind='workspace' AND deleted_at IS NULL FOR SHARE",
            [workspaceId, ownerId],
          );
          if (!workspace.rows[0]) fail(404, 'NOT_FOUND', 'Workspace not found');
        }
        const expert = await client.query<{ id: string; name: string; data: Record<string, unknown> }>(
          "SELECT id,name,data FROM resources WHERE id=$1 AND owner_id=$2 AND kind='expert' AND deleted_at IS NULL FOR SHARE",
          [expertId, ownerId],
        );
        if (!expert.rows[0]) fail(404, 'NOT_FOUND', 'Expert not found');
        const profile = profileFromResource(expert.rows[0].name, expert.rows[0].data);
        await assertOwnedSkills(client, ownerId, profile.skillIds);
        const preservedData = preservedExpertData(expert.rows[0].data);
        const baseRevision = draftExpertRevision(
          profile.name,
          expertResourceData(profile, preservedData),
        );
        const conversation = await client.query<{ id: string }>(
          `INSERT INTO conversations(owner_id,title,category,workspace_id)
           VALUES($1,$2,'expert_creator',$3) RETURNING id`,
          [ownerId, `修改专家：${profile.name}`.slice(0, 200), workspaceId ?? null],
        );
        const conversationId = conversation.rows[0].id;
        await client.query(
          `INSERT INTO expert_drafts(
             owner_id,conversation_id,operation,expert_id,base_revision,profile,preserved_data
           ) VALUES($1,$2,'edit',$3,$4,$5::jsonb,$6::jsonb)`,
          [
            ownerId,
            conversationId,
            expertId,
            baseRevision,
            JSON.stringify(profile),
            JSON.stringify(preservedData),
          ],
        );
        return { id: conversationId, category: 'expert_creator' as const };
      });
    },

    async ensure(conversationId: string, fence?: ExpertDraftFence) {
      return database.transaction(async client => {
        await lockConversation(client, conversationId, fence);
        await client.query(
          `INSERT INTO expert_drafts(owner_id,conversation_id,operation)
           VALUES($1,$2,'create') ON CONFLICT(conversation_id) DO NOTHING`,
          [ownerId, conversationId],
        );
        const result = await client.query<ExpertDraftRow>(
          'SELECT * FROM expert_drafts WHERE conversation_id=$1 AND owner_id=$2',
          [conversationId, ownerId],
        );
        if (!result.rows[0]) fail(404, 'NOT_FOUND', 'Draft not found');
        return dto(result.rows[0]);
      });
    },

    async byConversation(conversationId: string) {
      const result = await database.query<ExpertDraftRow>(
        'SELECT * FROM expert_drafts WHERE conversation_id=$1 AND owner_id=$2',
        [conversationId, ownerId],
      );
      if (!result.rows[0]) fail(404, 'NOT_FOUND', 'Draft not found');
      return dto(result.rows[0]);
    },

    async get(id: string) {
      return dto(await owned(id));
    },

    async read(id: string) {
      return dto(await owned(id));
    },

    async write(
      id: string,
      value: unknown,
      revision: number,
      fence?: ExpertDraftFence,
    ) {
      const profile = normalizeExpertDraftProfile(value);
      return mutate(id, fence, async (client, row) => {
        if (row.status === 'published') {
          fail(409, 'DRAFT_READ_ONLY', 'Published drafts are read-only');
        }
        expectDraftRevision(row, revision);
        await assertOwnedSkills(client, ownerId, profile.skillIds);
        const result = await client.query<ExpertDraftRow>(
          `UPDATE expert_drafts
              SET profile=$3::jsonb,revision=revision+1,status='editing',validation=NULL,
                  validated_revision=NULL,updated_at=now()
            WHERE id=$1 AND owner_id=$2 RETURNING *`,
          [id, ownerId, JSON.stringify(profile)],
        );
        return dto(result.rows[0]);
      });
    },

    async validate(id: string, fence?: ExpertDraftFence) {
      return mutate(id, fence, async (client, row) => {
        if (row.status === 'published') {
          fail(409, 'DRAFT_READ_ONLY', 'Published drafts are read-only');
        }
        const { validation } = await validateRow(client, row);
        await client.query(
          `UPDATE expert_drafts
              SET validation=$3::jsonb,validated_revision=$4,
                  status=CASE WHEN $5 THEN 'valid' ELSE 'editing' END,updated_at=now()
            WHERE id=$1 AND owner_id=$2`,
          [id, ownerId, JSON.stringify(validation), validation.valid ? row.revision : null, validation.valid],
        );
        return validation;
      });
    },

    async publish(id: string, revision: number, baseRevision?: string) {
      return mutate(id, undefined, async (client, row) => {
        expectDraftRevision(row, revision);
        if (row.status === 'published') {
          return {
            expertId: row.expert_id!,
            revision: row.published_revision!,
            name: row.profile.name,
          };
        }
        if (row.status !== 'valid' || row.validated_revision !== row.revision) {
          fail(409, 'DRAFT_NOT_VALIDATED', 'Validate the current draft revision before publishing');
        }
        const profile = normalizeExpertDraftProfile(row.profile);
        await assertOwnedSkills(client, ownerId, profile.skillIds);

        let expertId = row.expert_id;
        if (row.operation === 'edit') {
          if (!row.base_revision || !baseRevision) {
            fail(400, 'EXPECTED_BASE_REVISION_REQUIRED', 'baseRevision is required for an expert edit');
          }
          if (baseRevision !== row.base_revision) {
            fail(409, 'BASE_REVISION_CHANGED', 'Draft base revision changed; refresh before publishing');
          }
          const current = await client.query<{ id: string; name: string; data: Record<string, unknown> }>(
            "SELECT id,name,data FROM resources WHERE id=$1 AND owner_id=$2 AND kind='expert' AND deleted_at IS NULL FOR UPDATE",
            [row.expert_id, ownerId],
          );
          if (!current.rows[0]) fail(404, 'NOT_FOUND', 'Expert not found');
          if (revisionFromResource(current.rows[0].name, current.rows[0].data) !== row.base_revision) {
            fail(409, 'EXPERT_CHANGED', 'Installed expert changed; create a fresh edit session');
          }
          const data = expertResourceData(profile, row.preserved_data);
          await client.query(
            `UPDATE resources SET name=$3,data=$4::jsonb,updated_at=now()
              WHERE id=$1 AND owner_id=$2`,
            [row.expert_id, ownerId, profile.name, JSON.stringify(data)],
          );
        } else {
          if (baseRevision !== undefined) {
            fail(400, 'BASE_REVISION_NOT_ALLOWED', 'baseRevision is only valid for an expert edit');
          }
          const created = await client.query<{ id: string }>(
            `INSERT INTO resources(owner_id,kind,name,data)
             VALUES($1,'expert',$2,$3::jsonb) RETURNING id`,
            [ownerId, profile.name, JSON.stringify(expertResourceData(profile, row.preserved_data))],
          );
          expertId = created.rows[0].id;
        }
        const publishedRevision = draftExpertRevision(
          profile.name,
          expertResourceData(profile, row.preserved_data),
        );
        await client.query(
          `UPDATE expert_drafts
              SET status='published',expert_id=$3,published_revision=$4,published_at=now(),updated_at=now()
            WHERE id=$1 AND owner_id=$2`,
          [id, ownerId, expertId, publishedRevision],
        );
        return { expertId: expertId!, revision: publishedRevision, name: profile.name };
      });
    },
  };
}

/** Worker-facing surface deliberately excludes publish and edit-session creation. */
export function createExpertDraftAgentService(database: Database, run: ExpertDraftFence) {
  const service = createExpertDraftService(database, run.owner_id);
  async function scoped(id: string) {
    const draft = await service.get(id);
    if (draft.conversationId !== run.conversation_id) throw new Error('DRAFT_SCOPE_MISMATCH');
    return draft;
  }
  return {
    current: () => service.ensure(run.conversation_id, run),
    async read(id: string) {
      await scoped(id);
      return service.read(id);
    },
    async write(id: string, profile: unknown, revision: number) {
      await scoped(id);
      return service.write(id, profile, revision, run);
    },
    async validate(id: string) {
      await scoped(id);
      return service.validate(id, run);
    },
  };
}

