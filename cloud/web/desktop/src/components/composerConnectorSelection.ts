export interface ConnectorSelection {
  id: string;
  kind: 'mcp' | 'managed-cli';
  displayName: string;
  icon?: string;
}
export const connectorSelectionKey = (connector: Pick<ConnectorSelection, 'id' | 'kind'>) => `${connector.kind}:${connector.id}`;
export function addConnectorSelection<T extends ConnectorSelection>(current: readonly T[], connector: T): T[] {
  const key = connectorSelectionKey(connector);
  if (current.some(item => connectorSelectionKey(item) === key)) {
    return current.map(item => connectorSelectionKey(item) === key ? connector : item);
  }
  return [...current, connector];
}
export function removeConnectorSelection<T extends ConnectorSelection>(current: readonly T[], connector: Pick<ConnectorSelection, 'id' | 'kind'>): T[] {
  return current.filter(item => connectorSelectionKey(item) !== connectorSelectionKey(connector));
}
