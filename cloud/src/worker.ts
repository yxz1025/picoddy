import { randomUUID } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import { setTimeout as delay } from 'node:timers/promises';
import { loadConfig, type Config } from './config.ts';
import { assertDatabaseInitialized, database, pool, query, transaction } from './infra/db.ts';
import { createStorage } from './platform/storage.ts';
import { cleanupFileDeletions } from './domains/attachment/node/cleanup.ts';
import { createSandbox, destroySandbox, reconcileRunSandboxes, type CloudSandbox } from './platform/sandbox.ts';
import { executeAgent } from './agent/execute.ts';
import { emitRun, assertLease } from './cloud/runs/events.ts';
import { restoreWorkspace } from './domains/workspace/node/sync.ts';
import { persistWorkspace } from './domains/workspace/node/files.ts';
import type { Run } from './cloud/runs/types.ts';

const active = ['provisioning','running','waiting_approval','cancelling'];
const LEASE_SECONDS = 60;

export async function claimRun(config: Config): Promise<Run | undefined> {
  const token = randomUUID();
  const result = await query(`WITH next AS (
      SELECT r.id FROM runs r JOIN users u ON u.id=r.owner_id
      WHERE r.status='queued' AND r.parent_tool_call_id IS NULL AND NOT r.cancel_requested AND u.disabled_at IS NULL
      ORDER BY r.created_at FOR UPDATE OF r SKIP LOCKED LIMIT 1
    ) UPDATE runs r SET status='provisioning',lease_token=$1,lease_until=now()+$2*interval '1 second',
      started_at=now(),updated_at=now(),cleanup_after=now()+$3*interval '1 second'
    FROM next WHERE r.id=next.id RETURNING r.*`,[token,LEASE_SECONDS,config.sandboxTimeoutSeconds+300]);
  return result.rows[0] as Run | undefined;
}

export async function renewRunLease(run: Run): Promise<boolean> {
  const result = await query(`UPDATE runs SET lease_until=now()+$3*interval '1 second'
    WHERE id=$1 AND lease_token=$2 AND lease_until>now()
      AND EXISTS(SELECT 1 FROM users u WHERE u.id=runs.owner_id AND u.disabled_at IS NULL)
      AND (parent_run_id IS NULL OR EXISTS(SELECT 1 FROM runs p WHERE p.id=runs.parent_run_id AND p.owner_id=runs.owner_id AND p.lease_until>now() AND NOT p.cancel_requested AND p.status='running'))
    RETURNING cancel_requested`, [run.id, run.lease_token, LEASE_SECONDS]);
  return Boolean(result.rows[0]) && !result.rows[0].cancel_requested;
}

async function finish(run: Run, status: string, error: string | null, usage: unknown, sandboxId: string | null, cleanupTarget=status) {
  await transaction(async client => {
    const result = await client.query(`UPDATE runs SET status=CASE WHEN cancel_requested AND $3<>'cleanup_pending' THEN 'cancelled' ELSE $3 END,
      error=$4,usage=$5::jsonb,sandbox_id=$6,lease_until=NULL,lease_token=NULL,updated_at=now(),
      finished_at=CASE WHEN $3='cleanup_pending' THEN NULL ELSE now() END,
      cleanup_target_status=CASE WHEN cancel_requested THEN 'cancelled' ELSE $7 END
      WHERE id=$1 AND lease_token=$2 RETURNING owner_id,status`,
      [run.id,run.lease_token,status,error,JSON.stringify(usage),sandboxId,cleanupTarget]);
    if (!result.rows[0]) return;
    await client.query(`UPDATE runs SET cancel_requested=true,
      status=CASE WHEN status='queued' THEN 'cancelled' WHEN status='cleanup_pending' THEN status ELSE 'cancelling' END,
      finished_at=CASE WHEN status='queued' THEN now() ELSE finished_at END,updated_at=now()
      WHERE parent_run_id=$1 AND owner_id=$2 AND status IN ('queued','provisioning','running','waiting_approval','cancelling','cleanup_pending')`,[run.id,run.owner_id]);
    await client.query("UPDATE user_questions SET status='cancelled' WHERE run_id=$1 AND owner_id=$2 AND status='pending'", [run.id, run.owner_id]);
    await client.query("UPDATE approvals SET status='denied',decided_at=now() WHERE run_id=$1 AND status='pending'",[run.id]);
    await client.query("INSERT INTO events(owner_id,run_id,type,payload) VALUES($1,$2,'status',$3)",
      [result.rows[0].owner_id,run.id,JSON.stringify({status:result.rows[0].status,error})]);
    if(run.parent_run_id) await client.query("INSERT INTO events(owner_id,run_id,type,payload) VALUES($1,$2,'subagent.lifecycle',$3::jsonb)",
      [run.owner_id,run.parent_run_id,JSON.stringify({childRunId:run.id,childSessionId:run.conversation_id,role:run.selection.delegation?.role,status:result.rows[0].status,error})]);
  });
}

