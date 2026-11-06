// src/agent/interactive.ts
// 交互式提问/回答挂起表（对标 main.ts 的 pendingConfirms）。
// 与 tool_confirmation 的区别：支持多题、多选、自由输入；
// 用户作答后答案作为工具结果（tool_result）回灌模型。

export interface PendingAsk {
  resolve: (answers: unknown) => void;
  timer: number;
}

const pendingAnswers = new Map<string, PendingAsk>();

/**
 * 注册一个挂起的提问，返回等待用户作答的 Promise。
 * @param requestId 唯一请求 ID
 * @param timeoutMs 超时（默认 120s），超时后自动 resolve(null)
 */
export function registerPendingAnswer(requestId: string, timeoutMs = 120000): Promise<unknown> {
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      if (pendingAnswers.has(requestId)) {
        pendingAnswers.delete(requestId);
        console.warn(`[ask] 提问 ${requestId} 超时未应答`);
        resolve(null);
      }
    }, timeoutMs) as unknown as number;

    pendingAnswers.set(requestId, {
      resolve: (answers: unknown) => {
        clearTimeout(timer);
        resolve(answers);
      },
      timer,
    });
  });
}

/** 用户作答后由 /api/ask-answer 调用，解除挂起。返回是否成功（requestId 有效） */
export function resolvePendingAnswer(requestId: string, answers: unknown): boolean {
  const p = pendingAnswers.get(requestId);
  if (!p) return false;
  pendingAnswers.delete(requestId);
  p.resolve(answers);
  return true;
}

/** 该 requestId 是否仍在等待（用于事件队列去重：已应答的不重发） */
export function isPendingAnswer(requestId: string): boolean {
  return pendingAnswers.has(requestId);
}
