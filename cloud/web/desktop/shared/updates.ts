export type UpdateState = "idle" | "checking" | "available" | "downloading" | "ready" |
  "waitingForIdle" | "preparing" | "installing" | "verifying" | "recoveryRequired";
export interface UpdateConfig {
  schemaVersion: 1;
  feedUrl: string;
  channel: "stable" | "beta" | "manual-managed";
  platform: "win32" | "darwin";
  arch: "x64" | "ia32" | "arm64";
  scope: "user" | "machine";
  unsigned: true;
  eventsUrl?: string;
}
export interface Release {
  version: string;
  releaseId: string;
  url: string;
  sha512: string;
  size: number;
  unpackedSize: number;
  stagingPercentage: number;
  notes: string;
  notesUrl?: string;
}
export interface UpdateSnapshot {
  revision: number;
  state: UpdateState;
  currentVersion: string;
  targetVersion?: string;
  releaseId?: string;
  operationId?: string;
  configured: boolean;
  channel: string;
  platform: string;
  arch: string;
  installScope: string;
  installMode: "automatic" | "manual";
  progress?: { transferred: number; total: number; percent: number };
  lastCheckedAt?: string;
  blockedBy?: string[];
  releaseNotes?: string;
  error?: { code: string; message: string; retryable: boolean };
}
export interface UpdateJournal {
  schemaVersion: 1;
  attemptId: string;
  releaseId: string;
  fromVersion: string;
  toVersion: string;
  phase: "install-requested" | "verifying" | "healthy" | "install-incomplete" | "recovery-required";
  backupId: string;
  requestedAt: string;
  bootAttempts: number;
  healthyAt: string | null;
}