export async function executeRun(run: Run, config: Config, stopping: AbortSignal, seed?: (sandbox: CloudSandbox) => Promise<void>) {
  const controller = new AbortController();
  const abort = () => controller.abort(new Error('WORKER_STOPPING'));
  stopping.addEventListener('abort',abort,{once:true});
  if (stopping.aborted) abort();
  const timeout = setTimeout(() => controller.abort(new Error('RUN_TIMEOUT')),config.sandboxTimeoutSeconds*1000);
  const heartbeatStop = new AbortController();
  const heartbeat = (async () => {
    while (!heartbeatStop.signal.aborted) {
      try {
        await delay(10_000,undefined,{signal:heartbeatStop.signal});
        if (!await renewRunLease(run)) { controller.abort(new Error('RUN_CANCELLED_OR_LEASE_LOST')); break; }
      } catch (error) {
        if (!heartbeatStop.signal.aborted) controller.abort(error);
        break;
      }
    }
  })();
  let sandbox: CloudSandbox | undefined;
  let createAttempted=false;
  let status='failed', error: string | null=null, usage: unknown={};
  try {
    await emitRun(run,'status',{status:'provisioning'});
    controller.signal.throwIfAborted();
    createAttempted=true;
    sandbox=await createSandbox(config,run.id,controller.signal);
    run.sandbox_id=sandbox.id;
    const owned=await query(`UPDATE runs SET sandbox_id=$3,status=CASE WHEN cancel_requested THEN 'cancelling' ELSE 'running' END,updated_at=now()
      WHERE id=$1 AND lease_token=$2 AND lease_until>now()
        AND EXISTS(SELECT 1 FROM users u WHERE u.id=runs.owner_id AND u.disabled_at IS NULL)
      RETURNING cancel_requested`,[run.id,run.lease_token,sandbox.id]);
    if (!owned.rows[0] || owned.rows[0].cancel_requested) throw new Error('RUN_CANCELLED_OR_LEASE_LOST');
    controller.signal.throwIfAborted();
    await emitRun(run,'status',{status:'running'});
    const storage = createStorage(config);
    const guard = async () => { controller.signal.throwIfAborted(); await assertLease(run); };
    if (seed) await seed(sandbox);
    else await restoreWorkspace(run.selection.workspace, run.owner_id, storage, sandbox, guard);
    usage=await executeAgent(run,config,sandbox,controller.signal,async (child,signal,childSeed)=>{
      await guard(); signal.throwIfAborted();
      const token=randomUUID();
      const claimed=await query(`UPDATE runs c SET status='provisioning',lease_token=$3,lease_until=now()+interval '60 seconds',
        started_at=now(),updated_at=now(),cleanup_after=now()+$4*interval '1 second'
        WHERE c.id=$1 AND c.owner_id=$2 AND c.parent_run_id=$5 AND c.status='queued' AND NOT c.cancel_requested
          AND EXISTS(SELECT 1 FROM users u WHERE u.id=c.owner_id AND u.disabled_at IS NULL)
          AND EXISTS(SELECT 1 FROM runs p WHERE p.id=$5 AND p.owner_id=$2 AND p.lease_token=$6 AND p.lease_until>now() AND NOT p.cancel_requested AND p.status='running')
        RETURNING c.*`,[child.id,run.owner_id,token,config.sandboxTimeoutSeconds+300,run.id,run.lease_token]);
      if (claimed.rows[0]) await executeRun(claimed.rows[0] as Run,config,signal,childSeed);
      else {
        const state=await query('SELECT status FROM runs WHERE id=$1 AND owner_id=$2 AND parent_run_id=$3',[child.id,run.owner_id,run.id]);
        if(!['succeeded','failed','cancelled','interrupted'].includes(state.rows[0]?.status)) throw new Error('CHILD_NOT_CLAIMABLE');
      }
    });
    if (!run.parent_run_id && run.selection.runtimeProfile.mode === 'craft' && run.selection.permission === 'full') {
      const synced = await persistWorkspace({ database, storage, sandbox, run, signal: controller.signal, guard });
      if (synced.status === 'conflict') throw new Error('WORKSPACE_REVISION_CONFLICT');
    }
    status='succeeded';
  } catch (cause) {
    // Provider/SDK messages can include URLs, arguments and secrets; do not expose them to logs or clients.
    error=controller.signal.aborted ? (stopping.aborted?'WORKER_INTERRUPTED':'RUN_CANCELLED_OR_TIMEOUT') : 'RUN_EXECUTION_FAILED';
    if (!controller.signal.aborted && cause instanceof Error && cause.message === 'WORKSPACE_REVISION_CONFLICT') error = 'WORKSPACE_REVISION_CONFLICT';
    if (!controller.signal.aborted && cause instanceof Error && ['GOAL_WAITING_FOR_USER','GOAL_NOT_COMPLETED','GOAL_DECLARATION_REQUIRED','DELIVERY_CHANGED','WORKSPACE_FILE_CHANGED'].includes(cause.message)) error = cause.message;
    status=stopping.aborted?'interrupted':'failed';
    console.error(JSON.stringify({runId:run.id,event:'run_error',code:error,errorType:cause instanceof Error?cause.name:'Error'}));
  } finally {
    clearTimeout(timeout);
    const cleanupTarget=status;
    let destroyed=!createAttempted;
    if (sandbox) {
      try { await sandbox.destroy(); destroyed=true; } catch { error='SANDBOX_CLEANUP_PENDING'; }
    }
    // A failed create may have reached the server: no sandbox ID means TTL quarantine, not proven cleanup.
    if (!destroyed) status='cleanup_pending';
    heartbeatStop.abort(); await heartbeat;
    stopping.removeEventListener('abort',abort);
    await finish(run,status,error,usage,destroyed?null:run.sandbox_id,cleanupTarget);
  }
}

