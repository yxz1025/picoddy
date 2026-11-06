import type { McpServerConfig, McpConnectionInfo } from '../../store/useSkillStore';
import type { ConnectorSelection } from '../composerConnectorSelection';

export function figmaConnectorCandidates(config: Record<string, McpServerConfig>, connected: McpConnectionInfo[], bound: string[] = []) {
  return Object.entries(config).filter(([id, entry]) => {
    if (entry.disabled || entry.enabled === false) return false;
    if (bound.includes(id) || /figma/i.test(`${id} ${entry.displayName || ''}`)) return true;
    try {
      const url = new URL(entry.url || '');
      if (url.hostname === 'mcp.figma.com' || (['localhost', '127.0.0.1', '[::1]'].includes(url.hostname) && url.port === '3845')) return true;
    } catch { /* Stdio connectors have no URL. */ }
    return connected.some(c => c.name === id && c.tools.some(t => /(^|_)get_design_context$/.test(t)));
  }).map(([id, entry]) => ({ id, displayName: entry.displayName || id }));
}

export function chooseFigmaConnector(candidates: { id: string }[], bound: string[], selected: ConnectorSelection[]) {
  const bindings = [...new Set(bound.filter(Boolean))];
  // A missing/disabled explicit binding must not silently switch to another design source.
  if (bindings.length) return bindings.length === 1 && candidates.some(c => c.id === bindings[0]) ? bindings[0] : '';
  const choices = selected.filter(s => s.kind === 'mcp' && candidates.some(c => c.id === s.id));
  if (choices.length) return choices.length === 1 ? choices[0].id : '';
  return candidates.length === 1 ? candidates[0].id : '';
}
