import { createWorkspaceFilesService } from '../../domains/workspace/node/files.ts';
import { UUID, optionalUuid, string } from '../../shared/validation.ts';
import { fail } from '../../shared/errors.ts';
import { byteRange, inlineMime } from './file-content.ts';
import type { RequestContext } from './routes.ts';

export async function handleWorkspaceFileRoutes(context: RequestContext): Promise<boolean> {
  const match = /^\/api\/workspace-files\/([0-9a-f-]+)(?:\/(versions|restore|content|download))?$/i.exec(context.url.pathname);
  if (!match || !UUID.test(match[1])) return false;
  const scope = match[1], action = match[2], method = context.request.method;
  const service = createWorkspaceFilesService(context.database, context.user.id);
  if (method === 'GET' && !action) context.json(200, await service.list(scope));
  else if (method === 'GET' && action === 'versions') context.json(200, await service.versions(scope));
  else if (method === 'POST' && action === 'restore') {
    const body = await context.readJson();
    const version = optionalUuid(body.versionId, 'versionId');
    if (!version) fail(400, 'INVALID_REQUEST', 'versionId is required');
    context.json(200, await service.restore(scope, version, body.expectedRevision as number));
  } else if ((method === 'GET' || method === 'HEAD') && (action === 'content' || action === 'download')) {
    const path = string(context.url.searchParams.get('path'), 'path', 1, 1024);
    const version = optionalUuid(context.url.searchParams.get('versionId'), 'versionId');
    const { name, bytes } = await service.download(scope, path, context.storage, version);
    let range;
    try { range = method === 'GET' ? byteRange(context.request.headers.range, bytes.byteLength) : undefined; }
    catch (error) { context.response.setHeader('Content-Range', `bytes */${bytes.byteLength}`); throw error; }
    const body = range ? bytes.subarray(range.start, range.end + 1) : bytes;
    context.response.writeHead(range ? 206 : 200, {
      'Content-Type': action === 'content' ? inlineMime(name) : 'application/octet-stream',
      'Content-Length': body.byteLength,
      'Content-Disposition': action === 'content' ? 'inline' : `attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
      'Accept-Ranges': 'bytes',
      ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${bytes.byteLength}` } : {}),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'; frame-ancestors 'self'",
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    context.response.end(method === 'HEAD' ? undefined : body);
  } else return false;
  return true;
}
