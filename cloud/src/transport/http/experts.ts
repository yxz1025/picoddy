import { createExpertBindingService } from '../../domains/expert/node/binding.ts';
import { UUID, optionalUuid } from '../../shared/validation.ts';
import { fail } from '../../shared/errors.ts';
import type { RequestContext } from './routes.ts';

export async function handleExpertRoutes(context: RequestContext): Promise<boolean> {
  const service = createExpertBindingService(context.database, context.user.id);
  const path = context.url.pathname, method = context.request.method;
  const item = /^\/api\/experts\/([0-9a-f-]+)$/i.exec(path);
  if (item && UUID.test(item[1]) && method === 'DELETE') {
    context.json(200, await service.uninstall(item[1])); return true;
  }
  const match = /^\/api\/conversations\/([0-9a-f-]+)\/expert$/i.exec(path);
  if (!match || !UUID.test(match[1])) return false;
  if (method === 'GET') context.json(200, { binding: await service.get(match[1]) });
  else if (method === 'DELETE') context.json(200, { ok: true, binding: await service.clear(match[1]) });
  else if (method === 'PUT' || method === 'PATCH') {
    const id = optionalUuid((await context.readJson()).expertId, 'expertId');
    if (!id) fail(400, 'INVALID_EXPERT_ID', 'expertId is required');
    context.json(200, { ok: true, binding: await service.assign(match[1], id) });
  } else return false;
  return true;
}
