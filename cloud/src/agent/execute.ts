import { createModelActivity } from './model-activity.ts';
import { randomUUID } from 'node:crypto';
import { createCloudSession } from './engine.ts';
import { sessionCheckpoint } from './session-checkpoint.ts';
import { loadSessionRuntime, saveSessionRuntime } from '../domains/session/node/runtime.ts';
import type { Config } from '../config.ts';
import { query, transaction } from '../infra/db.ts';
import { assertLease, emitRun } from '../cloud/runs/events.ts';
import { resolveCloudModel } from './model.ts';
import { createCloudTools } from './tools/index.ts';
import { filterCloudToolsByPolicy } from './tools/contracts.ts';
import { inputPath } from './prompt.ts';
import { buildCloudPromptEnvelope } from './prompt-runtime/envelope-builder.ts';
import { createRagService } from '../domains/rag/node/service.ts';
import { database } from '../infra/db.ts';
import { prepareRetrievedTurn } from './retrieval.ts';
import { createStorage } from '../platform/storage.ts';
import type { CloudSandbox } from '../platform/sandbox.ts';
import type { Run } from '../cloud/runs/types.ts';
import { createCompletionService } from '../domains/interaction/node/completion.ts';
import { installCompletionBoundary, verifyWithCompletionRepair, COMPLETION_REPAIR_MESSAGE } from './completion.ts';
import type { RunChild } from './tools/subagent.ts';
import {expertPackageFiles} from './expert-package.ts';

