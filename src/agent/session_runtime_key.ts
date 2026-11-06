import { createHash } from 'node:crypto';
import { canonicalJson } from './prompt-runtime/manifest.ts';
import type { PromptEnvelope } from './prompt-runtime/types.ts';

/** Only initialization inputs belong here; messages and dynamic prompt data do not. */
export function sessionRuntimeKey(envelope: PromptEnvelope, cwd: string, model: string, contextPolicy?: string): string {
  return createHash('sha256').update(canonicalJson({
    cwd, model, contextPolicy: contextPolicy ?? 'default',
    route: envelope.manifest.route,
    expertRevision: envelope.manifest.sources?.filter(source => source.id === "expert"),
    permission: envelope.permissionPolicy,
    resources: envelope.resources,
    tools: envelope.tools.map(tool => ({ name: tool.name, description: tool.description, parameters: tool.parameters })),
    activeTools: envelope.activeToolNames,
  })).digest('hex');
}
