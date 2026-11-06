import type { AgentSessionEvent } from '@earendil-works/pi-coding-agent';
import { operationLogger, type OperationHandle, type OperationLogger } from '../infra/operation_log.ts';
import { sessionContext } from '../infra/context.ts';

/** Content-free timings. Concurrent tool intervals are deliberately not summed. */
export function createRuntimeMetrics(sessionId: string, logger: OperationLogger = operationLogger) {
  let request: { operation: OperationHandle; start: number; firstContentMs?: number } | undefined;
  let run: OperationHandle | undefined;
  let compact: OperationHandle | undefined;
  let sequence = 0;
  const tools = new Map<string, OperationHandle>();
  const identity = () => ({ sessionId, turnId: sessionContext.getStore()?.turnId });
  const finish = (status: string) => {
    if (!request) return;
    request.operation.success({ ...identity(), status, firstContentMs: request.firstContentMs });
    request = undefined;
  };
  return {
    request(payload: unknown) {
      finish('superseded');
      const value = payload && typeof payload === 'object' ? payload as Record<string, unknown> : {};
      request = { start: performance.now(), operation: logger.start('agent.model.request', {
        ...identity(), sequence: ++sequence,
        model: typeof value.model === 'string' ? value.model : undefined,
        enableThinking: typeof value.enable_thinking === 'boolean' ? value.enable_thinking : undefined,
        reasoningEffort: typeof value.reasoning_effort === 'string' ? value.reasoning_effort : undefined,
      }) };
    },
    event(event: AgentSessionEvent) {
      if (event.type === 'agent_start') run = logger.start('agent.run', identity());
      if (event.type === 'message_update' && request && request.firstContentMs === undefined &&
          ['text_delta', 'thinking_delta', 'toolcall_delta'].includes(event.assistantMessageEvent.type)) {
        request.firstContentMs = performance.now() - request.start;
      }
      if (event.type === 'message_end' && event.message.role === 'assistant' && request) {
        const message = event.message;
        const usage = message.usage;
        const metadata = { ...identity(), status: message.stopReason,
          firstContentMs: request.firstContentMs, inputTokens: usage.input, outputTokens: usage.output,
          cacheReadTokens: usage.cacheRead, cacheWriteTokens: usage.cacheWrite,
          reasoningTokens: usage.reasoning,
        };
        if (message.stopReason === 'error' || message.stopReason === 'aborted') request.operation.error(new Error(`Model request ${message.stopReason}`), metadata);
        else request.operation.success(metadata);
        request = undefined;
      }
      if (event.type === 'tool_execution_start') tools.set(event.toolCallId, logger.start('agent.tool', { ...identity(), tool: event.toolName, toolCallId: event.toolCallId }));
      if (event.type === 'tool_execution_end') {
        const operation = tools.get(event.toolCallId);
        if (event.isError) operation?.error(new Error('Tool execution failed'), identity());
        else operation?.success(identity());
        tools.delete(event.toolCallId);
      }
      if (event.type === 'compaction_start') compact = logger.start('agent.compaction', { ...identity(), reason: event.reason });
      if (event.type === 'compaction_end') {
        const metadata = { ...identity(), reason: event.reason, aborted: event.aborted, willRetry: event.willRetry };
        if (event.errorMessage || event.aborted) compact?.error(new Error('Compaction did not complete'), metadata);
        else compact?.success(metadata);
        compact = undefined;
      }
      if (event.type === 'auto_retry_start') {
        logger.event('agent.retry', 'event', { ...identity(), phase: event.type, attempt: event.attempt, maxAttempts: event.maxAttempts, delayMs: event.delayMs });
      }
      if (event.type === 'auto_retry_end') {
        logger.event('agent.retry', 'event', { ...identity(), phase: event.type, attempt: event.attempt, success: event.success });
      }
      if (event.type === 'agent_end') {
        finish('agent_end');
        for (const operation of tools.values()) operation.success({ ...identity(), status: 'interrupted' });
        tools.clear();
        run?.success(identity()); run = undefined;
      }
    },
  };
}
