import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Config } from '../../config.ts';
import { query, transaction } from '../../infra/db.ts';
import { assertLease } from '../../cloud/runs/events.ts';
import { createStorage } from '../../platform/storage.ts';
import { runSandboxMcp, type CloudSandbox } from '../../platform/sandbox.ts';
import { getAuthorizedConnector } from '../../domains/connector/node/oauth.ts';
import { isMcpToolVisible } from '../../domains/connector/node/tool-policy.ts';
import { executeBash } from './bash-execution.ts';
import { executeMcpOperation } from './mcp-execution.ts';
import { readMeTool, widgetGuidelinesTool } from './read_me.ts';
import { showWidgetTool } from './show_widget.ts';
import { createMemoryTools } from './memory.ts';
import { createWebFetchTool } from './web-fetch.ts';
import type { Emit, Run } from '../../cloud/runs/types.ts';
import { documentTools } from './doc.ts';
import { createArtifactService, type PresentationInput } from '../../domains/artifact/node/service.ts';
import { database } from '../../infra/db.ts';
import { CLOUD_TOOL_NAMES, resolveCloudToolPolicy } from './contracts.ts';
import { createWebTools, CLOUD_WEB_TOOL_NAMES } from './web.ts';
import { createFileTools } from './files.ts';
import { createRagTools } from './rag.ts';
import { createSkillDraftTools } from './skill-draft.ts';
import { createAskTool } from './ask.ts';
import { createExpertDraftTools } from './expert-draft.ts';
import { createGoalTool } from './goal.ts';
import { createSubagentTool, type RunChild } from './subagent.ts';
import { createCompletionService } from '../../domains/interaction/node/completion.ts';

function text(value: unknown, isError = false) {
  const serialized=typeof value === 'string' ? value : JSON.stringify(value);
  const bounded=serialized.length>60000?`${serialized.slice(0,60000)}\n[tool output truncated; read a smaller range]`:serialized;
  return { content: [{ type: 'text' as const, text: bounded }], details: {}, isError };
}

export async function approve(run: Run, toolCallId: string, tool: string, input: unknown, emit: Emit, signal?: AbortSignal) {
  await assertLease(run);
  const id = randomUUID();
  await transaction(async client=>{
    const owned=await client.query(`SELECT id FROM runs WHERE id=$1 AND owner_id=$2 AND lease_token=$3 AND lease_until>now() AND NOT cancel_requested FOR UPDATE`,[run.id,run.owner_id,run.lease_token]);
    if (!owned.rowCount) throw new Error('RUN_LEASE_LOST');
    await client.query(`INSERT INTO approvals(id,owner_id,run_id,tool_call_id,tool,input,status) VALUES($1,$2,$3,$4,$5,$6,'pending')`,
      [id, run.owner_id, run.id, toolCallId, tool, JSON.stringify(input)]);
    await client.query("UPDATE runs SET status='waiting_approval' WHERE id=$1 AND lease_token=$2", [run.id, run.lease_token]);
  });
  await emit('approval', { id, tool, input });
  await emit('status', { status: 'waiting_approval' });
  const deadline = Date.now() + 5 * 60_000;
  try {
    while (Date.now() < deadline) {
      signal?.throwIfAborted();
      await assertLease(run);
      const result = await query('SELECT status FROM approvals WHERE id=$1 AND owner_id=$2', [id, run.owner_id]);
      if (result.rows[0]?.status === 'approved') return;
      if (result.rows[0]?.status !== 'pending') throw new Error('用户拒绝执行');
      await delay(500, undefined, { signal });
    }
    throw new Error('审批超时，未执行');
  } finally {
    await query("UPDATE approvals SET status='denied',decided_at=now() WHERE id=$1 AND status='pending'", [id]);
    const resumed=await query("UPDATE runs SET status='running' WHERE id=$1 AND lease_token=$2 AND status='waiting_approval' AND NOT cancel_requested AND lease_until>now()", [run.id, run.lease_token]);
    if (resumed.rowCount) await emit('status', { status: 'running' });
  }
}

