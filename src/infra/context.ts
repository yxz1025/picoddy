import { AsyncLocalStorage } from "node:async_hooks";
import type { AgentTool } from "@earendil-works/pi-agent-core";

export interface DelegatedAttachmentContext {
  id?: string;
  name: string;
  path?: string;
  mimeType?: string;
  extension?: string;
  size?: number;
  content?: string;
  localExtraction?: {
    kind: "json_fields";
    fields: Array<{
      name: string;
      valueCount: number;
      uniqueValueCount: number;
      values: Array<string | number | boolean | null>;
      truncated: boolean;
    }>;
  };
  contentUnavailableReason?: "binary_asset" | "large_text";
}

export interface ConnectorSessionContext {
  connectorId: string;
  cliVersion: string;
  binPath: string;
  versionRoot: string;
  cwd?: string;
}

export interface SessionContext {
  sessionId: string;
  turnId?: string;
  permission?: "L1" | "L2" | "L3" | "readonly" | "default" | "full";
  activeToolNames?: readonly string[];
  selectedMcpTools?: readonly AgentTool[];
  delegationDepth?: number;
  attachments?: readonly DelegatedAttachmentContext[];
  activeSkillName?: string;
  /** Submit a declaration; only the coordinator accepts it and closes execution. */
  declareTaskCompletion?: (declaration: TaskCompletionDeclaration) => Promise<void>;
  /** Applies the same file contract during presentation and final acceptance. */
  verifyArtifactForDelivery?: (path: string, signal?: AbortSignal) => Promise<{
    path: string; extension: string; digest: string; bytes: number;
  }>;
  /** 当前会话绑定的受管连接器（隐藏 connector child 会话）。 */
  connector?: ConnectorSessionContext;
}

export interface TaskCompletionDeclaration {
  success: boolean;
  summary: string;
  proof: string;
  status?: "completed" | "waiting_for_user";
}

export const sessionContext = new AsyncLocalStorage<SessionContext>();
