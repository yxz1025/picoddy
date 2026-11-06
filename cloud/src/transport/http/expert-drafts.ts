import { createExpertDraftService } from '../../domains/expert-draft/node/service.ts';
import { createSessionService } from '../../domains/session/node/service.ts';
import { UUID, object, optionalUuid, string } from '../../shared/validation.ts';
import type { RequestContext } from './routes.ts';

export async function handleExpertDraftRoutes(context: RequestContext): Promise<boolean> {
  const path = context.url.pathname;
  const method = context.request.method;
  const service = createExpertDraftService(context.database, context.user.id);

  const edit = /^\/api\/experts\/([0-9a-f-]+)\/edit-session$/i.exec(path);
  if (edit && UUID.test(edit[1]) && method === 'POST') {
    const body = object(await context.readJson());
    const conversation = await service.createEditSession(
      edit[1],
      optionalUuid(body.workspaceId, 'workspaceId'),
    );
    context.json(
      201,
      await createSessionService(context.database).get(context.user.id, conversation.id),
    );
    return true;
  }

  const byConversation = /^\/api\/expert-drafts\/by-conversation\/([0-9a-f-]+)$/i.exec(path);
  if (byConversation && UUID.test(byConversation[1]) && method === 'GET') {
    context.json(200, await service.byConversation(byConversation[1]));
    return true;
  }

  const match = /^\/api\/expert-drafts\/([0-9a-f-]+)(?:\/(validate|publish))?$/i.exec(path);
  if (!match || !UUID.test(match[1])) return false;
  const id = match[1];
  const action = match[2];

  if (method === 'GET' && !action) {
    context.json(200, await service.get(id));
  } else if ((method === 'PATCH' || method === 'PUT') && !action) {
    const body = object(await context.readJson());
    context.json(200, await service.write(id, body.profile, body.expectedRevision as number));
  } else if (method === 'POST' && action === 'validate') {
    context.json(200, await service.validate(id));
  } else if (method === 'POST' && action === 'publish') {
    const body = object(await context.readJson());
    const baseRevision = body.baseRevision === undefined
      ? undefined
      : string(body.baseRevision, 'baseRevision', 1, 256);
    context.json(
      200,
      await service.publish(id, body.expectedRevision as number, baseRevision),
    );
  } else {
    return false;
  }
  return true;
}

