/** Metadata only. File bodies are retrieved through the native tools on demand. */
export interface RequirementAssetManifest {
  schemaVersion: 1;
  scope: { requirementId: string; workspaceId: string; stage: string };
  assets: Array<{
    id: string; hash: string; path: string; name: string; workingPath: string;
    stage: number; bytes: number; format: 'text' | 'binary';
  }>;
}
export const ASSET_CONTEXT_OPEN = '<requirement_assets encoding="json">';
export const ASSET_CONTEXT_CLOSE = '</requirement_assets>';
export function encodeAssetContext(value: unknown): string {
  return JSON.stringify(value).replaceAll('&', '\\u0026').replaceAll('<', '\\u003c').replaceAll('>', '\\u003e');
}
export function renderAssetManifest(value: { schemaVersion: 1; scope: RequirementAssetManifest['scope']; assets: object[] }): string {
  return `${ASSET_CONTEXT_OPEN}${encodeAssetContext(value)}${ASSET_CONTEXT_CLOSE}`;
}
