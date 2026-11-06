import type { IncomingMessage, ServerResponse } from 'node:http';
import type { Config } from '../../config.ts';
import type { Database } from '../../infra/db.ts';
import { seal } from '../../infra/crypto.ts';
import { fail } from '../../shared/errors.ts';
import { createSessionToken, hashSessionToken, parseCookies, requestSessionToken, sessionCookie, sessionExpiry } from './service.ts';

const BROWSER_COOKIE = 'picoddy_cas_browser';
const TTL = 10 * 60 * 1000;
const TOKEN = /^[A-Za-z0-9_-]{43}$/;
export interface EnterpriseProfile { subject: string; name: string; email: string | null; avatar: string; accessToken: string }
export interface CasContext {
  request: IncomingMessage; response: ServerResponse; url: URL; config: Config; database: Database;
  json(status: number, data: unknown): void;
}

function browserCookie(value: string, config: Config): string {
  return `${BROWSER_COOKIE}=${value}; Path=/api/auth; HttpOnly; SameSite=Lax; Max-Age=${value ? TTL / 1000 : 0}${config.secureCookies ? '; Secure' : ''}`;
}
function browserSecret(request: IncomingMessage): string | undefined {
  const value = parseCookies(request.headers.cookie).get(BROWSER_COOKIE);
  return value && TOKEN.test(value) ? value : undefined;
}

export async function beginCasLogin(c: CasContext): Promise<void> {
  if (!c.config.casLoginUrl || !c.config.casExchangeUrl) fail(503, 'AUTH_NOT_CONFIGURED', '云端登录服务尚未配置');
  const state = createSessionToken();
  const old = browserSecret(c.request);
  const secret = old || createSessionToken();
  const browserHash = hashSessionToken(secret);
  const service = new URL('/api/auth/callback', c.config.publicOrigin);
  service.searchParams.set('state', state);
  const address = hashSessionToken(c.request.socket.remoteAddress || 'unknown');
  await c.database.transaction(async db => {
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`cas:${address}`]);
    await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`cas-browser:${browserHash}`]);
    await db.query('DELETE FROM auth_challenges WHERE expires_at <= now()');
    const count = await db.query<{count: string}>('SELECT count(*)::text AS count FROM auth_challenges WHERE address_hash=$1', [address]);
    // Coarse connection-source ceiling only. A trusted edge must enforce per-client IP rate limits.
    if (Number(count.rows[0]?.count ?? 0) >= 3000) fail(429, 'LOGIN_RATE_LIMITED', '登录请求过于频繁，请稍后重试');
    const attempts = await db.query<{count:string}>('SELECT count(*)::text AS count FROM auth_challenges WHERE browser_hash=$1', [browserHash]);
    if (Number(attempts.rows[0]?.count ?? 0) >= 30) fail(429, 'LOGIN_RATE_LIMITED', '登录请求过于频繁，请稍后重试');
    if (old) {
      await db.query('UPDATE auth_challenges SET revoked=true WHERE browser_hash=$1', [browserHash]);
      await db.query('DELETE FROM sessions WHERE browser_hash=$1', [browserHash]);
    }
    await db.query('INSERT INTO auth_challenges(state_hash,browser_hash,address_hash,service_url,expires_at) VALUES($1,$2,$3,$4,$5)',
      [hashSessionToken(state), browserHash, address, service.toString(), new Date(Date.now()+TTL)]);
  });
  const login = new URL(c.config.casLoginUrl);
  login.searchParams.set('service', service.toString());
  login.searchParams.set('state', state);
  c.response.setHeader('Set-Cookie', browserCookie(secret, c.config));
  c.json(200, {ok: true, authenticated: false, loginUrl: login.toString()});
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid enterprise response');
  return value as Record<string, unknown>;
}
function field(value: unknown, max: number, required = false): string {
  if (value == null && !required) return '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) throw new Error('Invalid enterprise field');
  const text = value.trim();
  if (required && !text) throw new Error('Missing enterprise field');
  return text;
}
export function parseEnterpriseProfile(payload: unknown): EnterpriseProfile {
  const body = record(payload);
  if (body.success !== true) throw new Error('Enterprise authentication rejected');
  const result = record(body.result);
  const info = record(result.userInfo);
  const subject = field(info.username, 200, true);
  const name = field(info.realname || info.displayName || info.nickname || subject, 200, true);
  const email = field(info.email, 320) || null;
  const rawAvatar = field(info.avatar || info.photo || info.profileImage, 2048);
  let avatar = '';
  if (rawAvatar) {
    try { const u = new URL(rawAvatar); if (u.protocol === 'https:' && !u.username && !u.password) avatar = u.toString(); } catch { /* optional invalid avatar is omitted */ }
  }
  return {subject, name, email, avatar, accessToken:field(result.token, 32768, true)};
}

