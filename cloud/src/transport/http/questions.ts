import { createQuestionService } from '../../domains/interaction/node/questions.ts';
import { UUID, optionalUuid } from '../../shared/validation.ts';
import { fail } from '../../shared/errors.ts';
import type { RequestContext } from './routes.ts';

export async function handleQuestionRoutes(context: RequestContext): Promise<boolean> {
  const service = createQuestionService(context.database);
  const match = /^\/api\/runs\/([0-9a-f-]+)\/questions$/i.exec(context.url.pathname);
  if (match && UUID.test(match[1]) && context.request.method === 'GET') {
    context.json(200, await service.list(context.user.id, match[1])); return true;
  }
  if (context.url.pathname === '/api/ask-answer' && context.request.method === 'POST') {
    const body = await context.readJson();
    const id = optionalUuid(body.requestId, 'requestId');
    if (!id) fail(400, 'INVALID_REQUEST', 'requestId is required');
    context.json(200, await service.answer(context.user.id, id, body.answers)); return true;
  }
  return false;
}
