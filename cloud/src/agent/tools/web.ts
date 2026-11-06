import { randomUUID } from 'node:crypto';
import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { CloudSandbox } from '../../platform/sandbox.ts';

export const CLOUD_WEB_TOOL_NAMES = ['web_search', 'fetch_content', 'get_search_content', 'source_check'] as const;
const MAX_REQUEST_BYTES = 256 * 1024;
const labels: Record<string, string> = {
  web_search: '网络搜索', fetch_content: '读取网页', get_search_content: '读取搜索结果', source_check: '来源核查',
};

/** The bridge retains the upstream MCP cache for this task only. No host network I/O. */
export async function createWebTools(sandbox: CloudSandbox, guard: () => Promise<void>, signal?: AbortSignal) {
  const bridgeId = randomUUID();
  let closed = false;
  async function request(action: 'list' | 'call' | 'close', name?: string, args?: unknown, stop?: AbortSignal) {
    stop?.throwIfAborted();
    const body = Buffer.from(JSON.stringify({ bridgeId, action, name, arguments: args }));
    if (body.length > MAX_REQUEST_BYTES) throw new Error('WEB_REQUEST_TOO_LARGE');
    const path = `/workspace/.web-request-${randomUUID()}.json`;
    await sandbox.write(path, body);
    try {
      const result = await sandbox.exec(`node /opt/picoddy/runtime/web-access.mjs request ${path}`, stop);
      const value = JSON.parse(result.stdout);
      if (result.exitCode !== 0 || value.error) throw new Error('WEB_ACCESS_FAILED');
      return value;
    } finally { await sandbox.exec(`rm -f -- ${path}`).catch(() => {}); }
  }
  const dispose = async () => {
    if (closed) return;
    closed = true;
    await request('close', undefined, undefined, AbortSignal.timeout(5000));
  };
  try {
    await guard();
    const listing = await request('list', undefined, undefined, signal) as {
      tools: Array<{ name: string; description?: string; inputSchema: Record<string, unknown> }>;
    };
    if (!Array.isArray(listing.tools) || listing.tools.length !== CLOUD_WEB_TOOL_NAMES.length) throw new Error('WEB_TOOL_CONTRACT_MISMATCH');
    const tools: AgentTool<any>[] = CLOUD_WEB_TOOL_NAMES.map(name => {
      const entries = listing.tools.filter(tool => tool.name === name);
      if (entries.length !== 1 || entries[0].inputSchema?.type !== 'object') throw new Error('WEB_TOOL_CONTRACT_MISMATCH');
      const definition = entries[0];
      return {
        name, label: labels[name], description: definition.description ?? name,
        parameters: Type.Unsafe(definition.inputSchema),
        executionMode: 'sequential',
        async execute(_id, args, stop) {
          stop?.throwIfAborted();
          await guard();
          if (closed) throw new Error('WEB_SESSION_CLOSED');
          try {
            const result = await request('call', name, args, stop);
            if (!Array.isArray(result.content)) throw new Error('WEB_INVALID_RESPONSE');
            return { content: result.content, details: {}, ...(result.isError ? { isError: true } : {}) };
          } catch (error) {
            stop?.throwIfAborted();
            return { content: [{ type: 'text', text: '联网工具执行失败，请重试或说明当前无法获取可靠来源。' }],
              details: { error: error instanceof Error && error.message === 'WEB_REQUEST_TOO_LARGE' ? error.message : 'WEB_ACCESS_FAILED' }, isError: true };
          }
        },
      };
    });
    return { tools, dispose };
  } catch (error) {
    await dispose().catch(() => {});
    throw error;
  }
}
