import { createAttachmentService } from '../../domains/attachment/node/service.ts';
import { UUID } from '../../shared/validation.ts';
import type { RequestContext } from './routes.ts';
import { byteRange, inlineMime } from './file-content.ts';

function contentDisposition(name: string): string {
  const fallback = name.replace(/[^\x20-\x7e]/g, '_').replace(/["\\]/g, '_');
  return `attachment; filename="${fallback}"; filename*=UTF-8''${encodeURIComponent(name)}`;
}

export async function handleFileRoutes(context: RequestContext): Promise<boolean> {
  const path = context.url.pathname;
  const method = context.request.method || 'GET';
  const service = createAttachmentService({
    database: context.database, storage: context.storage, maxUploadBytes: context.config.maxUploadBytes,
  });
  if (path === '/api/files' && method === 'GET') {
    context.json(200, await service.list(context.user.id));
    return true;
  }
  if (path === '/api/files' && method === 'POST') {
    context.json(201, await service.upload(context.user.id, await context.readJson()));
    return true;
  }
  const download = path.match(/^\/api\/files\/([0-9a-f-]+)\/(download|content)$/i);
  if (download && (method === 'GET' || method === 'HEAD') && UUID.test(download[1])) {
    const { file, bytes } = await service.download(context.user.id, download[1]);
    const inline = download[2] === 'content';
    let range;
    try { range = method === 'GET' ? byteRange(context.request.headers.range, bytes.byteLength) : undefined; }
    catch (error) { context.response.setHeader('Content-Range', `bytes */${bytes.byteLength}`); throw error; }
    const body = range ? bytes.subarray(range.start, range.end + 1) : bytes;
    context.response.writeHead(range ? 206 : 200, {
      'Content-Type': inline ? inlineMime(file.name) : file.mimeType,
      'Content-Length': body.byteLength,
      'Content-Disposition': inline ? 'inline' : contentDisposition(file.name),
      'Accept-Ranges': 'bytes',
      ...(range ? { 'Content-Range': `bytes ${range.start}-${range.end}/${bytes.byteLength}` } : {}),
      'Cache-Control': 'private, no-store',
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "sandbox; default-src 'none'; frame-ancestors 'self'",
      'Cross-Origin-Resource-Policy': 'same-origin',
    });
    context.response.end(method === 'HEAD' ? undefined : body);
    return true;
  }
  const item = path.match(/^\/api\/files\/([0-9a-f-]+)$/i);
  if (item && method === 'DELETE' && UUID.test(item[1])) {
    await service.remove(context.user.id, item[1]);
    context.empty(204);
    return true;
  }
  return false;
}
