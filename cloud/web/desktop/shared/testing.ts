export const targetKinds = ['web', 'microfrontend', 'h5', 'wechat-mini'] as const;
export type TargetKind = typeof targetKinds[number];
export interface TestTarget {
  id: string; name: string; repositoryId: string; kind: TargetKind;
  connector: string; environment: string; baseUrl: string; entryPath: string;
  versionUrl: string; versionField: string;
  revision: number;
  mini?: { projectPath: string; cliPath: string; appId: string };
}
export interface TestCase {
  id: string; title: string; acceptanceIds: string[]; required: boolean;
  automation: 'automated' | 'manual' | 'blocked'; file?: string;
}
export interface TestPackage {
  id: string; targetId: string; repositoryId: string; testSha: string;
  hash: string; manifestPath: string; createdAt: number;
  cases: TestCase[]; inputAssets: Array<{ id: string; hash: string }>;
}
export type CaseStatus = 'passed' | 'failed' | 'error' | 'timeout' | 'skipped' | 'blocked' | 'not_run';
export interface CaseAttempt { caseId: string; attempt: number; status: CaseStatus; durationMs: number; }
export interface TestSummary {
  schemaVersion: 1; requestId: string; packageHash: string; businessSha: string; testSha: string;
  targetId: string; environment: string; mode: 'browser' | 'mini-devtools';
  projectHashBefore?: string; projectHashAfter?: string;
  baseUrl?: string; entryUrl?: string; versionVerified?: boolean;
  versionBefore: string; versionAfter: string; exitCode: number;
  plannedCaseIds: string[]; attempts: CaseAttempt[]; cleanup: 'passed' | 'failed';
}
export interface DeploymentManifest {
  schemaVersion: 1; requestId: string; businessSha: string;
  targetId: string; environment: string; deployedSha: string;
}
export type Verdict = 'passed' | 'failed' | 'flaky' | 'incomplete' | 'invalid';
export interface TestRun {
  id: string; package: TestPackage; target: TestTarget; businessSha: string;
  sourceMessageId: string; createdAt: number; updatedAt: number;
  state: 'ready' | 'running' | 'collecting' | 'finished' | 'blocked' | 'unknown';
  verdict?: Verdict; reason?: string;
  attempts?: CaseAttempt[]; reportHash?: string;
  repositoryRoot?: string; localRequestHash?: string; outputDir?: string;
}
export interface TestingSnapshot { targets: TestTarget[]; packages: TestPackage[]; runs: TestRun[]; }
