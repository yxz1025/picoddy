import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';

/** Desktop-compatible alias over the same task-scoped pi-web-access bridge. */
export function createWebFetchTool(fetchContent?: AgentTool<any>): AgentTool<any> {
  return { name: 'web_fetch', label: '网页抓取', description: '通过 pi-web-access 读取 HTTP(S) 网页或 JSON；prompt 可说明要查找的内容。',
    parameters: Type.Object({ url: Type.String({maxLength:4000}), prompt: Type.Optional(Type.String({maxLength:4000})) }),
    async execute(id, input, signal) {
      signal?.throwIfAborted();
      if (!fetchContent) throw new Error('WEB_SESSION_UNAVAILABLE');
      const url = new URL((input as {url:string}).url);
      if (!['http:','https:'].includes(url.protocol) || url.username || url.password) throw new Error('INVALID_WEB_URL');
      return fetchContent.execute(id, { url: url.href }, signal);
    } };
}
