import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import type { ChannelAdapterFactory } from '../types.ts';
import { WeixinApi, officialBaseUrl, WeixinSessionExpired } from './api.ts';
export interface WeixinCheckpoint { cursor: string; seen: string[] }
interface Ports {
  api: WeixinApi;
  load(account: string): Promise<WeixinCheckpoint>;
  save(account: string, checkpoint: WeixinCheckpoint): Promise<void>;
}
export const weixinDescriptor = {
  id: 'weixin', name: '个人微信', credentialFields: [
    { key: 'botId', label: '机器人 ID', type: 'text', required: true },
    { key: 'ownerId', label: '绑定账号 ID', type: 'text', required: true },
    { key: 'token', label: '授权令牌', type: 'password', required: true },
    { key: 'baseUrl', label: '服务地址', type: 'text', required: true },
  ], configFields: [], capabilities: { attachments: false, streaming: false },
} as const;
export function createWeixinFactory(ports: Ports): ChannelAdapterFactory {
  return { descriptor: weixinDescriptor, accountId: credentials => credentials.botId,
    publicIdentity: credentials => ({ botId: credentials.botId, ownerId: credentials.ownerId }),
    create(context) {
      const { botId, ownerId, token } = context.credentials;
      if (!botId || !ownerId || !token) throw new Error('请先扫码绑定微信');
      const baseUrl = officialBaseUrl(context.credentials.baseUrl);
      const account = JSON.stringify([botId, ownerId]);
      let controller: AbortController | undefined; let running: Promise<void> | undefined;
      let checkpoint: WeixinCheckpoint = { cursor: '', seen: [] };
      const replies = new Map<string, { token: string; expires: number }>();
      const prune = () => {
        for (const [id, entry] of replies) if (entry.expires < Date.now()) replies.delete(id);
        while (replies.size > 2000) replies.delete(replies.keys().next().value!);
      };
      async function poll(signal: AbortSignal) {
        const seen = new Set(checkpoint.seen);
        while (!signal.aborted) {
          try {
            const data = await ports.api.post('getupdates', { get_updates_buf: checkpoint.cursor }, { token, baseUrl, signal, timeoutMs: 40_000 });
            signal.throwIfAborted(); context.onStatus('connected'); prune();
            if (data.msgs !== undefined && !Array.isArray(data.msgs)) throw new Error('微信消息格式无效');
            for (const raw of data.msgs ?? []) {
              signal.throwIfAborted();
              if (!raw || raw.message_type !== 1 || raw.from_user_id !== ownerId || raw.group_id || (raw.message_state !== undefined && raw.message_state !== 2)) continue;
              const id = typeof raw.message_id === 'string' ? raw.message_id : Number.isSafeInteger(raw.message_id) ? String(raw.message_id) : '';
              if (!id || seen.has(id)) continue;
              if (!Array.isArray(raw.item_list) || raw.item_list.some((item: any) => item?.type !== 1 || typeof item.text_item?.text !== 'string')) continue;
              const text = Array.isArray(raw.item_list) ? raw.item_list.filter((item: any) => item?.type === 1 && typeof item.text_item?.text === 'string').map((item: any) => item.text_item.text).join('\n').trim() : '';
              // Media is not passed to the agent as invented content. Only text is supported in v1.
              if (!text || text.length > 32_000 || typeof raw.context_token !== 'string' || !raw.context_token || raw.context_token.length > 16_384) continue;
              replies.set(id, { token: raw.context_token, expires: Date.now() + 24 * 60 * 60_000 });
              try { await context.onMessage({ id, conversationId: ownerId, senderId: ownerId, text, timestamp: Number(raw.create_time_ms) || Date.now() }); }
              catch (error) { replies.delete(id); throw error; }
              seen.add(id);
            }
            while (seen.size > 2000) seen.delete(seen.values().next().value!);
            const cursor = typeof data.get_updates_buf === 'string' ? data.get_updates_buf : checkpoint.cursor;
            if (cursor.length > 1024 * 1024) throw new Error('微信同步状态无效');
            checkpoint = { cursor, seen: [...seen] };
            await ports.save(account, checkpoint);
            // Prevent a hot loop when a gateway returns empty responses immediately.
            await delay(300, undefined, { signal });
          } catch (error) {
            if (signal.aborted) break;
            if (error instanceof WeixinSessionExpired) { context.onStatus('error'); break; }
            context.onStatus('reconnecting');
            await delay(2000, undefined, { signal }).catch(() => {});
          }
        }
      }
      return {
        async connect() {
          if (running) return;
          checkpoint = await ports.load(account);
          if (typeof checkpoint.cursor !== 'string' || !Array.isArray(checkpoint.seen) || checkpoint.seen.length > 2000 || !checkpoint.seen.every(id => typeof id === 'string')) throw new Error('微信本机同步状态无效');
          controller = new AbortController();
          running = poll(controller.signal).catch(() => { if (!controller?.signal.aborted) context.onStatus('error'); });
        },
        async disconnect() { controller?.abort(); await running; running = undefined; replies.clear(); },
        async send(message) {
          prune(); const target = message.replyTo ? replies.get(message.replyTo) : undefined;
          if (!controller || controller.signal.aborted || message.conversationId !== ownerId || !target) throw new Error('微信回复会话已失效');
          const points = Array.from(message.text.trim());
          if (!points.length) return;
          const content = points.length > 18_000 ? [...points.slice(0, 17_950), ...Array.from('\n内容较长，完整结果请在电脑端任务中查看。')] : points;
          for (let start = 0; start < content.length; start += 1800) {
            try {
              await ports.api.post('sendmessage', { msg: { from_user_id: '', to_user_id: ownerId, client_id: `picoddy-${randomUUID()}`, message_type: 2, message_state: 2, context_token: target.token, item_list: [{ type: 1, text_item: { text: content.slice(start, start + 1800).join('') } }] } }, { token, baseUrl, signal: controller.signal });
            } catch (error) { if (error instanceof WeixinSessionExpired) { context.onStatus('error'); controller.abort(); } throw error; }
          }
        },
      };
    },
  };
}
