import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { createCompletionService } from '../../domains/interaction/node/completion.ts';

export function createGoalTool(service: ReturnType<typeof createCompletionService>): AgentTool<any> {
  return { name: 'goal_complete', label: '目标完成校验', executionMode: 'sequential',
    description: 'Declare completion alone, never in a mixed tool batch. Success requires evidence and re-verifies the latest delivered files. Accepted declarations freeze business tools. Plain answers need no declaration or file. Waiting for user is not success.',
    parameters: Type.Object({ success: Type.Boolean(), summary: Type.String({ minLength: 1, maxLength: 8000 }), proof: Type.String({ minLength: 1, maxLength: 8000 }),
      status: Type.Optional(Type.Union([Type.Literal('completed'), Type.Literal('waiting_for_user')])) }),
    async execute(id, input, signal) {
      const details = await service.declare(id, input, signal);
      return { terminate: true, content: [{ type: 'text', text: JSON.stringify({ ...details, message: 'Declaration accepted. Business tools are frozen. Explain the verified outcome; do not claim more than the evidence.' }) }], details };
    },
  };
}
