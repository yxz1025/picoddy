import { SkillHubAuthError } from '../../domains/skillhub/node/auth.ts';
import { createSkillHubService } from '../../domains/skillhub/node/service.ts';
import { loadSkillHubSecret } from '../../platform/skillhub-secret.ts';
import type { RequestContext } from './routes.ts';
import {HttpError} from '../../shared/errors.ts';
import {string} from '../../shared/validation.ts';
import {installSkillHubSkill,installSkillHubExpert} from '../../domains/skillhub/node/install.ts';
import {createSkillHubExpertArchiveInstaller} from '../../domains/skillhub/node/expert-package.ts';

function decodePart(value: string, context: RequestContext): string {
  try { return decodeURIComponent(value); }
  catch { context.fail(400, 'INVALID_SKILLHUB_PATH', '技能市场资源路径无效'); }
}

async function respond<T>(context: RequestContext, operation: () => Promise<T>): Promise<void> {
  try { context.json(200, await operation()); }
  catch (error) {
    if(error instanceof HttpError) throw error;
    if (error instanceof SkillHubAuthError) {
      const code = error.status === 400 ? 'INVALID_SKILLHUB_REQUEST'
        : error.status === 401 || error.status === 403 ? 'SKILLHUB_AUTH_FAILED' : 'SKILLHUB_UNAVAILABLE';
      context.fail(error.status, code, error.message);
    }
    const status = typeof error === 'object' && error && 'status' in error &&
      (error.status === 401 || error.status === 403) ? 401 : 502;
    context.fail(status, status === 401 ? 'SKILLHUB_AUTH_FAILED' : 'SKILLHUB_UNAVAILABLE',
      status === 401 ? '技能市场登录已失效，请重试' : '技能市场服务暂时不可用，请重试');
  }
}

export async function handleSkillHubRoutes(context: RequestContext, fetcher?: typeof fetch): Promise<boolean> {
  const path = context.url.pathname;
  const method = context.request.method;
  if (path === '/api/skillhub/auth/config') {
    if (method !== 'GET') return false;
    try {
      await loadSkillHubSecret(context.config);
      context.json(200, { configured: true, source: 'server', error: null });
    } catch (error) {
      context.json(200, { configured: false, source: 'server', error: error instanceof Error ? error.message : '技能市场服务端认证配置尚未就绪，请联系管理员' });
    }
    return true;
  }

  const detail = /^\/api\/skillhub\/experts\/([^/]+)\/([^/]+)$/.exec(path);
  const recognized = path === '/api/skillhub/experts/install' || path === '/api/skillhub/install' || path === '/api/skillhub/auth/ensure' || path === '/api/skillhub/skills' ||
    path === '/api/skillhub/experts' || path === '/api/skillhub/namespaces' || Boolean(detail);
  if (!recognized) return false;
  const service = createSkillHubService({ config: context.config, database: context.database, user: context.user, fetch: fetcher });
  if((path==='/api/skillhub/install'||path==='/api/skillhub/experts/install')&&method==='POST') {
    const body=await context.readJson(4096);
    const input={namespace:string(body.namespace,'namespace',1,128),slug:string(body.slug,'slug',1,128),version:string(body.version,'version',1,128)};
    await respond(context,()=>service.withToken<unknown>(token=>{
      const dependencies={database:context.database,ownerId:context.user.id,maxUploadBytes:context.config.maxUploadBytes,
        baseUrl:context.config.skillHubBaseUrl,credential:{token},fetchImpl:fetcher,downloadHosts:context.config.skillHubDownloadHosts};
      return path==='/api/skillhub/install'
        ? installSkillHubSkill(dependencies,input)
        : installSkillHubExpert({...dependencies,expertCatalog:createSkillHubExpertArchiveInstaller(context.database)},input);
    }));
    return true;
  }
  if (path === '/api/skillhub/auth/ensure' && method === 'POST') {
    await respond(context, async () => { await service.ensure(); return { ok: true, authenticated: true }; }); return true;
  }
  if (path === '/api/skillhub/skills' && method === 'GET') {
    await respond(context, () => service.skills()); return true;
  }
  if (path === '/api/skillhub/experts' && method === 'GET') {
    await respond(context, () => service.experts()); return true;
  }
  if (path === '/api/skillhub/namespaces' && method === 'GET') {
    await respond(context, () => service.namespaces()); return true;
  }
  if (detail && method === 'GET') {
    await respond(context, () => service.expertDetail(decodePart(detail[1], context), decodePart(detail[2], context))); return true;
  }
  return false;
}
