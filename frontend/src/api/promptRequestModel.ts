export interface PromptRequest {
  sessionId?: string;
  text?: string;
  mode?: string;
  permission?: string;
  modelProvider?: string;
  modelId?: string;
  attachmentIds?: string[];
  attachments?: unknown[];
  preferredConnectors?: { id: string; kind: "mcp" | "managed-cli" }[];
  preferredConnector?: string;
  preferredConnectorKind?: "mcp" | "managed-cli";
  displayText?: string;
  attachmentAnchors?: Record<string, number>;
  selectedSkillNames?: string[];
  selectedExpertId?: string;
  testingPublishField?: string;
}

export function mapPromptRequestToSessionContinue(
  request: PromptRequest,
): PromptRequest {
  const modelProvider = request.modelProvider?.trim();
  const modelId = request.modelId?.trim();
  const hasCompleteModel = Boolean(modelProvider && modelId);
  return {
    sessionId: request.sessionId,
    text: request.text,
    mode: request.mode,
    permission: request.permission,
    modelProvider: hasCompleteModel ? modelProvider : undefined,
    modelId: hasCompleteModel ? modelId : undefined,
    attachmentIds: request.attachmentIds,
    attachments: request.attachments,
    ...(request.preferredConnectors !== undefined ? { preferredConnectors: request.preferredConnectors } : {}),
    preferredConnector: request.preferredConnector,
    preferredConnectorKind: request.preferredConnectorKind,
    displayText: request.displayText,
    attachmentAnchors: request.attachmentAnchors,
    selectedSkillNames: request.selectedSkillNames,
    selectedExpertId: request.selectedExpertId,
    ...(request.testingPublishField ? { testingPublishField: request.testingPublishField } : {}),
  };
}