/** Every callback below performs I/O through the remote sandbox, never child_process. */
export async function createCloudTools(run: Run, sandbox: CloudSandbox, config: Config, emit: Emit, runChild: RunChild = async () => { throw new Error('DELEGATION_EXECUTOR_UNAVAILABLE'); }, signal?: AbortSignal) {
  const policy = resolveCloudToolPolicy(run.selection);
  const web = policy.some(name => name === 'web_fetch' || (CLOUD_WEB_TOOL_NAMES as readonly string[]).includes(name))
    ? await createWebTools(sandbox, () => assertLease(run), signal)
    : { tools: [] as AgentTool<any>[], dispose: async () => {} };
  try {
  const tools: AgentTool<any>[] = [
    ...documentTools(run,sandbox),
    {
      name:'browser',label:'云端浏览器',description:'Open a public HTTP(S) page in sandbox Chromium, returning visible text and links. Use web_search and fetch_content for research. Set screenshot=true only when an image is required; then it is saved under /workspace/output. Each call starts a fresh browser.',
      parameters:Type.Object({url:Type.String({maxLength:4000}),screenshot:Type.Optional(Type.Boolean())}),
      async execute(_id,input,signal) {
        const args=input as {url:string;screenshot?:boolean};
        signal?.throwIfAborted(); await assertLease(run);
        const url=new URL(args.url);
        if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('INVALID_BROWSER_URL');
        const path=`/workspace/.browser-${randomUUID()}.json`;
        await sandbox.write(path,Buffer.from(JSON.stringify(args)));
        const result=await sandbox.exec(`node /opt/picoddy/runtime/browser.mjs ${path}`,signal);
        return text(result.stdout || result.stderr,result.exitCode!==0);
      },
    },
    ...web.tools,
    createWebFetchTool(web.tools.find(tool => tool.name === 'fetch_content')),
    {
      name: 'bash', label: '云端终端', description: 'Execute Linux shell automatically in the task sandbox in full access mode, without per-command approval. Node, Python, Chromium and LibreOffice are installed. Work in /workspace. No access to the user computer.',
      parameters: Type.Object({ command: Type.String({ minLength: 1, maxLength: 20000 }) }),
      async execute(id, input, signal) {
        const args=input as {command:string};
        const result = await executeBash(run.selection, args.command, {
          guard: () => assertLease(run),
          exec: (command, signal) => sandbox.exec(command, signal),
        }, signal);
        return text(result, result.exitCode !== 0);
      },
    },
    ...createFileTools(run, sandbox),
    {
      name: 'present_files', label: '展示交付文件',
      description: 'Present finished files or HTTP(S) links in order; the first opens in the browser preview. Files must be nonempty under /workspace/output and will be durably published for this user. All items must validate. Plain answers and external actions need no extra file.',
      parameters: Type.Object({
        files: Type.Array(Type.Union([
          Type.String({ minLength: 1, maxLength: 4000 }),
          Type.Object({ path: Type.String({ minLength: 1, maxLength: 4000 }), title: Type.Optional(Type.String({ maxLength: 500 })) }),
        ]), { minItems: 1, maxItems: 32 }),
        explanation: Type.Optional(Type.String({ maxLength: 4000 })),
      }),
      async execute(_id, input, signal) {
        signal?.throwIfAborted(); await assertLease(run);
        const details = await createArtifactService({
          database, storage: createStorage(config), maxUploadBytes: config.maxUploadBytes,
        }).present(run, _id, sandbox, input as PresentationInput, signal);
        return {
          content: [{ type: 'text' as const, text: details.explanation ?? '已展示以下交付物，任务要求由最终验收确认：' }],
          details,
        };
      },
    },
    readMeTool, widgetGuidelinesTool, showWidgetTool, ...createMemoryTools(database, run),
    {
      name: 'mcp', label: '连接器', description: 'List or call tools of an explicitly selected connector. In full access, all calls to selected authorized connectors execute automatically without per-call approval. List first to discover schemas. Connector secrets remain outside command logs.',
      parameters: Type.Object({ connectorId: Type.String(), operation: Type.Union([Type.Literal('list'), Type.Literal('call')]), name: Type.Optional(Type.String()), arguments: Type.Optional(Type.Record(Type.String(), Type.Unknown())) }),
      async execute(id, input, signal) {
        const args=input as {connectorId:string;operation:'list'|'call';name?:string;arguments?:Record<string,unknown>};
        const connector = run.selection.connectors.find(item => item.id === args.connectorId);
        if (!connector) throw new Error('CONNECTOR_NOT_SELECTED');
        const exposures = connector.data.toolExposure as Record<string, string> | undefined;
        const visible = (name: string) => isMcpToolVisible(connector.data, name);
        if (args.operation === 'call' && (!args.name || !visible(args.name))) throw new Error('MCP_TOOL_NOT_AVAILABLE');
        if (args.operation === 'list' && connector.data.exposure === 'hidden' && !Object.values(exposures ?? {}).some(value => value !== 'hidden')) throw new Error('MCP_TOOL_NOT_AVAILABLE');
        if (!resolveCloudToolPolicy(run.selection).includes('mcp')) throw new Error('MCP_PERMISSION_DENIED');
        await assertLease(run);
        const result = await executeMcpOperation(run.selection, args, {
          guard: () => assertLease(run),
          authorize: request => getAuthorizedConnector(database, config, run.owner_id, connector.id, connector.data, request.operation === 'call' ? request.arguments ?? {} : undefined),
          invoke: async (authorized, request, tool) => {
            const output: any = await runSandboxMcp(sandbox, { connector: authorized, operation: request.operation, name: request.name, arguments: request.arguments }, signal);
            if (request.operation === 'list' && Array.isArray(output?.tools)) output.tools = output.tools.filter((tool: any) => typeof tool.name === 'string' && visible(tool.name));
            return output;
          },
        });
        return text(result,Boolean(result && typeof result==='object' && 'isError' in result && result.isError));
      },
    },
    ...createRagTools(run, sandbox),
    ...createSkillDraftTools(run, database, createStorage(config), config.maxUploadBytes),
    createAskTool(run, database),
    createGoalTool(createCompletionService({ database, storage: createStorage(config), sandbox, run, maxBytes: config.maxUploadBytes })),
    createSubagentTool({ database, storage: createStorage(config), sandbox, run, maxBytes: config.maxUploadBytes, runChild, guard: () => assertLease(run) }),
    ...createExpertDraftTools(run, database),
  ];
  const expected = CLOUD_TOOL_NAMES.filter(name => web.tools.length > 0 || !(CLOUD_WEB_TOOL_NAMES as readonly string[]).includes(name));
  if (JSON.stringify(tools.map(tool => tool.name)) !== JSON.stringify(expected)) {
    throw new Error('CLOUD_TOOL_CONTRACT_MISMATCH');
  }
  return { tools, dispose: web.dispose };
  } catch (error) {
    await web.dispose().catch(() => {});
    throw error;
  }
}
