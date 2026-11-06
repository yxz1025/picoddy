import { createHash } from 'node:crypto';
import { createWeixinFactory } from '../weixin/adapter.ts';
import { WeixinApi } from '../weixin/api.ts';
import { weixinLogin } from '../weixin/auth.ts';
import { safeStorage } from 'electron';
import { join } from 'node:path';
import { platformPaths } from '../../platform/paths.ts';
import { createConversation } from '../../domains/session/node/store.ts';
import { ChannelRegistry } from '../registry.ts';
import { createDingTalkFactory } from '../dingtalk/adapter.ts';
import { ChannelLocalStore } from './store.ts';
import { ChannelService } from './service.ts';
import { localChannelAgentBridge } from './agent-bridge.ts';

let service: ChannelService | undefined;
let ready: Promise<ChannelService> | undefined;
export function getChannelService(): Promise<ChannelService> {
  if (!ready) ready = (async () => {
    const registry = new ChannelRegistry(); registry.register(createDingTalkFactory());
    const cursorStore = (account: string) => new ChannelLocalStore(join(platformPaths.appDataDir, 'channels', `weixin-${createHash('sha256').update(account).digest('hex')}.enc`), safeStorage);
    registry.register(createWeixinFactory({ api: new WeixinApi(),
      async load(account) {
        const { sessions } = await cursorStore(account).load();
        return { cursor: sessions.cursor ?? '', seen: JSON.parse(sessions.seen ?? '[]') };
      },
      async save(account, checkpoint) { await cursorStore(account).save({ version: 1, connections: [], sessions: { cursor: checkpoint.cursor, seen: JSON.stringify(checkpoint.seen) } }); },
    }));
    service = new ChannelService(registry,
      new ChannelLocalStore(join(platformPaths.appDataDir, 'channels', 'connections.enc'), safeStorage),
      async address => createConversation(`[${registry.get(address.channelId).descriptor.name}] ${address.conversationId.slice(-12)}`, 'assistant').id,
      localChannelAgentBridge,
    );
    await service.initialize(); return service;
  })().catch(error => { ready = undefined; throw error; });
  return ready;
}
export async function stopChannels(): Promise<void> {
  weixinLogin.dispose();
  await ready?.catch(() => {});
  await service?.dispose();
}
