import type { PoolClient } from 'pg';
import type { Database } from '../../../infra/db.ts';
import { fail } from '../../../shared/errors.ts';
import { parseSkillFiles, validatePackagePath, SKILL_PACKAGE_LIMITS, type ParsedSkillFile } from '../../skill/node/package.ts';

export interface DraftFence { id: string; owner_id: string; conversation_id: string; lease_token: string }
interface DraftRow {
  id: string; owner_id: string; conversation_id: string; skill_id: string | null; base_version: string | null;
  skill_name: string | null; revision: number; status: 'editing' | 'valid' | 'installed'; files: ParsedSkillFile[];
  validation: any; validated_revision: number | null; published_version: string | null;
  installed_at: Date | null; created_at: Date; updated_at: Date;
}
const active = ['queued','provisioning','running','waiting_approval','cancelling','cleanup_pending'];
function dto(row: DraftRow) {
  return { id: row.id, conversationId: row.conversation_id, status: row.status, revision: row.revision,
    skillName: row.skill_name ?? undefined, revisionOf: row.base_version ? row.skill_name : undefined,
    baseVersion: row.base_version ?? undefined, createdAt: new Date(row.created_at).getTime(),
    updatedAt: new Date(row.updated_at).getTime(), installedAt: row.installed_at ? new Date(row.installed_at).getTime() : undefined,
    validation: row.validation ?? undefined };
}
function read(file: ParsedSkillFile) {
  const bytes = Buffer.from(file.contentBase64, 'base64');
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
    if (text.includes('\0')) return { size: bytes.length, binary: true };
    return { text, size: bytes.length, binary: false };
  } catch { return { size: bytes.length, binary: true }; }
}
function expect(row: DraftRow, revision: number) {
  if (!Number.isSafeInteger(revision) || revision < 0) fail(400, 'EXPECTED_REVISION_REQUIRED', 'expectedRevision is required');
  if (row.revision !== revision) fail(409, 'DRAFT_CHANGED', 'Draft changed; refresh before continuing');
}

