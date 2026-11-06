import type { RequestContext } from './routes.ts';
import { createModelDiagnosticsService } from '../../domains/settings/node/diagnostics.ts';
import type { ModelRequest } from '../../platform/model-request.ts';

export async function handleModelDiagnostics(context:RequestContext,request?:ModelRequest):Promise<boolean>{
  if(context.request.method!=='POST')return false;
  const match=context.url.pathname.match(/^\/api\/providers\/([^/]+)\/models$/);
  const test=context.url.pathname==='/api/settings/test-connection';
  if(!match&&!test)return false;
  const service=createModelDiagnosticsService({database:context.database,ownerId:context.user.id,config:context.config,request});
  const body=await context.readJson(32768);
  context.json(200,match?await service.catalog(decodeURIComponent(match[1]),body):await service.test(body));
  return true;
}
