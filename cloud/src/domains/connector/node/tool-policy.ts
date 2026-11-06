export function isMcpToolVisible(data: Record<string, unknown>, name: string): boolean {
  const overrides = data.toolExposure;
  const value = overrides && typeof overrides === 'object' && Object.hasOwn(overrides, name)
    ? (overrides as Record<string, unknown>)[name] : data.exposure ?? 'direct';
  return ['direct', 'deferred', 'codemode'].includes(String(value));
}
