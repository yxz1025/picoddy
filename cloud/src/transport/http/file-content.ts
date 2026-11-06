import { fail } from '../../shared/errors.ts';

export function byteRange(value: string | undefined, size: number): { start: number; end: number } | undefined {
  if (value === undefined) return undefined;
  const match = /^bytes=(\d*)-(\d*)$/.exec(value);
  const invalid = () => fail(416, 'INVALID_RANGE', 'Requested byte range is not satisfiable');
  if (!match || (!match[1] && !match[2]) || size === 0) return invalid();
  let start: number;
  let end: number;
  if (!match[1]) {
    const suffix = Number(match[2]);
    if (!Number.isSafeInteger(suffix) || suffix <= 0) return invalid();
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(match[1]);
    end = match[2] ? Number(match[2]) : size - 1;
    if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start >= size || end < start) return invalid();
    end = Math.min(end, size - 1);
  }
  return { start, end };
}

/** Active formats are always inert text on the application origin. */
export function inlineMime(name: string): string {
  const extension = name.split('.').at(-1)?.toLowerCase() ?? '';
  const safe: Record<string, string> = {
    pdf: 'application/pdf', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg',
    gif: 'image/gif', webp: 'image/webp', avif: 'image/avif',
    mp4: 'video/mp4', webm: 'video/webm', ogg: 'video/ogg',
  };
  return Object.hasOwn(safe, extension) ? safe[extension] : 'text/plain; charset=utf-8';
}
