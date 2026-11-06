export interface PreviewCommand { file: string; args: string[] }
export interface PreviewScenario { id: string; name: string; entryPath: string; module: string }
export interface PreviewWorkspace { path: string; branch: string; baseCommit: string }
export interface PreviewTarget {
  id: string; revision: number; stageKey: string; name: string; repositoryId: string;
  kind: 'web' | 'wechat-mini'; projectPath: string;
  build?: PreviewCommand; start?: PreviewCommand;
  webUrl: string; viewport: { width: number; height: number };
  cliPath: string; miniProjectPath: string; entryPath: string; design: { url: string; version: string; server?: string };
  scenarios: PreviewScenario[]; workspace?: PreviewWorkspace;
}
export type PreviewState = 'starting' | 'ready' | 'stopping' | 'stopped' | 'failed' | 'interrupted';
export interface PreviewRun {
  deliveryId?: string; changedSinceDelivery?: boolean;
  id: string; target: PreviewTarget; scenarioId: string; state: PreviewState;
  createdAt: number; updatedAt: number; commit: string; dirty: boolean;
  assetRefs: Array<{ id: string; hash: string }>; outputDir: string;
  message: string; logs: string[];
}
export interface PreviewDelivery {
  id: string; target: PreviewTarget; conversationId: string; sourceMessageId: string; createdAt: number;
  summary: string; pending: string; commit: string; dirty: boolean;
  files: Array<{ path: string; hash: string; change: 'added' | 'modified' | 'unchanged' }>;
  assetRefs: Array<{ id: string; hash: string }>; designReadIds: string[]; recordAssetId: string;
}
export interface PreviewSnapshot { targets: PreviewTarget[]; runs: PreviewRun[]; deliveries: PreviewDelivery[] }
export const activePreviewStates: PreviewState[] = ['starting', 'ready', 'stopping'];