/** Reclaim only for cleanup. Never re-run a possibly side-effecting task after a crash. */
export async function recoverRun(config: Config): Promise<boolean> {
  // Children execute inline with a parent lane, never via general queue claims.
  // A crash must not leave queued children runnable without their parent seed.
  await query(`UPDATE runs c SET status='cancelled',cancel_requested=true,finished_at=now(),updated_at=now()
    WHERE c.parent_tool_call_id IS NOT NULL AND c.status='queued' AND NOT EXISTS(
      SELECT 1 FROM runs p WHERE p.id=c.parent_run_id AND p.owner_id=c.owner_id AND p.status='running' AND p.lease_until>now() AND NOT p.cancel_requested)`);
  const token=randomUUID();
  const candidate=await query(`WITH next AS (
    SELECT id FROM runs WHERE
      (status=ANY($1::text[]) AND lease_until<now()) OR
      (status='cleanup_pending' AND (lease_until IS NULL OR lease_until<now()) AND updated_at<now()-interval '30 seconds')
    ORDER BY updated_at FOR UPDATE SKIP LOCKED LIMIT 1
  ) UPDATE runs r SET status='cleanup_pending',lease_token=$2,lease_until=now()+interval '60 seconds',updated_at=now(),
      cleanup_target_status=coalesce(cleanup_target_status,CASE WHEN cancel_requested THEN 'cancelled' ELSE 'interrupted' END)
    FROM next WHERE r.id=next.id RETURNING r.*`,[active,token]);
  const run=candidate.rows[0] as (Run & {cleanup_target_status:string;cleanup_after:string;usage:unknown;error:string|null}) | undefined;
  if (!run) return false;
  try {
    if (run.sandbox_id) await destroySandbox(config,run.sandbox_id);
    else {
      if (Date.now()<new Date(run.cleanup_after).getTime()) throw new Error('WAIT_FOR_TTL');
      await reconcileRunSandboxes(config,run.id);
    }
    const target=run.cleanup_target_status || 'interrupted';
    await finish(run,target,target==='succeeded'?null:target==='interrupted'?'WORKER_INTERRUPTED':run.error,run.usage || {},null);
  } catch {
    await query("UPDATE runs SET lease_token=NULL,lease_until=NULL,updated_at=now() WHERE id=$1 AND lease_token=$2",[run.id,token]);
  }
  return true;
}

export async function startWorker(config: Config, signal: AbortSignal) {
  await assertDatabaseInitialized();
  const storage = createStorage(config);
  const cleanup = (async () => {
    while (!signal.aborted) {
      try {
        const result = await cleanupFileDeletions({ database, storage, batchSize: 10, signal });
        if (result.exhausted) console.error(JSON.stringify({ event: 'file_cleanup_exhausted', count: result.exhausted }));
      } catch (error) {
        if (signal.aborted) break;
        console.error(JSON.stringify({ event: 'file_cleanup_failed', errorType: error instanceof Error ? error.name : 'Error' }));
      }
      await delay(10_000, undefined, { signal }).catch(() => {});
    }
  })();
  const lanes = Array.from({length:config.workerConcurrency}, async () => {
    while (!signal.aborted) {
      try {
        await recoverRun(config);
        const run=await claimRun(config);
        if (run) await executeRun(run,config,signal);
        else await delay(1000,undefined,{signal});
      } catch (error) {
        if (signal.aborted) break;
        console.error(JSON.stringify({event:'worker_iteration_failed',errorType:error instanceof Error?error.name:'Error'}));
        await delay(2000,undefined,{signal}).catch(()=>{});
      }
    }
  });
  await Promise.all([...lanes, cleanup]);
}

if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  const stop=new AbortController();
  process.once('SIGINT',()=>stop.abort()); process.once('SIGTERM',()=>stop.abort());
  try { await startWorker(loadConfig(),stop.signal); } finally { await pool.end(); }
}
