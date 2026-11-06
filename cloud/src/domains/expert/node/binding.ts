import { createHash } from 'node:crypto';
import type { Database } from '../../../infra/db.ts';
import { fail } from '../../../shared/errors.ts';
import { assertExpertContextBudget } from '../../../agent/prompt-runtime/expert-budget.ts';

export function expertRevision(expert: { name: string; data: Record<string, any> }): string {
  return createHash('sha256').update(JSON.stringify({ name: expert.name, prompt: expert.data.prompt, skillIds: expert.data.skillIds ?? [],
    ...(expert.data.skillhubPackage ? {
      description:expert.data.description??'',tags:expert.data.tags??[],quickPrompts:expert.data.quickPrompts??[],
      icon:expert.data.icon??'',categoryId:expert.data.categoryId??'cloud',packageVersion:expert.data.skillhubPackage.version,
    } : {}),
  })).digest('hex');
}
const active = ['queued','provisioning','running','waiting_approval','cancelling','cleanup_pending'];
export function createExpertBindingService(database: Database, ownerId: string) {
  async function change(conversationId: string, expertId: string | null) {
    return database.transaction(async client => {
      await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [ownerId]);
      const conversation = await client.query('SELECT category FROM conversations WHERE id=$1 AND owner_id=$2 FOR UPDATE', [conversationId, ownerId]);
      if (!conversation.rows[0]) fail(404, 'NOT_FOUND', 'Conversation not found');
      if (conversation.rows[0].category !== 'assistant') fail(400, 'INVALID_CATEGORY', 'Expert binding requires an assistant conversation');
      const busy = await client.query('SELECT id FROM runs WHERE owner_id=$1 AND conversation_id=$2 AND status=ANY($3::text[]) LIMIT 1', [ownerId, conversationId, active]);
      if (busy.rows[0]) fail(409, 'EXPERT_SWITCH_BUSY', 'Cannot switch experts while a run is active');
      let revision: string | null = null;
      if (expertId) {
        const expert = await client.query("SELECT id,name,data FROM resources WHERE id=$1 AND owner_id=$2 AND kind='expert' AND deleted_at IS NULL FOR SHARE", [expertId, ownerId]);
        if (!expert.rows[0]) fail(404, 'NOT_FOUND', 'Expert not found');
        const value = expert.rows[0];
        assertExpertContextBudget({ trust: 'user-supplied-untrusted', id: value.id, name: value.name, instructions: value.data.prompt });
        const skillIds = value.data.skillIds ?? [];
        const skills = await client.query("SELECT id FROM resources WHERE owner_id=$1 AND id=ANY($2::uuid[]) AND kind='skill' AND deleted_at IS NULL AND coalesce((data->>'enabled')::boolean,true)", [ownerId, skillIds]);
        if (skills.rows.length !== skillIds.length) fail(409, 'EXPERT_UNAVAILABLE', 'Expert skills are unavailable');
        revision = expertRevision(value as { name: string; data: Record<string, any> });
      }
      await client.query('UPDATE conversations SET expert_id=$3,expert_revision=$4,updated_at=now() WHERE id=$1 AND owner_id=$2', [conversationId, ownerId, expertId, revision]);
      return expertId ? { expertId, revision: revision!, catalogSource: 'installed' as const } : null;
    });
  }
  return {
    assign: async (conversationId: string, expertId: string) => (await change(conversationId, expertId))!,
    clear: (conversationId: string) => change(conversationId, null),
    async get(conversationId: string) {
      const result = await database.query('SELECT expert_id,expert_revision FROM conversations WHERE id=$1 AND owner_id=$2', [conversationId, ownerId]);
      if (!result.rows[0]) fail(404, 'NOT_FOUND', 'Conversation not found');
      const row = result.rows[0];
      if (!row.expert_id) return null;
      const expert = await database.query("SELECT id FROM resources WHERE id=$1 AND owner_id=$2 AND kind='expert' AND deleted_at IS NULL", [row.expert_id, ownerId]);
      if (!expert.rows[0]) fail(409, 'EXPERT_UNAVAILABLE', 'Bound expert is unavailable');
      return { expertId: row.expert_id as string, revision: row.expert_revision as string, catalogSource: 'installed' as const };
    },
    async uninstall(expertId: string) {
      return database.transaction(async client => {
        await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [ownerId]);
        const expert = await client.query("SELECT id FROM resources WHERE id=$1 AND owner_id=$2 AND kind='expert' AND deleted_at IS NULL FOR UPDATE", [expertId, ownerId]);
        if (!expert.rows[0]) fail(404, 'NOT_FOUND', 'Expert not found');
        const busy = await client.query("SELECT id FROM runs WHERE owner_id=$1 AND selection->'expert'->>'id'=$2 AND status=ANY($3::text[]) LIMIT 1", [ownerId, expertId, active]);
        if (busy.rows[0]) fail(409, 'EXPERT_IN_USE', 'Wait for active expert runs before uninstalling');
        const cleared = await client.query('UPDATE conversations SET expert_id=NULL,expert_revision=NULL,updated_at=now() WHERE owner_id=$1 AND expert_id=$2 RETURNING id', [ownerId, expertId]);
        await client.query('UPDATE resources SET deleted_at=now(),updated_at=now() WHERE id=$1 AND owner_id=$2', [expertId, ownerId]);
        return { affectedConversationIds: cleared.rows.map(row => row.id as string) };
      });
    },
  };
}
