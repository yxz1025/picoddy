import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { CronExpressionParser } from 'cron-parser';
import { assertDatabaseInitialized, pool, transaction } from './infra/db.ts';
import { loadConfig } from './config.ts';
import { enqueueRun } from './cloud/runs/service.ts';

export function nextOccurrence(cron: string, timezone: string, after: Date): Date {
  return CronExpressionParser.parse(cron,{tz:timezone,currentDate:after}).next().toDate();
}

/** One transaction owns each tick. A missed interval is skipped, not replayed in a burst. */
export async function tickAutomations(now = new Date()): Promise<number> {
  return transaction(async client=>{
    const lock=await client.query('SELECT pg_try_advisory_xact_lock($1) AS acquired',[0x4a4e4241]);
    if (!lock.rows[0]?.acquired) return 0;
    const due=await client.query(`SELECT r.id,r.owner_id,r.name,r.data FROM resources r JOIN users u ON u.id=r.owner_id
      WHERE r.kind='automation' AND r.deleted_at IS NULL AND r.data->>'enabled'='true' AND u.disabled_at IS NULL
        AND (r.data->>'nextRunAt' IS NULL OR (r.data->>'nextRunAt')::timestamptz<=$1)
      ORDER BY r.created_at LIMIT 100 FOR UPDATE OF r SKIP LOCKED`,[now]);
    let submitted=0;
    for (const row of due.rows) {
      const data=row.data as Record<string,any>;
      let next: Date;
      try { next=nextOccurrence(String(data.cron),String(data.timezone),now); }
      catch {
        await client.query("UPDATE resources SET data=data||$2::jsonb,updated_at=now() WHERE id=$1",[row.id,JSON.stringify({enabled:false,lastError:'INVALID_SCHEDULE'})]);
        continue;
      }
      if (!data.nextRunAt) {
        await client.query("UPDATE resources SET data=data||$2::jsonb WHERE id=$1",[row.id,JSON.stringify({nextRunAt:next.toISOString()})]);
        continue;
      }
      const scheduledFor=new Date(data.nextRunAt).toISOString();
      await client.query("UPDATE resources SET data=data||$2::jsonb,updated_at=now() WHERE id=$1",[row.id,JSON.stringify({nextRunAt:next.toISOString()})]);
      await client.query('SAVEPOINT schedule_run');
      try {
        const unique=await client.query(`INSERT INTO automation_runs(owner_id,automation_id,scheduled_for) VALUES($1,$2,$3)
          ON CONFLICT DO NOTHING RETURNING automation_id`,[row.owner_id,row.id,scheduledFor]);
        if (!unique.rowCount) { await client.query('RELEASE SAVEPOINT schedule_run'); continue; }
        const conversationId=randomUUID();
        await client.query('INSERT INTO conversations(id,owner_id,title) VALUES($1,$2,$3)',[conversationId,row.owner_id,`${row.name} · ${scheduledFor}`]);
        const {run}=await enqueueRun(row.owner_id,conversationId,{
          prompt:data.prompt,skillIds:data.skillIds || [],connectorIds:data.connectorIds || [],fileIds:[],
          modelId:data.modelId || undefined,idempotencyKey:`schedule:${row.id}:${scheduledFor}`,
        },client);
        await client.query('UPDATE automation_runs SET run_id=$3 WHERE automation_id=$1 AND scheduled_for=$2',[row.id,scheduledFor,run.id]);
        await client.query("UPDATE resources SET data=data||$2::jsonb WHERE id=$1",[row.id,JSON.stringify({lastRunId:run.id,lastError:null})]);
        await client.query('RELEASE SAVEPOINT schedule_run');
        submitted++;
      } catch {
        await client.query('ROLLBACK TO SAVEPOINT schedule_run');
        await client.query('RELEASE SAVEPOINT schedule_run');
        await client.query("UPDATE resources SET data=data||$2::jsonb WHERE id=$1",[row.id,JSON.stringify({lastError:'SCHEDULE_SUBMISSION_FAILED'})]);
      }
    }
    return submitted;
  });
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  loadConfig();
  const stop=new AbortController();
  process.once('SIGINT',()=>stop.abort()); process.once('SIGTERM',()=>stop.abort());
  try {
    await assertDatabaseInitialized();
    while (!stop.signal.aborted) {
      try { await tickAutomations(); }
      catch { console.error(JSON.stringify({event:'scheduler_tick_failed'})); }
      await delay(5000,undefined,{signal:stop.signal}).catch(()=>{});
    }
  } finally { await pool.end(); }
}
