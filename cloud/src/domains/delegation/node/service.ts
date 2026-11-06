import { createHash, randomUUID } from 'node:crypto';
import type { Database } from '../../../infra/db.ts';
import type { Run } from '../../../cloud/runs/types.ts';
import { string } from '../../../shared/validation.ts';
import { resolveCloudToolPolicy } from '../../../agent/tools/contracts.ts';
import { delegatedTools, parseDelegation } from './policy.ts';

const active = ['queued','provisioning','running','waiting_approval','cancelling','cleanup_pending'];
export function createDelegationService(database: Database, parent: Run) {
  return {
    async create(toolCallId: string, input: unknown): Promise<Run[]> {
      if (parent.parent_run_id || parent.selection.delegation) throw new Error('DELEGATION_RECURSION_FORBIDDEN');
      if (parent.selection.runtimeProfile.category !== 'assistant') throw new Error('DELEGATION_CATEGORY_FORBIDDEN');
      const requests = parseDelegation(input);
      string(toolCallId, 'toolCallId', 1, 500);
      const digest = createHash('sha256').update(JSON.stringify(requests)).digest('hex');
      const allowed = resolveCloudToolPolicy(parent.selection);
      return database.transaction(async client => {
        const owner = await client.query('SELECT id FROM users WHERE id=$1 AND disabled_at IS NULL FOR UPDATE', [parent.owner_id]);
        if (!owner.rows[0]) throw new Error('RUN_LEASE_LOST');
        const lease = await client.query(`SELECT id FROM runs WHERE id=$1 AND owner_id=$2 AND lease_token=$3 AND lease_until>now()
          AND NOT cancel_requested AND status='running' AND parent_run_id IS NULL FOR UPDATE`, [parent.id, parent.owner_id, parent.lease_token]);
        if (!lease.rows[0]) throw new Error('RUN_LEASE_LOST');
        const closed = await client.query("SELECT id FROM events WHERE run_id=$1 AND owner_id=$2 AND type='goal_declared'", [parent.id,parent.owner_id]);
        if (closed.rows[0]) throw new Error('COMPLETION_FROZEN');
        const existing = await client.query(`SELECT * FROM runs WHERE parent_run_id=$1 AND owner_id=$2 AND parent_tool_call_id=$3 ORDER BY child_index`, [parent.id,parent.owner_id,toolCallId]);
        if (existing.rows.length) {
          if (existing.rows.length !== requests.length || existing.rows.some(row => row.idempotency_key !== `delegated:${digest}:${row.child_index}`)) throw new Error('DELEGATION_CALL_CONFLICT');
          return existing.rows as Run[];
        }
        const count = await client.query('SELECT count(*)::int AS count FROM runs WHERE owner_id=$1 AND status=ANY($2::text[])', [parent.owner_id,active]);
        const total = await client.query('SELECT count(*)::int AS count FROM runs WHERE parent_run_id=$1 AND owner_id=$2', [parent.id,parent.owner_id]);
        if (count.rows[0].count + requests.length > 10 || total.rows[0].count + requests.length > 8) throw new Error('DELEGATION_LIMIT');
        const children: Run[] = [];
        for (const [index, request] of requests.entries()) {
          const conversationId = randomUUID(), id = randomUUID();
          const selection = structuredClone(parent.selection);
          selection.delegation = { parentRunId: parent.id, role: request.role, depth: 1, allowedToolNames: delegatedTools(request.role, allowed, requests.length > 1) };
          selection.files = request.includeAttachments ? selection.files : [];
          const prompt = JSON.stringify({ task: request.task, expectedOutput: request.expectedOutput, role: request.role,
            instructions: 'Work only on this delegated task. Your sandbox is isolated; publish useful outputs with present_files. Return concise evidence, limitations and results. No recursive delegation.' });
          await client.query("INSERT INTO conversations(id,owner_id,title,category,parent_id) VALUES($1,$2,$3,'assistant',$4)", [conversationId,parent.owner_id,`子任务: ${request.role}`,parent.conversation_id]);
          const inserted = await client.query(`INSERT INTO runs(id,owner_id,conversation_id,prompt,selection,idempotency_key,parent_run_id,parent_tool_call_id,child_index)
            VALUES($1,$2,$3,$4,$5::jsonb,$6,$7,$8,$9) RETURNING *`, [id,parent.owner_id,conversationId,prompt,JSON.stringify(selection),`delegated:${digest}:${index}`,parent.id,toolCallId,index]);
          await client.query('INSERT INTO messages(owner_id,conversation_id,run_id,content) VALUES($1,$2,$3,$4::jsonb)', [parent.owner_id,conversationId,id,JSON.stringify({role:'user',content:[{type:'text',text:prompt}],timestamp:Date.now()})]);
          await client.query("INSERT INTO events(owner_id,run_id,type,payload) VALUES($1,$2,'subagent.lifecycle',$3::jsonb)", [parent.owner_id,parent.id,JSON.stringify({childRunId:id,childSessionId:conversationId,role:request.role,status:'queued'})]);
          children.push(inserted.rows[0] as Run);
        }
        return children;
      });
    },
    async cancelChildren() {
      await database.query(`UPDATE runs SET cancel_requested=true,
        status=CASE WHEN status='queued' THEN 'cancelled' WHEN status='cleanup_pending' THEN status ELSE 'cancelling' END,
        finished_at=CASE WHEN status='queued' THEN now() ELSE finished_at END,updated_at=now()
        WHERE parent_run_id=$1 AND owner_id=$2 AND status=ANY($3::text[])`, [parent.id,parent.owner_id,active]);
    },
    async result(childId: string) {
      const found = await database.query('SELECT id,conversation_id,status,error,selection FROM runs WHERE id=$1 AND owner_id=$2 AND parent_run_id=$3', [childId,parent.owner_id,parent.id]);
      const child = found.rows[0];
      if (!child) throw new Error('CHILD_NOT_FOUND');
      const message = await database.query("SELECT content FROM messages WHERE run_id=$1 AND owner_id=$2 AND content->>'role'='assistant' ORDER BY runtime_sequence DESC LIMIT 1", [childId,parent.owner_id]);
      const content = message.rows[0]?.content?.content;
      const output = Array.isArray(content) ? content.filter(part => part.type === 'text').map(part => part.text).join('\n').slice(0,20000) : '';
      return { childRunId: child.id as string, childSessionId: child.conversation_id as string, role: child.selection.delegation.role as string,
        status: child.status as string, error: child.error as string | null, output };
    },
  };
}