export async function executeAgent(run: Run, config: Config, sandbox: CloudSandbox, signal: AbortSignal, runChild?: RunChild) {
  const emit = (type: string, payload: Record<string, unknown>) => emitRun(run,type,payload);
  const storage = createStorage(config);
  const completion = createCompletionService({ database, storage, sandbox, run, maxBytes: config.maxUploadBytes });
  for (const skill of run.selection.skills) {
    for (const file of skill.files) {
      signal.throwIfAborted(); await assertLease(run);
      await sandbox.write(`/workspace/skills/${skill.id}/${file.path}`, Buffer.from(file.contentBase64,'base64'));
    }
  }
  if(run.selection.expert) {
    for(const file of expertPackageFiles(run.selection.expert)) {
      signal.throwIfAborted(); await assertLease(run);
      await sandbox.write(`/workspace/experts/${run.selection.expert.id}/${file.path}`,Buffer.from(file.contentBase64,'base64'));
    }
  }
  for (const file of run.selection.files) {
    signal.throwIfAborted(); await assertLease(run);
    if (file.owner_id !== run.owner_id) throw new Error('INPUT_OWNER_MISMATCH');
    await sandbox.write(inputPath(file), await storage.get(file.object_key));
  }
  const historyStarted = performance.now();
  const history = await loadSessionRuntime(run);
  const historyRestoreMs = Math.round(performance.now() - historyStarted);
  let runtimeCursor = history.cursor;
  let pending = Promise.resolve();
  let eventError: unknown;
  const {model,apiKey} = resolveCloudModel(run.selection.model,config.encryptionKey,config.modelAllowedHosts);
  const toolRuntime = await createCloudTools(run,sandbox,config,emit,runChild,signal);
  try {
  const tools = filterCloudToolsByPolicy(
    toolRuntime.tools,
    run.selection,
  );
  const contextStarted = performance.now();
  const envelope = buildCloudPromptEnvelope(run, { activeToolNames: tools.map(tool => tool.name) });
  const assemblyMs = Math.round(performance.now() - contextStarted);
  await emit('prompt_manifest', { ...envelope.manifest });
  const userPrompt = await prepareRetrievedTurn({
    query: run.prompt, userPrompt: envelope.userPrompt,
    activeTools: tools.map(tool => tool.name), signal, emit,
    retrieve: () => createRagService({ database, sandbox, run }).retrieveForPrompt(run.prompt, {}, signal),
  });
  const initializationStarted = performance.now();
  const { session, manager } = await createCloudSession({
    sessionId: run.conversation_id, ...history, model, apiKey,
    systemPrompt: envelope.systemPrompt, tools,
    beforeTool: async () => {
      await pending;
      if (eventError) throw eventError;
      signal.throwIfAborted();
      await assertLease(run);
    },
  });
  console.info(JSON.stringify({ event: 'context.runtime', runId: run.id,
    historyRestoreMs, assemblyMs, initializationMs: Math.round(performance.now() - initializationStarted),
    restoredCheckpoint: Boolean(history.entries?.length), lifecycle: 'isolated-run',
  }));
  const agent = session.agent;
  installCompletionBoundary(agent, async () => Boolean(await completion.get()));
  const abort = () => { void session.abort(); };
  signal.addEventListener('abort',abort,{once:true});
  const modelActivity = createModelActivity();
  let delta = '', lastFlush = 0, turns = 0;
  const usage = {inputTokens:0,outputTokens:0,cost:null as number | null};
  const flush = async () => { if (delta) { const text = delta; delta=''; lastFlush=Date.now(); await emit('text_delta',{text}); } };
  // AgentSession listeners are synchronous. Serialize persistence explicitly;
  // a rejected write aborts the session and must not become an unhandled promise.
  const handleEvent = async (event: import('@earendil-works/pi-coding-agent').AgentSessionEvent) => {
    const activity = modelActivity(event);
    if (activity) await emit('model_activity', activity);
    if (event.type === 'message_update' && event.assistantMessageEvent.type === 'text_delta') {
      delta += event.assistantMessageEvent.delta;
      if (Date.now()-lastFlush >= 32 || delta.length > 8192) await flush();
    } else if (event.type === 'message_end') {
      await flush();
      await assertLease(run);
      const message = event.message;
      if (message.role === 'user') {
        const user = await query<{ cursor: string }>(
          `SELECT runtime_sequence::text AS cursor FROM messages
           WHERE owner_id=$1 AND conversation_id=$2 AND run_id=$3 AND content->>'role'='user'`,
          [run.owner_id, run.conversation_id, run.id]);
        if (user.rows.length !== 1) throw new Error('RUN_USER_MESSAGE_MISSING');
        runtimeCursor = user.rows[0].cursor;
      }
      // Hidden runtime guidance is checkpointed as a custom entry, not a user transcript row.
      if (message.role !== 'system' && message.role !== 'custom') {
        // User prompt is inserted atomically by the submission endpoint.
        if (message.role !== 'user') {
          const encoded = JSON.stringify(message);
          if (Buffer.byteLength(encoded)>1024*1024) throw new Error('MESSAGE_TOO_LARGE');
          await transaction(async client=>{
            const messageId=randomUUID();
            const inserted=await client.query<{ cursor: string }>(`INSERT INTO messages(id,owner_id,conversation_id,run_id,content)
              SELECT $1,owner_id,conversation_id,id,$5::jsonb FROM runs WHERE id=$2 AND owner_id=$3 AND lease_token=$4 AND lease_until>now() AND NOT cancel_requested FOR SHARE
              RETURNING runtime_sequence::text AS cursor`,
              [messageId,run.id,run.owner_id,run.lease_token,encoded]);
            if (!inserted.rowCount) throw new Error('RUN_LEASE_LOST');
            await client.query("INSERT INTO events(owner_id,run_id,type,payload) VALUES($1,$2,'message',$3)",
              [run.owner_id,run.id,JSON.stringify({messageId,role:message.role})]);
            runtimeCursor = inserted.rows[0].cursor;
          });
        }
      }
      if (message.role === 'assistant') {
        usage.inputTokens += message.usage.input;
        usage.outputTokens += message.usage.output;
      }
    } else if (event.type === 'tool_execution_start') {
      await flush(); await emit('tool_start',{id:event.toolCallId,name:event.toolName,args:event.args});
    } else if (event.type === 'tool_execution_end') {
      await emit('tool_end',{id:event.toolCallId,name:event.toolName,isError:event.isError,
        ...(['present_files','show_widget'].includes(event.toolName) && !event.isError ? { result: event.result } : {})});
    }
  };
  // Core listeners are awaited before the next provider request, unlike public
  // AgentSession notification listeners.
  const unsubscribeGuard = agent.subscribe(async event => {
    if (event.type === 'turn_start') {
      if (++turns > 80) throw new Error('TURN_LIMIT');
      await pending;
      if (eventError) throw eventError;
      signal.throwIfAborted();
      await assertLease(run);
    }
  });
  const unsubscribe = session.subscribe(event => {
    // These notifications happen after the SDK appends its non-message entry.
    // Capture now, before later events mutate the branch; persist after earlier
    // message writes and before any later writes advance the database cursor.
    const checkpoint = event.type === 'entry_appended' || event.type === 'compaction_end'
      ? structuredClone(sessionCheckpoint(manager)) : undefined;
    pending = pending.then(async () => {
      if (eventError) return;
      await handleEvent(event);
      if (checkpoint) await saveSessionRuntime(run, checkpoint, runtimeCursor);
    }).catch(error => {
      eventError ??= error;
      void session.abort();
    });
  });
  try {
    signal.throwIfAborted();
    await session.prompt(userPrompt, { expandPromptTemplates: false });
    await session.waitForIdle();
    await pending;
    if (eventError) throw eventError;
    const assertHealthy = () => {
      signal.throwIfAborted();
      if (eventError) throw eventError;
      if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
      const last = agent.state.messages.at(-1);
      if (last?.role === 'assistant' && (last.stopReason === 'error' || last.stopReason === 'aborted')) throw new Error(last.errorMessage || last.stopReason);
    };
    assertHealthy();
    if (!await completion.get()) {
      await verifyWithCompletionRepair(() => completion.verify(signal), async () => {
        await assertLease(run);
        await session.sendCustomMessage(COMPLETION_REPAIR_MESSAGE, { triggerTurn: true });
        await session.waitForIdle();
        await pending;
        assertHealthy();
      }, signal);
    }
    if (await completion.get()) {
      session.setActiveToolsByName([]);
      await agent.continue();
      await session.waitForIdle();
      await pending;
      if (eventError) throw eventError;
    }
    await flush();
    signal.throwIfAborted();
    if (agent.state.errorMessage) throw new Error(agent.state.errorMessage);
    const last = agent.state.messages.at(-1);
    if (last?.role === 'assistant' && (last.stopReason === 'error' || last.stopReason === 'aborted')) throw new Error(last.errorMessage || last.stopReason);
    await saveSessionRuntime(run, sessionCheckpoint(manager), runtimeCursor);
    await completion.verify(signal);
    return usage;
  } finally {
    signal.removeEventListener('abort',abort);
    await session.abort();
    await session.waitForIdle();
    await pending;
    unsubscribe(); unsubscribeGuard(); session.dispose();
  }
  } finally {
    // The task sandbox is also destroyed by Worker; a closing bridge must not
    // turn an otherwise verified answer into a new generic execution failure.
    await toolRuntime.dispose().catch(() => console.error(JSON.stringify({ event: 'web_access_close_failed', runId: run.id })));
  }
}
