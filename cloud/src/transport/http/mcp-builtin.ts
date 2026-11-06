import type { RequestContext } from './routes.ts';
import { createBuiltinNpmService, type BuiltinNpmId } from '../../domains/connector/node/builtin-npm.ts';
import { object } from '../../shared/validation.ts';
import { builtinInstalled, runBuiltinInSandbox } from '../../platform/builtin-sandbox.ts';

export interface BuiltinMcpDependencies {
  installed?: typeof builtinInstalled;
  run?: typeof runBuiltinInSandbox;
}

export async function handleBuiltinMcpRoutes(context: RequestContext, dependencies: BuiltinMcpDependencies = {}): Promise<boolean> {
  const path = context.url.pathname, method = context.request.method ?? 'GET';
  const npm = path.match(/^\/api\/mcp\/builtin\/npm\/(gitlab|jenkins)(?:\/(install|configure))?$/);
  if (npm) {
    const service = createBuiltinNpmService(context.database, context.config, context.user.id,
      (id, force) => (dependencies.installed ?? builtinInstalled)(context.config, id, force)), id = npm[1] as BuiltinNpmId;
    if (method === 'GET' && !npm[2]) context.json(200, await service.status(id));
    else if (method === 'POST' && npm[2] === 'install') {
      if (Object.keys(object(await context.readJson(4096))).length) context.fail(400, 'INVALID_REQUEST', '安装不接受自定义参数');
      context.json(200, await service.install(id));
    } else if (method === 'POST' && npm[2] === 'configure') context.json(200, await service.configure(id, await context.readJson(65536)));
    else return false;
    return true;
  }
  if (path === '/api/mcp/presets/figma' && method === 'POST') context.fail(409, 'FIGMA_CLOUD_UNAVAILABLE', 'Figma 桌面 MCP 暂未对接云端');
  return false;
}
