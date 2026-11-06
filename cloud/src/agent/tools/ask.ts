import { Type } from 'typebox';
import { setTimeout as delay } from 'node:timers/promises';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Run } from '../../cloud/runs/types.ts';
import type { Database } from '../../infra/db.ts';
import { createQuestionService } from '../../domains/interaction/node/questions.ts';

export function createAskTool(run: Run, database: Database): AgentTool<any> {
  const service = createQuestionService(database);
  return {
    name: 'ask_user_question', label: '向用户提问',
    description: 'Ask 1-4 clarification questions with 2-4 options each and free-text answers. Waits up to five minutes. Answers are not permission approvals. Unattended automation cannot use this tool.',
    parameters: Type.Object({ questions: Type.Array(Type.Object({ question: Type.String({ minLength: 1, maxLength: 2000 }),
      header: Type.Optional(Type.String({ maxLength: 120 })), multiSelect: Type.Optional(Type.Boolean()),
      options: Type.Array(Type.Object({ label: Type.String({ minLength: 1, maxLength: 120 }), description: Type.Optional(Type.String({ maxLength: 500 })) }), { minItems: 2, maxItems: 4 }),
    }), { minItems: 1, maxItems: 4 }) }),
    async execute(id, input, signal) {
      signal?.throwIfAborted();
      const question = await service.open(run, id, (input as { questions: unknown }).questions);
      try {
        while (true) {
          signal?.throwIfAborted();
          const answers = await service.poll(run, question.id);
          if (answers !== undefined) return { content: [{ type: 'text', text: JSON.stringify({ answers }) }], details: { answers } };
          await delay(500, undefined, { signal });
        }
      } finally { await service.close(run, question.id); }
    },
  };
}
