import QRCode from 'qrcode';
import { weixinLogin, type WeixinLogin } from '../weixin/auth.ts';
import { createTrustedMainWindowGuard } from '../../electron/trusted-main-window.ts';
import type { ChannelService } from './service.ts';
import { validateKnowledgeBinding } from '../knowledge/obsidian.ts';

export function registerChannelIpc(
  handle: (name: string, listener: (...args: any[]) => any) => void,
  getWindow: Parameters<typeof createTrustedMainWindowGuard>[0],
  getChannelService: () => Promise<Pick<ChannelService, 'snapshot' | 'configure' | 'disconnect' | 'reconnect' | 'reconfigure'>> =
    async () => (await import('./runtime.ts')).getChannelService(),
  login: WeixinLogin = weixinLogin,
) {
  const trusted = createTrustedMainWindowGuard(getWindow);
  handle('channels.snapshot', async event => { trusted(event); return (await getChannelService()).snapshot(); });
  const loginId = (input: unknown) => {
    const id = (input as { loginId?: unknown })?.loginId;
    if (typeof id !== 'string' || !/^[a-f0-9-]{36}$/.test(id)) throw new Error('无效的微信授权会话');
    return id;
  };
  handle('channels.weixin.start', async event => {
    trusted(event); const result = await login.start();
    return { loginId: result.loginId, expiresAt: result.expiresAt, qrImage: await QRCode.toDataURL(result.qrContent, { width: 240, margin: 2, errorCorrectionLevel: 'M' }) };
  });
  handle('channels.weixin.poll', async (event, input: unknown) => {
    trusted(event); const id = loginId(input);
    const code = (input as { verifyCode?: unknown }).verifyCode;
    if (code !== undefined && (typeof code !== 'string' || !/^[a-zA-Z0-9]{1,16}$/.test(code))) throw new Error('请输入有效配对码');
    return login.poll(id, code as string | undefined);
  });
  handle('channels.weixin.cancel', async (event, input: unknown) => { trusted(event); login.cancel(loginId(input)); });
  handle('channels.connect', async (event, input: unknown) => {
    trusted(event);
    const p = input as Record<string, unknown> | null;
    if (!p || typeof p !== 'object' || !['dingtalk', 'weixin'].includes(String(p.channelId)) || typeof p.id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(p.id)) throw new Error('无效的通道连接参数');
    const config = p.config as Record<string, unknown> | undefined;
    const allowedConversationIds = config?.allowedConversationIds ?? '';
    const allowedSenderIds = config?.allowedSenderIds ?? '';
    if (typeof allowedConversationIds !== 'string' || typeof allowedSenderIds !== 'string' || allowedConversationIds.length > 10_000 || allowedSenderIds.length > 10_000) throw new Error('无效的通道访问范围');
    const knowledge = await validateKnowledgeBinding(p.knowledge);
    const service = await getChannelService();
    if (p.channelId === 'weixin') {
      const connection = { id: p.id, channelId: 'weixin', name: '个人微信', config: {}, ...(knowledge ? { knowledge } : {}) };
      if (p.loginId !== undefined) {
        const id = loginId(p); await service.configure(connection, login.credentials(id)); login.cancel(id);
      } else await service.reconfigure(connection);
    } else {
      if (typeof p.clientId !== 'string' || typeof p.clientSecret !== 'string' || p.clientId.length > 500 || p.clientSecret.length > 2_000) throw new Error('无效的钉钉连接参数');
      await service.configure({ id: p.id, channelId: 'dingtalk', name: '钉钉机器人', config: { allowedConversationIds, allowedSenderIds }, ...(knowledge ? { knowledge } : {}) }, { clientId: p.clientId.trim(), clientSecret: p.clientSecret.trim() });
    }
    return service.snapshot();
  });
  for (const action of ['disconnect', 'reconnect'] as const) {
    handle(`channels.${action}`, async (event, input: unknown) => {
      trusted(event);
      const id = (input as { id?: unknown } | null)?.id;
      if (typeof id !== 'string' || !/^[a-zA-Z0-9_-]{1,80}$/.test(id)) throw new Error('无效的连接 ID');
      const service = await getChannelService(); await service[action](id); return service.snapshot();
    });
  }
}
