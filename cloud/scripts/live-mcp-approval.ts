// Controlled MCP in a disposable sandbox. No business tools or account resources.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { loadConfig } from '../src/config.ts';
import { createSandbox, reconcileRunSandboxes, runSandboxMcp, type McpConnector } from '../src/platform/sandbox.ts';
import { executeMcpOperation } from '../src/agent/tools/mcp-execution.ts';

const config = loadConfig(), id = randomUUID();
const signal = AbortSignal.timeout(120000);
let sandbox;
try {
  sandbox = await createSandbox(config, id, signal);
  await sandbox.write('/workspace/.approval-fixture.mjs', Buffer.from(`
import {McpServer} from '/opt/picoddy/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js';
import {StdioServerTransport} from '/opt/picoddy/node_modules/@modelcontextprotocol/sdk/dist/esm/server/stdio.js';
const server=new McpServer({name:'approval-fixture',version:'1.0.0'});
for(const [name,annotations] of [['query',{readOnlyHint:true,destructiveHint:false}],['routine_write',{readOnlyHint:false,destructiveHint:false}],['delete_item',{readOnlyHint:false,destructiveHint:true}],['unknown',undefined]]) {
  server.registerTool(name,{inputSchema:{},...(annotations?{annotations}:{})},async()=>({content:[{type:'text',text:'fixture:'+name}]}));
}
await server.connect(new StdioServerTransport());
`));
  const connector: McpConnector = { transport: 'stdio', command: 'node', args: ['/workspace/.approval-fixture.mjs'] };
  const selection = { runtimeProfile: { mode: 'craft', category: 'assistant' }, permission: 'full' } as const;
  for (const [name, expectedApprovals] of [['query', 0], ['routine_write', 0], ['delete_item', 0], ['unknown', 0]] as const) {
    let approvals = 0, calls = 0;
    const result: any = await executeMcpOperation(selection, { operation: 'call', name, arguments: {} }, {
      guard: async () => { signal.throwIfAborted(); }, authorize: async () => connector,
      invoke: async (authorized, request) => { if (request.operation === 'call') calls++; return runSandboxMcp(sandbox!, { connector: authorized, ...request }, signal); },
    });
    assert.equal(approvals, expectedApprovals); assert.equal(calls, 1);
    assert.equal(result.content[0].text, 'fixture:'+name);
    console.log(JSON.stringify({ tool: name, approvals, fixtureCalls: calls }));
  }
} finally {
  try { await sandbox?.destroy(); } finally { await reconcileRunSandboxes(config, id); }
}
console.log(JSON.stringify({ sandboxCleanedUp: true, businessToolsCalled: false }));
