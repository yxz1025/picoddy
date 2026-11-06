import { cloudFileUrl } from '../utils/cloudFile';

/** Resolve platform file handles; cloud widgets never read desktop filesystem paths. */
export function cloudWidgetImageUrl(source: string, origin: string): string | null {
  const fileUrl = cloudFileUrl(source);
  if (fileUrl) return `${origin}${fileUrl.replace(/\/download$/, '/content')}`;
  try {
    const url = new URL(source, origin);
    if (url.origin !== origin || url.username || url.password) return null;
    if (!/^\/api\/files\/[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\/(content|download)$/i.test(url.pathname)) return null;
    url.pathname = url.pathname.replace(/\/download$/, '/content');
    return url.href;
  } catch { return null; }
}
