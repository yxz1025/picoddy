import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';

import type { Run } from '../../cloud/runs/types.ts';
import type { Database } from '../../infra/db.ts';
import { createExpertDraftAgentService } from '../../domains/expert-draft/node/service.ts';
import { fail } from '../../shared/errors.ts';

const empty = Type.Object({}, { additionalProperties: false });
const profile = Type.Object({
  name: Type.String({ minLength: 1, maxLength: 200 }),
  prompt: Type.String({ minLength: 1, maxLength: 100_000 }),
  skillIds: Type.Array(Type.String({ format: 'uuid' }), { maxItems: 64, uniqueItems: true }),
  description: Type.String({ maxLength: 2_000 }),
  tags: Type.Array(Type.String({ minLength: 1, maxLength: 64 }), { maxItems: 20, uniqueItems: true }),
  quickPrompts: Type.Array(Type.String({ minLength: 1, maxLength: 500 }), { maxItems: 20, uniqueItems: true }),
  icon: Type.String({ maxLength: 2_048 }),
  categoryId: Type.String({ minLength: 1, maxLength: 100 }),
}, { additionalProperties: false });
const write = Type.Object({
  expectedRevision: Type.Integer({ minimum: 0 }),
  profile,
}, { additionalProperties: false });

export function createExpertDraftTools(run: Run, database: Database): AgentTool<any>[] {
  const service = createExpertDraftAgentService(database, run);
  function tool(
    name: 'read' | 'write' | 'validate',
    parameters: any,
    description: string,
    operation: (draft: Awaited<ReturnType<typeof service.current>>, input: any) => Promise<unknown>,
  ): AgentTool<any> {
    return {
      name: `expert_draft_${name}`,
      label: `专家草稿 ${name}`,
      description,
      parameters,
      async execute(_id, input, signal) {
        signal?.throwIfAborted();
        if (String(run.selection.runtimeProfile?.category) !== 'expert_creator') {
          fail(403, 'INVALID_CATEGORY', 'Draft tools require expert_creator');
        }
        const draft = await service.current();
        const details = await operation(draft, input);
        return { content: [{ type: 'text' as const, text: JSON.stringify(details) }], details };
      },
    };
  }
  return [
    tool(
      'read',
      empty,
      'Read the complete owner-private expert draft profile and current revision for this conversation.',
      draft => service.read(draft.id),
    ),
    tool(
      'write',
      write,
      'Replace the complete expert draft profile at an expected revision. This invalidates validation and never publishes.',
      (draft, input) => service.write(draft.id, input.profile, input.expectedRevision),
    ),
    tool(
      'validate',
      empty,
      'Validate the complete expert draft profile, prompt budget, and owned skill references. Publication remains an explicit user action.',
      draft => service.validate(draft.id),
    ),
  ];
}

