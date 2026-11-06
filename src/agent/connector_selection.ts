export type PreferredConnectorKind = "mcp" | "managed-cli";

export interface PreferredConnectorSelection {
  readonly id: string;
  readonly kind: PreferredConnectorKind;
}

/** Parse an explicit renderer selection. Never guess connector type from its name. */
export function parsePreferredConnectorSelection(
  connector: unknown,
  kind: unknown,
): PreferredConnectorSelection | undefined {
  const id = typeof connector === "string" ? connector.trim() : "";
  if (!id) return undefined;
  if (kind !== "mcp" && kind !== "managed-cli") {
    throw new Error("preferredConnectorKind must be mcp or managed-cli");
  }
  return Object.freeze({ id, kind });
}

/** The array is authoritative, including an explicit empty selection. */
export function parsePreferredConnectorSelections(
  selections: unknown,
  legacyConnector?: unknown,
  legacyKind?: unknown,
): PreferredConnectorSelection[] {
  if (selections === undefined) {
    const legacy = parsePreferredConnectorSelection(legacyConnector, legacyKind);
    return legacy ? [legacy] : [];
  }
  if (!Array.isArray(selections)) throw new Error('preferredConnectors must be an array');
  const unique = new Map<string, PreferredConnectorSelection>();
  for (const value of selections) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('Invalid connector selection');
    const selection = parsePreferredConnectorSelection(value.id, value.kind);
    if (!selection) throw new Error('Connector id must be a non-empty string');
    unique.set(`${selection.kind}:${selection.id}`, selection);
  }
  return [...unique.values()];
}

export async function loadPreferredConnectorResources<T>(
  selections: readonly PreferredConnectorSelection[],
  loadMcpTools: (id: string) => Promise<T[]>,
  displayNameFor?: (selection: PreferredConnectorSelection) => string | undefined,
) {
  const mcpTools = (await Promise.all(selections
    .filter(selection => selection.kind === 'mcp')
    .map(selection => loadMcpTools(selection.id)))).flat();
  // Include MCP identity as well as CLI identity; tools are passed to the runtime separately.
  const connectorContext = selections.map(selection => ({
    connectorId: selection.id,
    title: displayNameFor?.(selection) || selection.id,
    content: selection.kind === 'mcp'
      ? '用户在聊天框中为本轮明确选择了此 MCP 连接器。可执行操作以当前实际可用的工具为准；选中不代表已查询或修改远端数据。'
      : '用户在聊天框中为本轮明确选择了此受管 CLI 连接器，可按需使用其工具。',
  }));
  return { mcpTools, connectorContext };
}
