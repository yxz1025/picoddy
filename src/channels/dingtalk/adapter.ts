/** Adapted from huang-x-h/pi-dingtalkbot (MIT), Stream receipt and sessionWebhook replies.
 * See THIRD_PARTY.md. PI CLI command/UI hooks are replaced by ChannelAdapterContext.
 */
import type { ChannelAdapterFactory, ChannelMessage } from '../types.ts';
import { createDingTalkTransport, type DingTalkTransport } from './transport.ts';

export const dingTalkDescriptor = {
  id: 'dingtalk', name: '钉钉机器人',
  configFields: [
    { key: 'allowedConversationIds', label: '允许的群 ID（可选，逗号分隔）', type: 'text' },
    { key: 'allowedSenderIds', label: '允许的发送人 ID（可选，逗号分隔）', type: 'text' },
  ],
  credentialFields: [
    { key: 'clientId', label: '钉钉 App Key', type: 'text', required: true },
    { key: 'clientSecret', label: '钉钉 App Secret', type: 'password', required: true },
  ],
  capabilities: { attachments: false, streaming: false },
} as const;

function replyUrl(value: unknown): string | undefined {
  if (typeof value !== 'string') return;
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && url.hostname === 'oapi.dingtalk.com' && !url.username && !url.password && !url.port && url.pathname === '/robot/sendBySession') return url.href;
  } catch {}
}

export function createDingTalkFactory(
  makeTransport = createDingTalkTransport,
  request: typeof fetch = fetch,
): ChannelAdapterFactory {
  return { descriptor: dingTalkDescriptor, accountId: credentials => credentials.clientId,
    publicIdentity: credentials => ({ clientId: credentials.clientId }), create(context) {
    const { clientId, clientSecret } = context.credentials;
    if (!clientId?.trim() || !clientSecret?.trim()) throw new Error('请填写 App Key 和 App Secret');
    let transport: DingTalkTransport;
    let active = false;
    const seen = new Map<string, number>();
    const replies = new Map<string, { url: string; conversationId: string; expires: number }>();
    const pending = new Set<string>();
    function prune() {
      const now = Date.now();
      for (const [key, time] of seen) if (now - time > 60 * 60_000) seen.delete(key);
      for (const [key, value] of replies) if (value.expires <= now) replies.delete(key);
      while (seen.size > 2_000) seen.delete(seen.keys().next().value!);
      while (replies.size > 2_000) replies.delete(replies.keys().next().value!);
    }
    transport = makeTransport(clientId, clientSecret, context.onStatus);
    transport.listen(async frame => {
      if (!active) return;
      let raw: Record<string, any>;
      try { raw = JSON.parse(frame.data); } catch { transport.ack(frame.headers.messageId); return; }
      const text = raw?.text?.content;
      const id = raw?.msgId;
      const conversationId = raw?.conversationId;
      const senderId = raw?.senderStaffId || raw?.senderId;
      const url = replyUrl(raw?.sessionWebhook);
      if (typeof text !== 'string' || !text.trim() || typeof id !== 'string' || typeof conversationId !== 'string' || typeof senderId !== 'string' || !url) {
        transport.ack(frame.headers.messageId); return;
      }
      prune();
      if (seen.has(id)) { transport.ack(frame.headers.messageId); return; }
      if (pending.has(id)) return;
      pending.add(id);
      replies.set(id, { url, conversationId, expires: Number(raw.sessionWebhookExpiredTime) || Date.now() + 55 * 60_000 });
      try {
        const message: ChannelMessage = { id, conversationId, senderId, text: text.trim(), timestamp: Number(raw.createAt) || Date.now() };
        await context.onMessage(message);
        seen.set(id, Date.now());
        transport.ack(frame.headers.messageId);
      } catch { replies.delete(id); /* Leave unacknowledged so host rejection can be retried. */ }
      finally { pending.delete(id); prune(); }
    });
    return {
      async connect() { active = true; try { await transport.connect(); } catch (error) { active = false; throw error; } },
      async disconnect() { active = false; await transport.disconnect(); seen.clear(); replies.clear(); },
      async send(message) {
        prune();
        const target = message.replyTo ? replies.get(message.replyTo) : undefined;
        if (!active || !target || target.conversationId !== message.conversationId) throw new Error('钉钉回复地址已失效');
        const text = message.text.trim();
        if (!text) return;
        // Split by Unicode code point to keep each request well below DingTalk's text limit.
        const points = Array.from(text);
        for (let start = 0; start < points.length; start += 1_000) {
          const part = points.slice(start, start + 1_000).join('');
          const markdown = message.format === 'markdown';
          const response = await request(target.url, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            redirect: 'error', signal: AbortSignal.timeout(15_000),
            body: JSON.stringify(markdown ? { msgtype: 'markdown', markdown: { title: '消息', text: part } } : { msgtype: 'text', text: { content: part } }),
          });
          if (!response.ok) throw new Error('钉钉回复失败');
          const result = await response.json() as { errcode?: number };
          if (result.errcode !== undefined && result.errcode !== 0) throw new Error('钉钉回复失败');
        }
      },
    };
  } };
}