export function createSkillDraftService(database: Database, ownerId: string) {
  async function owned(id: string): Promise<DraftRow> {
    const result = await database.query('SELECT * FROM skill_drafts WHERE id=$1 AND owner_id=$2', [id, ownerId]);
    if (!result.rows[0]) fail(404, 'NOT_FOUND', 'Draft not found');
    return result.rows[0] as DraftRow;
  }
  async function conversation(client: PoolClient, id: string, fence?: DraftFence) {
    await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [ownerId]);
    const conv = await client.query('SELECT category FROM conversations WHERE id=$1 AND owner_id=$2 FOR UPDATE', [id, ownerId]);
    if (!conv.rows[0]) fail(404, 'NOT_FOUND', 'Conversation not found');
    if (conv.rows[0].category !== 'skill_creator') fail(400, 'INVALID_CATEGORY', 'Skill drafts require a skill_creator conversation');
    if (fence) {
      if (fence.owner_id !== ownerId || fence.conversation_id !== id) throw new Error('DRAFT_SCOPE_MISMATCH');
      const run = await client.query(`SELECT id FROM runs WHERE id=$1 AND owner_id=$2 AND conversation_id=$3 AND lease_token=$4
        AND lease_until>now() AND NOT cancel_requested AND status='running' FOR UPDATE`, [fence.id, ownerId, id, fence.lease_token]);
      if (!run.rows[0]) throw new Error('RUN_LEASE_LOST');
    } else {
      const busy = await client.query('SELECT id FROM runs WHERE owner_id=$1 AND conversation_id=$2 AND status=ANY($3::text[]) LIMIT 1', [ownerId, id, active]);
      if (busy.rows[0]) fail(409, 'RUN_ALREADY_ACTIVE', 'Wait for the active run before changing this draft');
    }
  }
  async function mutate<T>(id: string, fence: DraftFence | undefined, work: (client: PoolClient, row: DraftRow) => Promise<T>) {
    const preliminary = await owned(id);
    return database.transaction(async client => {
      await conversation(client, preliminary.conversation_id, fence);
      const result = await client.query('SELECT * FROM skill_drafts WHERE id=$1 AND owner_id=$2 FOR UPDATE', [id, ownerId]);
      if (!result.rows[0]) fail(404, 'NOT_FOUND', 'Draft not found');
      return work(client, result.rows[0] as DraftRow);
    });
  }
  async function installed(row: DraftRow) {
    const result = await database.query(`SELECT v.files FROM resources r JOIN skill_versions v ON v.skill_id=r.id AND v.owner_id=r.owner_id AND v.version=r.data->>'currentVersion'
      WHERE r.id=$1 AND r.owner_id=$2 AND r.kind='skill' AND r.deleted_at IS NULL`, [row.skill_id, ownerId]);
    if (!result.rows[0]) fail(404, 'NOT_FOUND', 'Installed skill not found');
    return result.rows[0].files as ParsedSkillFile[];
  }
  return {
    async createRevisionSession(skillId: string, workspaceId?: string) {
      return database.transaction(async client => {
        await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [ownerId]);
        if (workspaceId) {
          const workspace = await client.query("SELECT id FROM resources WHERE id=$1 AND owner_id=$2 AND kind='workspace' AND deleted_at IS NULL", [workspaceId, ownerId]);
          if (!workspace.rows[0]) fail(404, 'NOT_FOUND', 'Workspace not found');
        }
        const skill = await client.query(`SELECT r.name,v.version,v.files FROM resources r JOIN skill_versions v
          ON v.skill_id=r.id AND v.owner_id=r.owner_id AND v.version=r.data->>'currentVersion'
          WHERE r.id=$1 AND r.owner_id=$2 AND r.kind='skill' AND r.deleted_at IS NULL FOR SHARE OF r`, [skillId, ownerId]);
        if (!skill.rows[0]) fail(404, 'NOT_FOUND', 'Skill not found');
        const value = skill.rows[0];
        const conversation = await client.query(`INSERT INTO conversations(owner_id,title,category,workspace_id)
          VALUES($1,$2,'skill_creator',$3) RETURNING id`, [ownerId, `修订技能：${value.name}`.slice(0, 200), workspaceId ?? null]);
        const id = conversation.rows[0].id as string;
        await client.query(`INSERT INTO skill_drafts(owner_id,conversation_id,skill_id,base_version,skill_name,files)
          VALUES($1,$2,$3,$4,$5,$6::jsonb)`, [ownerId, id, skillId, value.version, value.name, JSON.stringify(value.files)]);
        return { id, category: 'skill_creator' as const };
      });
    },
    async ensure(conversationId: string, fence?: DraftFence) {
      return database.transaction(async client => {
        await conversation(client, conversationId, fence);
        await client.query('INSERT INTO skill_drafts(owner_id,conversation_id) VALUES($1,$2) ON CONFLICT(conversation_id) DO NOTHING', [ownerId, conversationId]);
        const result = await client.query('SELECT * FROM skill_drafts WHERE conversation_id=$1 AND owner_id=$2', [conversationId, ownerId]);
        return dto(result.rows[0] as DraftRow);
      });
    },
    async byConversation(id: string) {
      const result = await database.query('SELECT * FROM skill_drafts WHERE conversation_id=$1 AND owner_id=$2', [id, ownerId]);
      if (!result.rows[0]) fail(404, 'NOT_FOUND', 'Draft not found');
      return dto(result.rows[0] as DraftRow);
    },
    async get(id: string) { return dto(await owned(id)); },
    async files(id: string, currentInstalled = false) {
      const row = await owned(id);
      const files = currentInstalled ? await installed(row) : row.files;
      return files.map(file => { const { size, binary } = read(file); return { path: file.path, size, binary }; });
    },
    async read(id: string, path: string, currentInstalled = false) {
      validatePackagePath(path);
      const row = await owned(id);
      const file = (currentInstalled ? await installed(row) : row.files).find(file => file.path === path);
      if (!file) fail(404, 'NOT_FOUND', 'Draft file not found');
      return read(file);
    },
    async write(id: string, path: string, bytes: Uint8Array | null, revision: number, fence?: DraftFence) {
      validatePackagePath(path);
      if (bytes && bytes.length > SKILL_PACKAGE_LIMITS.maxFileBytes) fail(413, 'FILE_TOO_LARGE', 'Draft file exceeds size limit');
      return mutate(id, fence, async (client, row) => {
        if (row.status === 'installed') fail(409, 'DRAFT_READ_ONLY', 'Installed drafts are read-only; create a revision first');
        expect(row, revision);
        const files = row.files.filter(file => file.path !== path);
        if (bytes !== null) files.push({ path, contentBase64: Buffer.from(bytes).toString('base64') });
        for (const file of files) for (const other of files) if (file.path !== other.path && file.path.startsWith(`${other.path}/`)) fail(400, 'INVALID_PATH', 'File/directory path collision');
        if (files.length > SKILL_PACKAGE_LIMITS.maxFiles || files.reduce((sum, file) => sum + Buffer.byteLength(file.contentBase64, 'base64'), 0) > SKILL_PACKAGE_LIMITS.maxTotalUncompressedBytes) fail(413, 'PACKAGE_TOO_LARGE', 'Draft package limit exceeded');
        const result = await client.query(`UPDATE skill_drafts SET files=$3::jsonb,revision=revision+1,status='editing',validation=NULL,validated_revision=NULL,updated_at=now()
          WHERE id=$1 AND owner_id=$2 RETURNING *`, [id, ownerId, JSON.stringify(files)]);
        return dto(result.rows[0] as DraftRow);
      });
    },
    async validate(id: string, fence?: DraftFence) {
      return mutate(id, fence, async (client, row) => {
        const errors: Array<{ code: string; message: string }> = [];
        let name: string | undefined;
        try {
          const parsed = parseSkillFiles(row.files); name = parsed.name;
          if (row.base_version && parsed.name !== row.skill_name) throw new Error('A revision must preserve the installed skill name');
        } catch (error) { errors.push({ code: 'INVALID_SKILL_PACKAGE', message: error instanceof Error ? error.message : 'Invalid package' }); }
        const validation = { valid: errors.length === 0, errors, warnings: [], checkedAt: Date.now(), revision: row.revision };
        await client.query(`UPDATE skill_drafts SET validation=$3::jsonb,validated_revision=$4,
          status=CASE WHEN status='installed' THEN status WHEN $5 THEN 'valid' ELSE 'editing' END,
          skill_name=CASE WHEN base_version IS NOT NULL THEN skill_name ELSE $6 END,updated_at=now() WHERE id=$1 AND owner_id=$2`, [id, ownerId, JSON.stringify(validation), validation.valid ? row.revision : null, validation.valid, validation.valid ? name ?? null : null]);
        return validation;
      });
    },
    async publish(id: string, revision: number) {
      return mutate(id, undefined, async (client, row) => {
        expect(row, revision);
        if (row.status === 'installed') return { name: row.skill_name!, skillId: row.skill_id!, version: row.published_version! };
        if (row.status !== 'valid' || row.validated_revision !== revision) fail(409, 'DRAFT_NOT_VALIDATED', 'Validate the current draft revision before publishing');
        const parsed = parseSkillFiles(row.files);
        let skillId = row.skill_id;
        if (skillId) {
          const current = await client.query("SELECT name,data FROM resources WHERE id=$1 AND owner_id=$2 AND kind='skill' AND deleted_at IS NULL FOR UPDATE", [skillId, ownerId]);
          if (!current.rows[0] || current.rows[0].data.currentVersion !== row.base_version) fail(409, 'INSTALLED_SKILL_CHANGED', 'Installed skill changed; create a fresh revision');
          if (current.rows[0].name !== parsed.name) fail(400, 'SKILL_NAME_MISMATCH', 'A revision must preserve its skill name');
        } else {
          const created = await client.query(`INSERT INTO resources(owner_id,kind,name,data) VALUES($1,'skill',$2,'{"enabled":true}')
            ON CONFLICT DO NOTHING RETURNING id`, [ownerId, parsed.name]);
          if (!created.rows[0]) fail(409, 'SKILL_CONFLICT', 'A skill with this name is already installed');
          skillId = created.rows[0].id;
        }
        await client.query(`INSERT INTO skill_versions(skill_id,owner_id,version,description,files) VALUES($1,$2,$3,$4,$5::jsonb)
          ON CONFLICT(skill_id,version) DO NOTHING`, [skillId, ownerId, parsed.version, parsed.description, JSON.stringify(parsed.files)]);
        await client.query("UPDATE resources SET data=data || $3::jsonb,updated_at=now() WHERE id=$1 AND owner_id=$2", [skillId, ownerId, JSON.stringify({ currentVersion: parsed.version, description: parsed.description })]);
        await client.query(`UPDATE skill_drafts SET status='installed',skill_id=$3,skill_name=$4,published_version=$5,base_version=NULL,
          installed_at=now(),updated_at=now() WHERE id=$1 AND owner_id=$2`, [id, ownerId, skillId, parsed.name, parsed.version]);
        return { name: parsed.name, skillId: skillId!, version: parsed.version };
      });
    },
    async revise(id: string, revision: number) {
      return mutate(id, undefined, async (client, row) => {
        expect(row, revision);
        if (row.status !== 'installed' || !row.skill_id) fail(409, 'DRAFT_NOT_INSTALLED', 'Only an installed draft can create a revision');
        const current = await client.query(`SELECT r.name,v.version,v.files FROM resources r JOIN skill_versions v
          ON v.skill_id=r.id AND v.owner_id=r.owner_id AND v.version=r.data->>'currentVersion'
          WHERE r.id=$1 AND r.owner_id=$2 AND r.deleted_at IS NULL FOR UPDATE OF r`, [row.skill_id, ownerId]);
        if (!current.rows[0]) fail(404, 'NOT_FOUND', 'Installed skill not found');
        const value = current.rows[0];
        const updated = await client.query(`UPDATE skill_drafts SET files=$3::jsonb,base_version=$4,skill_name=$5,
          revision=revision+1,status='editing',validation=NULL,validated_revision=NULL,installed_at=NULL,published_version=NULL,updated_at=now() WHERE id=$1 AND owner_id=$2 RETURNING *`,
          [id, ownerId, JSON.stringify(value.files), value.version, value.name]);
        return dto(updated.rows[0] as DraftRow);
      });
    },
  };
}

/** Worker-facing capability: no install/revise/publish method is exposed. */
export function createSkillDraftAgentService(database: Database, run: DraftFence) {
  const service = createSkillDraftService(database, run.owner_id);
  async function scoped(id: string) {
    const draft = await service.get(id);
    if (draft.conversationId !== run.conversation_id) throw new Error('DRAFT_SCOPE_MISMATCH');
  }
  return {
    current: () => service.byConversation(run.conversation_id),
    files: async (id: string) => { await scoped(id); return service.files(id); },
    read: async (id: string, path: string) => { await scoped(id); return service.read(id, path); },
    write: async (id: string, path: string, bytes: Uint8Array | null, revision: number) => { await scoped(id); return service.write(id, path, bytes, revision, run); },
    validate: async (id: string) => { await scoped(id); return service.validate(id, run); },
  };
}
