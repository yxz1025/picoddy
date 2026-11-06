import { createPreferenceService } from '../../domains/settings/node/preferences.ts';
import type { RequestContext } from './routes.ts';

export async function handlePreferenceRoutes(context: RequestContext): Promise<boolean> {
  if (context.url.pathname !== '/api/preferences') return false;
  const service = createPreferenceService(context.database);
  if (context.request.method === 'GET') {
    context.json(200, await service.get(context.user.id));
    return true;
  }
  if (context.request.method === 'PATCH') {
    context.json(200, await service.update(context.user.id, await context.readJson(100_000)));
    return true;
  }
  return false;
}
