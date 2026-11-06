/** Wire protocol follows Tencent @tencent-weixin/openclaw-weixin 2.4.10 (MIT).
 * See THIRD_PARTY_LICENSES.txt. No OpenClaw runtime dependency. */
import { parseWeixinApiJson } from './json.ts';
import { randomBytes } from 'node:crypto';
export const WEIXIN_BASE_URL = 'https://ilinkai.weixin.qq.com';
export function officialBaseUrl(value: string): string {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.weixin.qq.com') || url.username || url.password || url.port || url.search || url.hash || url.pathname !== '/') throw new Error('无效的微信官方服务地址');
  return url.origin;
}
export class WeixinTransientError extends Error {}
export class WeixinSessionExpired extends Error { constructor() { super('微信登录已失效，请重新扫码绑定'); } }
export interface ApiOptions { baseUrl?: string; token?: string; signal?: AbortSignal; timeoutMs?: number }
export class WeixinApi {
  constructor(private readonly request: typeof fetch = fetch) {}
  private async call(endpoint: string, body: unknown | undefined, opts: ApiOptions): Promise<any> {
    const base = officialBaseUrl(opts.baseUrl ?? WEIXIN_BASE_URL);
    const timeout = AbortSignal.timeout(opts.timeoutMs ?? 15_000);
    const signal = opts.signal ? AbortSignal.any([opts.signal, timeout]) : timeout;
    let response: Response;
    try {
      response = await this.request(`${base}/ilink/bot/${endpoint}`, {
        method: body === undefined ? 'GET' : 'POST', redirect: 'error', signal,
        headers: { 'Content-Type': 'application/json', AuthorizationType: 'ilink_bot_token',
          'iLink-App-Id': '', 'iLink-App-ClientVersion': String((2 << 16) | (4 << 8) | 10),
          'X-WECHAT-UIN': Buffer.from(String(randomBytes(4).readUInt32BE())).toString('base64'),
          ...(opts.token ? { Authorization: `Bearer ${opts.token}` } : {}) },
        ...(body === undefined ? {} : { body: JSON.stringify({ ...body as object, base_info: { channel_version: '2.4.10', bot_agent: 'PiCoddy/3.4.2' } }) }),
      });
    } catch {
      opts.signal?.throwIfAborted();
      if (timeout.aborted) throw new WeixinTransientError('微信请求超时');
      throw new WeixinTransientError('微信网络连接失败');
    }
    if (response.status === 401 || response.status === 403) throw new WeixinSessionExpired();
    if (response.status >= 500 || response.status === 429) throw new WeixinTransientError('微信服务暂时不可用');
    if (!response.ok) throw new Error('微信服务暂时不可用');
    // Bound response size before parsing. Cancel oversized or stalled bodies as well.
    const reader = response.body?.getReader();
    if (!reader) throw new Error('微信响应无效');
    const chunks: Uint8Array[] = []; let size = 0;
    const cancel = () => { void reader.cancel().catch(() => {}); };
    signal.addEventListener('abort', cancel, { once: true });
    const checkSignal = () => { opts.signal?.throwIfAborted(); if (timeout.aborted) throw new WeixinTransientError('微信请求超时'); };
    try {
      checkSignal();
      for (;;) {
        let step: Awaited<ReturnType<typeof reader.read>>;
        try { step = await reader.read(); } catch { opts.signal?.throwIfAborted(); throw new WeixinTransientError('微信响应连接中断'); }
        const { done, value } = step;
        checkSignal();
        if (done) break;
        size += value.byteLength;
        if (size > 2 * 1024 * 1024) { cancel(); throw new Error('微信响应过大'); }
        chunks.push(value);
      }
      let data: any;
      try { data = parseWeixinApiJson(Buffer.concat(chunks).toString('utf8')); } catch { throw new Error('微信响应格式无效'); }
      if (data?.ret === -14 || data?.errcode === -14) throw new WeixinSessionExpired();
      if (!data || typeof data !== 'object' || Array.isArray(data) || (data.ret !== undefined && data.ret !== 0) || (data.errcode !== undefined && data.errcode !== 0)) throw new Error('微信请求未成功');
      return data;
    } finally { signal.removeEventListener('abort', cancel); reader.releaseLock(); }
  }
  post(endpoint: 'getupdates' | 'sendmessage' | 'get_bot_qrcode?bot_type=3', body: object, opts: ApiOptions = {}) { return this.call(endpoint, body, opts); }
  qrStatus(qrcode: string, opts: ApiOptions = {}, verifyCode?: string) {
    return this.call(`get_qrcode_status?qrcode=${encodeURIComponent(qrcode)}${verifyCode ? `&verify_code=${encodeURIComponent(verifyCode)}` : ''}`, undefined, { ...opts, timeoutMs: 35_000 });
  }
}
