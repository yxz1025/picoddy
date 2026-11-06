import { PromptRuntimeError } from '../prompt-runtime/diagnostics.ts';
import type {
  CloudRunCategory,
  CloudRunMode,
  CloudRunPermission,
  RunSelection,
} from '../../cloud/runs/types.ts';

/** One ordered capability contract for enqueue validation and worker registration. */
export const CLOUD_TOOL_NAMES = Object.freeze([
  'read_doc', 'write_docx', 'write_xlsx', 'write_pptx', 'edit_docx', 'edit_docx_free', 'edit_xlsx', 'edit_pptx', 'browser',
  'web_search', 'fetch_content', 'get_search_content', 'source_check', 'web_fetch',
  'bash', 'read', 'write', 'edit', 'grep', 'find', 'ls', 'present_files', 'read_me', 'widget_guidelines', 'show_widget', 'memory_recall', 'memory_write', 'mcp',
  'rag_index', 'rag_query', 'rag_refresh', 'rag_status',
  'skill_draft_init', 'skill_draft_list', 'skill_draft_read', 'skill_draft_write',
  'skill_draft_import_attachment', 'skill_draft_delete', 'skill_draft_validate',
  'ask_user_question', 'goal_complete', 'subagent',
  'expert_draft_read', 'expert_draft_write', 'expert_draft_validate',
]);

export const CLOUD_READONLY_TOOL_NAMES = Object.freeze([
  'read_doc', 'read', 'grep', 'find', 'ls', 'rag_query', 'rag_status',
  'web_search', 'fetch_content', 'get_search_content', 'source_check',
  'skill_draft_list', 'skill_draft_read',
  'expert_draft_read',
  'ask_user_question', 'read_me', 'widget_guidelines', 'show_widget', 'memory_recall', 'web_fetch',
]);

export interface ResolvedCloudRuntimeProfile {
  mode: CloudRunMode;
  category: CloudRunCategory;
  permission: CloudRunPermission;
}

const CLOUD_TOOL_NAME_SET = new Set<string>(CLOUD_TOOL_NAMES);
const CLOUD_READONLY_TOOL_NAME_SET = new Set<string>(CLOUD_READONLY_TOOL_NAMES);

export function resolveCloudRuntimeProfile(
  selection: Pick<RunSelection, 'runtimeProfile' | 'permission'>,
): ResolvedCloudRuntimeProfile {
  if (!selection.runtimeProfile) throw new PromptRuntimeError('PROMPT_SOURCE_FAILED', 500, 'Stored run runtime profile is missing');
  const mode = selection.runtimeProfile.mode;
  const category = selection.runtimeProfile.category;
  const permission = selection.permission;
  if (!['ask', 'plan', 'craft'].includes(mode)) {
    throw new PromptRuntimeError('MODE_UNSUPPORTED', 500, `Stored run mode is unsupported: ${mode}`);
  }
  if (!['assistant','skill_creator','expert_creator'].includes(category)) {
    throw new PromptRuntimeError(
      'CATEGORY_UNSUPPORTED',
      500,
      `Stored run category is unsupported: ${category}`,
    );
  }
  if (permission !== 'full' && permission !== 'readonly') {
    throw new PromptRuntimeError(
      'PERMISSION_UNSUPPORTED',
      500,
      `Stored run permission is unsupported: ${permission}`,
    );
  }
  return { mode, category, permission };
}

export function resolveCloudToolPolicy(
  selection: Pick<RunSelection, 'runtimeProfile' | 'permission' | 'delegation'>,
  availableToolNames: readonly string[] = CLOUD_TOOL_NAMES,
): string[] {
  const profile = resolveCloudRuntimeProfile(selection);
  const seen = new Set<string>();
  const available = availableToolNames.filter(name => {
    if (!CLOUD_TOOL_NAME_SET.has(name)) {
      throw new PromptRuntimeError(
        'PROMPT_TOOL_UNCLASSIFIED',
        500,
        `Unclassified cloud tool: ${name}`,
      );
    }
    if (seen.has(name)) return false;
    seen.add(name);
    if (selection.delegation && (!selection.delegation.allowedToolNames.includes(name) || ['subagent','goal_complete','ask_user_question'].includes(name) || name.includes('_draft_'))) return false;
    if (profile.category === 'skill_creator') return name.startsWith('skill_draft_') || ['read_doc','read','grep','find','ls','ask_user_question'].includes(name);
    if (profile.category === 'expert_creator') return name.startsWith('expert_draft_') || ['read_doc','read','grep','find','ls','ask_user_question'].includes(name);
    if (name.startsWith('expert_draft_')) return false;
    if (name.startsWith('skill_draft_')) return false;
    return true;
  });
  if (profile.mode === 'ask') return [];
  if (profile.mode === 'plan' || profile.permission === 'readonly') {
    return available.filter(name => CLOUD_READONLY_TOOL_NAME_SET.has(name));
  }
  return available;
}

export function filterCloudToolsByPolicy<T extends { name: string }>(
  tools: readonly T[],
  selection: Pick<RunSelection, 'runtimeProfile' | 'permission' | 'delegation'>,
): T[] {
  const allowed = new Set(resolveCloudToolPolicy(selection, tools.map(tool => tool.name)));
  return tools.filter(tool => allowed.has(tool.name));
}
