// Cloud capability activation mirrors the desktop catalog shape while naming
// only tools that are actually registered by the cloud runtime.
import type { CloudPromptContextSnapshot } from './types.ts';

interface CloudCapabilityPack {
  path: string;
  anyTools: readonly string[];
}

const TOOL_PACKS: readonly CloudCapabilityPack[] = [
  { path: 'capabilities/file-read.md', anyTools: ['read', 'grep', 'find', 'ls'] },
  { path: 'capabilities/file-mutation.md', anyTools: ['write', 'edit'] },
  { path: 'capabilities/shell.md', anyTools: ['bash'] },
  {
    path: 'capabilities/document-processing.md',
    anyTools: ['read_doc', 'write_docx', 'write_xlsx', 'write_pptx', 'edit_docx', 'edit_docx_free', 'edit_xlsx', 'edit_pptx'],
  },
  { path: 'capabilities/browser-control.md', anyTools: ['browser'] },
  { path: 'capabilities/web-access.md', anyTools: ['web_search', 'fetch_content', 'get_search_content', 'source_check', 'web_fetch'] },
  {
    path: 'capabilities/knowledge-retrieval.md',
    anyTools: ['rag_index', 'rag_query', 'rag_refresh', 'rag_status'],
  },
  { path: 'capabilities/visualization.md', anyTools: ['read_me', 'widget_guidelines', 'show_widget'] },
  { path: 'capabilities/memory-tools.md', anyTools: ['memory_recall', 'memory_write'] },
  { path: 'capabilities/artifact-delivery.md', anyTools: ['present_files'] },
  { path: 'capabilities/mcp.md', anyTools: ['mcp'] },
  { path: 'capabilities/completion.md', anyTools: ['goal_complete'] },
  { path: 'capabilities/delegation.md', anyTools: ['subagent'] },
];

export function resolveCloudCapabilityPromptPaths(
  snapshot: CloudPromptContextSnapshot,
): string[] {
  const active = new Set(snapshot.capabilities.activeToolNames);
  const paths = TOOL_PACKS
    .filter(pack => pack.anyTools.some(name => active.has(name)))
    .map(pack => pack.path);
  if (snapshot.skills.skills.length > 0 && active.has('read')) {
    paths.push('capabilities/skills.md');
  }
  return paths;
}
