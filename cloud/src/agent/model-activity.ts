interface ModelEvent {
  type: string;
  message?: { role: string };
  assistantMessageEvent?: { type: string; delta?: string };
}
type Phase = 'waiting' | 'thinking' | 'tool_input' | 'idle';

/** Report real provider activity, never partial tool arguments or reasoning contents. */
export function createModelActivity(now = Date.now) {
  let phase: Phase = 'idle';
  let characters = 0;
  let lastEmitted = -Infinity;
  return (event: ModelEvent): { phase: Phase; message: string; characters: number } | null => {
    const update = event.assistantMessageEvent;
    let next: Phase;
    if (event.type === 'message_start' && event.message?.role === 'assistant') next = 'waiting';
    else if (event.type === 'message_update' && update?.type.startsWith('thinking_')) next = 'thinking';
    else if (event.type === 'message_update' && update?.type.startsWith('toolcall_')) next = 'tool_input';
    else if (event.type === 'message_end' || event.type === 'tool_execution_start' || (event.type === 'message_update' && update?.type.startsWith('text_'))) next = 'idle';
    else return null;
    const changed = next !== phase;
    if (changed || update?.type === 'toolcall_start') characters = 0;
    phase = next;
    if (update?.type.endsWith('_delta')) characters += update.delta?.length ?? 0;
    if (!changed && (phase === 'idle' || now() - lastEmitted < 1000)) return null;
    lastEmitted = now();
    const message = phase === 'waiting' ? '等待模型响应' : phase === 'thinking' ? '模型正在思考' : phase === 'tool_input' ? `正在生成操作内容（已生成 ${characters} 字符）` : '';
    return { phase, message, characters };
  };
}
