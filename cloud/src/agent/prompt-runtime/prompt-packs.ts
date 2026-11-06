import { fileURLToPath } from "node:url";
import { ResourceCache } from "../resource-cache.ts";
// Independent cloud copy of the desktop v2 pack selection contract.
// Mode and capability fragments follow the frozen profile and exact registered tools.
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PromptRuntimeError } from './diagnostics.ts';
import { assertPromptByteBudget, composePromptParts, PROMPT_BYTE_BUDGETS } from './prompt-budget.ts';
import type { CloudPromptContextSnapshot } from './types.ts';
import { resolveCloudCapabilityPromptPaths } from './capability-catalog.ts';

export interface CloudPromptFragment {
  path: string;
  content: string;
  contentHash: string;
  bytes: number;
}

const CORE = [
  'core/product-identity.md', 'core/instruction-priority.md',
  'core/communication.md', 'core/file-safety.md', 'core/tool-use.md',
  'core/agent-loop.md', 'core/error-recovery.md',
] as const;
const fragmentCache = new ResourceCache<string>();
const ROOT = new URL('../../../resources/prompts/v2/', import.meta.url);

export function loadCloudPromptFragments(snapshot: CloudPromptContextSnapshot): CloudPromptFragment[] {
  // Paths are compile-time registry values, never user/model supplied.
  const paths = [
    ...CORE,
    ...(snapshot.memory.entries.length ? ['context/memory.md'] : []),
    snapshot.runtimeProfile.category === 'expert_creator' ? 'categories/expert-creator.md' : snapshot.runtimeProfile.category === 'skill_creator' ? 'categories/skill-creator.md' : 'categories/assistant.md', `modes/${snapshot.runtimeProfile.mode}.md`,
    ...resolveCloudCapabilityPromptPaths(snapshot),
    'core/result-presentation.md',
  ];
  const fragments = paths.map(path => {
    let content: string;
    try {
      const file = fileURLToPath(new URL(path, ROOT));
      content = fragmentCache.get([file], () => readFileSync(file, 'utf8').trim());
    } catch (cause) {
      throw new PromptRuntimeError('PROMPT_FRAGMENT_INVALID', 500, `Required prompt fragment unavailable: ${path}`, { cause });
    }
    if (!content || /\{\{[\s\S]*?\}\}/u.test(content)) {
      throw new PromptRuntimeError('PROMPT_FRAGMENT_INVALID', 500, `Invalid prompt fragment: ${path}`);
    }
    assertPromptByteBudget(path, content, PROMPT_BYTE_BUDGETS.fragmentBytes);
    return { path, content, contentHash: createHash('sha256').update(content).digest('hex'), bytes: Buffer.byteLength(content, 'utf8') };
  });
  assertPromptByteBudget('desktop core fragments', composePromptParts(fragments.filter(item => item.path.startsWith('core/')).map(item => item.content)), PROMPT_BYTE_BUDGETS.coreBytes);
  return fragments;
}
