import { setTimeout as delay } from 'node:timers/promises';
import { randomUUID } from 'node:crypto';
import { WeixinApi, WeixinTransientError, officialBaseUrl, WEIXIN_BASE_URL } from './api.ts';
import type { ChannelCredentials } from '../types.ts';
type LoginStatus = 'wait' | 'scaned' | 'confirmed' | 'expired' | 'need_verifycode' | 'verify_code_blocked' | 'binded_redirect';
interface Pending { qrcode: string; expires: number; baseUrl: string; controller: AbortController; status: LoginStatus; failures: number; credentials?: ChannelCredentials; inflight?: Promise<{ status: LoginStatus }> }
/** Short-lived authorization state. Secrets never cross IPC into the renderer. */
export class WeixinLogin {
  private generation = 0;
  private pending = new Map<string, Pending>();
  constructor(private readonly api = new WeixinApi()) {}
  private get(id: string) {
    const entry = this.pending.get(id);
    if (!entry || entry.expires < Date.now()) { this.cancel(id); throw new Error('微信二维码已过期，请重新扫码'); }
    return entry;
  }
  async start() {
    const generation = ++this.generation;
    // One local settings dialog, one active authorization. Cancel a previous long poll.
    for (const id of this.pending.keys()) this.cancel(id);
    const result = await this.api.post('get_bot_qrcode?bot_type=3', { local_token_list: [] });
    if (generation !== this.generation) throw new Error('微信授权已取消');
    if (typeof result.qrcode !== 'string' || !result.qrcode || result.qrcode.length > 4096 || typeof result.qrcode_img_content !== 'string' || !result.qrcode_img_content || result.qrcode_img_content.length > 4096) throw new Error('微信二维码获取失败');
    const loginId = randomUUID(); const expiresAt = Date.now() + 5 * 60_000;
    this.pending.set(loginId, { qrcode: result.qrcode, expires: expiresAt, baseUrl: WEIXIN_BASE_URL, controller: new AbortController(), status: 'wait', failures: 0 });
    return { loginId, qrContent: result.qrcode_img_content, expiresAt };
  }
  async poll(id: string, verifyCode?: string): Promise<{ status: LoginStatus }> {
    const entry = this.get(id);
    if (entry.status === 'confirmed' || entry.status === 'expired' || entry.status === 'binded_redirect' || entry.status === 'verify_code_blocked') return { status: entry.status };
    if (entry.inflight) return entry.inflight;
    entry.inflight = (async () => {
      const result = await this.api.qrStatus(entry.qrcode, { baseUrl: entry.baseUrl, signal: entry.controller.signal }, verifyCode).catch(async error => {
        entry.controller.signal.throwIfAborted();
        if (error instanceof WeixinTransientError && ++entry.failures <= 5) {
          await delay(Math.min(1000 * 2 ** entry.failures, 10000), undefined, { signal: entry.controller.signal });
          return { status: 'wait', transient: true };
        }
        throw error;
      });
      if (!result.transient) entry.failures = 0;
      this.get(id); entry.controller.signal.throwIfAborted();
      if (result.status === 'scaned_but_redirect') {
        if (typeof result.redirect_host !== 'string') throw new Error('微信官方重定向无效');
        entry.baseUrl = officialBaseUrl(`https://${result.redirect_host}`);
        return { status: 'scaned' as const };
      }
      if (result.status === 'confirmed') {
        const { bot_token: token, ilink_bot_id: botId, ilink_user_id: ownerId } = result;
        if (![token, botId, ownerId].every(value => typeof value === 'string' && value.trim() && value.length < 8192)) throw new Error('微信授权信息不完整，请重新扫码');
        entry.credentials = { token, botId, ownerId, baseUrl: officialBaseUrl(result.baseurl ?? entry.baseUrl) };
      }
      const allowed: LoginStatus[] = ['wait', 'scaned', 'confirmed', 'expired', 'need_verifycode', 'verify_code_blocked', 'binded_redirect'];
      if (!allowed.includes(result.status)) throw new Error('微信授权状态无效');
      entry.status = result.status; return { status: entry.status };
    })().finally(() => { entry.inflight = undefined; });
    return entry.inflight;
  }
  credentials(id: string): ChannelCredentials {
    const entry = this.get(id);
    if (!entry.credentials || entry.status !== 'confirmed') throw new Error('请先扫码确认微信绑定');
    return { ...entry.credentials };
  }
  cancel(id: string) { this.pending.get(id)?.controller.abort(); this.pending.delete(id); }
  dispose() { this.generation++; for (const id of this.pending.keys()) this.cancel(id); }
}

export const weixinLogin = new WeixinLogin();
