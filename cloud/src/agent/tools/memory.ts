import { Type } from 'typebox';
import type { AgentTool } from '@earendil-works/pi-agent-core';
import type { Database } from '../../infra/db.ts';
import type { Run } from '../../cloud/runs/types.ts';
import { assertLease } from '../../cloud/runs/events.ts';
import { createMemoryRuntimeService } from '../../domains/memory/node/runtime.ts';

export function createMemoryTools(database: Database, run: Run): AgentTool<any>[] {
  const service = createMemoryRuntimeService(database, run);
  return [
    { name: 'memory_recall', label: '回忆', description: '召回当前用户适用的记忆：user 长期记忆；working 当前会话工作记忆；all 两者。',
      parameters: Type.Object({ scope: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('working'), Type.Literal('all')])) }),
      async execute(_id, input, signal) {
        signal?.throwIfAborted(); await assertLease(run);
        const rows = await service.recall((input as {scope?: unknown}).scope);
        return { content: [{ type: 'text', text: rows.length ? rows.map(row => `- [${row.data.kind ?? 'fact'}] ${row.data.content}`).join('\n') : '(暂无记忆)' }], details: { count: rows.length } };
      } },
    { name: 'memory_write', label: '记住', description: '写入用户要求记住的事实/偏好，user 为当前用户的长期记忆，working 只属于当前会话。',
      parameters: Type.Object({ content: Type.String({ minLength: 1, maxLength: 16000 }), kind: Type.Optional(Type.String({ maxLength: 64 })), scope: Type.Optional(Type.Union([Type.Literal('user'), Type.Literal('working')])) }),
      async execute(_id, input, signal) {
        signal?.throwIfAborted(); const memory = await service.write(input);
        return { content: [{ type: 'text', text: `✓ 已记住: ${memory.content}` }], details: { id: memory.id } };
      } },
  ];
}
