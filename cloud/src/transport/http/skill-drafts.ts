import { createSkillDraftService } from '../../domains/skill-draft/node/service.ts';
import { UUID, string, optionalUuid } from '../../shared/validation.ts';
import { createSessionService } from '../../domains/session/node/service.ts';
import type { RequestContext } from './routes.ts';

export async function handleSkillDraftRoutes(context: RequestContext): Promise<boolean> {
  const path = context.url.pathname, method = context.request.method;
  const service = createSkillDraftService(context.database, context.user.id);
  const edit = /^\/api\/skills\/([0-9a-f-]+)\/edit-session$/i.exec(path);
  if (edit && UUID.test(edit[1]) && method === 'POST') {
    const body = await context.readJson();
    const conversation = await service.createRevisionSession(edit[1], optionalUuid(body.workspaceId, 'workspaceId'));
    context.json(201, await createSessionService(context.database).get(context.user.id, conversation.id)); return true;
  }
  const byConversation = /^\/api\/skill-drafts\/by-conversation\/([0-9a-f-]+)$/i.exec(path);
  if (byConversation && UUID.test(byConversation[1]) && method === 'GET') {
    context.json(200, await service.byConversation(byConversation[1])); return true;
  }
  const match = /^\/api\/skill-drafts\/([0-9a-f-]+)(?:\/(files|file|installed-files|installed-file|revision|validate|install))?$/i.exec(path);
  if (!match || !UUID.test(match[1])) return false;
  const id = match[1], action = match[2];
  if (method === 'GET' && !action) context.json(200, await service.get(id));
  else if (method === 'GET' && (action === 'files' || action === 'installed-files')) context.json(200, await service.files(id, action === 'installed-files'));
  else if (method === 'GET' && (action === 'file' || action === 'installed-file')) context.json(200, await service.read(id, string(context.url.searchParams.get('path'), 'path', 1, 512), action === 'installed-file'));
  else if (method === 'POST' && action === 'validate') context.json(200, await service.validate(id));
  else if (method === 'POST' && (action === 'revision' || action === 'install')) {
    const body = await context.readJson();
    context.json(200, action === 'revision' ? await service.revise(id, body.expectedRevision as number) : await service.publish(id, body.expectedRevision as number));
  } else return false;
  return true;
}
