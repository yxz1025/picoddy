import type { Database } from '../../../infra/db.ts';
import type { Run } from '../../../cloud/runs/types.ts';
import { fail } from '../../../shared/errors.ts';
import { object, string } from '../../../shared/validation.ts';
import { createMemoryResourceService } from './service.ts';

export function createMemoryRuntimeService(database: Database, run: Run) {
  const workspaceId = run.selection.workspace.scopeId === run.conversation_id ? null : run.selection.workspace.scopeId;
  return {
    async recall(scope: unknown = 'user') {
      if (typeof scope !== 'string' || !['user', 'working', 'all'].includes(scope)) fail(400, 'INVALID_MEMORY_SCOPE', '记忆范围无效');
      const result = await database.query(`SELECT id,name,data FROM resources WHERE owner_id=$1 AND kind='memory' AND deleted_at IS NULL
        AND (data->>'workspaceId' IS NULL OR data->>'workspaceId'=$2)
        AND (($3 IN ('working','all') AND data->>'scope'='working' AND data->>'conversationId'=$4)
          OR ($3 IN ('user','all') AND coalesce(data->>'scope','user')='user'))
        ORDER BY updated_at DESC,id LIMIT 101`, [run.owner_id, workspaceId, scope, run.conversation_id]);
      if (result.rows.length > 100 || Buffer.byteLength(JSON.stringify(result.rows)) > 100000) fail(413, 'MEMORY_SELECTION_TOO_LARGE', '记忆超出100条限额');
      return result.rows;
    },
    async write(input: unknown) {
      const body = object(input), content = string(body.content, 'content', 1, 16000), kind = string(body.kind ?? 'fact', 'kind', 1, 64);
      const scope = body.scope ?? 'user';
      if (typeof scope !== 'string' || !['user','working'].includes(scope)) fail(400, 'INVALID_MEMORY_SCOPE', '记忆范围无效');
      return database.transaction(async client => {
        const lease = await client.query('SELECT id FROM runs WHERE id=$1 AND owner_id=$2 AND lease_token=$3 AND lease_until>now() AND NOT cancel_requested FOR SHARE', [run.id, run.owner_id, run.lease_token]);
        if (!lease.rowCount) throw new Error('RUN_LEASE_LOST');
        await client.query('SELECT id FROM users WHERE id=$1 FOR UPDATE', [run.owner_id]);
        const stats = await client.query(`SELECT count(*)::integer AS count,coalesce(sum(octet_length(data::text)),0)::integer AS bytes FROM resources WHERE owner_id=$1 AND kind='memory' AND deleted_at IS NULL`, [run.owner_id]);
        if (stats.rows[0].count >= 100 || stats.rows[0].bytes + Buffer.byteLength(content) + 1000 > 100000) fail(413, 'MEMORY_SELECTION_TOO_LARGE', '记忆超出容量限额，请先整理已有记忆');
        const scoped: Database = { query: (sql, values) => client.query(sql, values ? [...values] : undefined), transaction: work => work(client) };
        return createMemoryResourceService({ database: scoped, ownerId: run.owner_id }).create({ title: content.slice(0, 80), content, kind, scope,
          ...(workspaceId ? { workspaceId } : {}), ...(scope === 'working' ? { conversationId: run.conversation_id } : {}) });
      });
    },
  };
}