/** Ticket is exchanged once, never validated separately or logged. */
export async function exchangeEnterpriseTicket(config: Config, ticket: string, service: string, transport: typeof fetch = fetch): Promise<EnterpriseProfile> {
  const target = new URL(config.casExchangeUrl);
  target.searchParams.set('ticket', ticket);
  target.searchParams.set('service', service);
  const response = await transport(target, {headers:{accept:'application/json'}, redirect:'error', signal:AbortSignal.timeout(15_000)});
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Empty enterprise response');
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    if (!response.ok) throw new Error('Enterprise exchange failed');
    for (;;) {
      const {done,value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 128*1024) throw new Error('Enterprise response too large');
      chunks.push(value);
    }
    return parseEnterpriseProfile(JSON.parse(Buffer.concat(chunks).toString('utf8')));
  } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
}

export async function finishCasLogin(c: CasContext, transport: typeof fetch = fetch): Promise<void> {
  c.response.setHeader('Cache-Control','no-store');
  c.response.setHeader('Referrer-Policy','no-referrer');
  let destination = '/?auth_error=CAS_LOGIN_EXPIRED';
  try {
    const state = c.url.searchParams.get('state') || '';
    const ticket = c.url.searchParams.get('ticket') || '';
    const secret = browserSecret(c.request);
    if (!TOKEN.test(state) || !secret || !ticket || ticket.length>4096 || /\s|[\u0000-\u001f\u007f]/.test(ticket) ||
      c.url.searchParams.getAll('state').length!==1 || c.url.searchParams.getAll('ticket').length!==1) throw new Error('Invalid callback');
    const claim = await c.database.query<{service_url:string}>(`UPDATE auth_challenges SET consumed_at=now()
      WHERE state_hash=$1 AND browser_hash=$2 AND consumed_at IS NULL AND NOT revoked AND expires_at>now() RETURNING service_url`,
    [hashSessionToken(state),hashSessionToken(secret)]);
    if (!claim.rows[0]) throw new Error('Invalid challenge');
    destination = '/?auth_error=CAS_LOGIN_FAILED';
    const profile = await exchangeEnterpriseTicket(c.config, ticket, claim.rows[0].service_url, transport);
    const token = createSessionToken();
    const expires = sessionExpiry();
    await c.database.transaction(async db => {
      const browserHash = hashSessionToken(secret);
      await db.query('SELECT pg_advisory_xact_lock(hashtextextended($1,0))', [`cas-browser:${browserHash}`]);
      const current = await db.query(`SELECT 1 FROM auth_challenges WHERE state_hash=$1 AND browser_hash=$2
        AND consumed_at IS NOT NULL AND NOT revoked AND expires_at>now() FOR UPDATE`, [hashSessionToken(state),browserHash]);
      if (!current.rowCount) throw new Error('Login superseded');
      const result = await db.query<{id:string}>(`INSERT INTO users(provider,subject,email,name,avatar) VALUES('cas',$1,$2,$3,$4)
        ON CONFLICT(provider,subject) DO UPDATE SET email=EXCLUDED.email,name=EXCLUDED.name,avatar=EXCLUDED.avatar,updated_at=now()
        WHERE users.disabled_at IS NULL RETURNING id`, [profile.subject,profile.email,profile.name,profile.avatar]);
      const user = result.rows[0];
      if (!user) throw new Error('Account disabled');
      const previous = requestSessionToken(c.request);
      if (previous) await db.query('DELETE FROM sessions WHERE token_hash=$1',[hashSessionToken(previous)]);
      await db.query('INSERT INTO sessions(owner_id,token_hash,expires_at,gateway_secret,browser_hash) VALUES($1,$2,$3,$4,$5)',
        [user.id,hashSessionToken(token),expires,seal({accessToken:profile.accessToken},c.config.encryptionKey),browserHash]);
    });
    // Keep the short-lived browser binding: stale/forged callbacks must never clear a newer login.
    c.response.setHeader('Set-Cookie',sessionCookie(token,c.config,expires));
    destination = '/';
  } catch { /* Only fixed public errors: upstream text may contain credentials. */ }
  c.response.writeHead(303,{Location:destination});
  c.response.end();
}
