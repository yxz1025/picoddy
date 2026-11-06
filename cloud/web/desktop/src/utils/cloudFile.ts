/** Only platform-issued file identifiers may become authenticated download URLs. */
export function cloudFileUrl(path: string): string | null {
  const match = /^\/cloud-files\/([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})(?:\/[^/]*)?$/i.exec(path);
  return match ? `/api/files/${match[1]}/download` : null;
}
