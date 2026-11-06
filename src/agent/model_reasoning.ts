import type { Model } from '@earendil-works/pi-ai';
import { QWEN_TOKEN_PLAN_MODELS } from '@earendil-works/pi-ai/providers/qwen-token-plan.models';

/** Reuse Pi's exact model contract, including levels that cannot be disabled.
 * Never infer a private gateway's protocol from a model name alone. */
export function resolveModelReasoning(provider: string, id: string, baseUrl: string):
  Pick<Model<'openai-completions'>, 'reasoning' | 'compat' | 'thinkingLevelMap'> {
  let host: string;
  try { host = new URL(baseUrl).hostname; } catch { return { reasoning: false }; }
  const officialQwen = provider === 'qwen' && (
    host === 'dashscope.aliyuncs.com' || host === 'dashscope-intl.aliyuncs.com' ||
    host === 'token-plan.ap-southeast-1.maas.aliyuncs.com' || host === 'coding.dashscope.aliyuncs.com'
  );
  if (!officialQwen) return { reasoning: false };
  const native = Object.values(QWEN_TOKEN_PLAN_MODELS).find(model => model.id === id);
  if (!native) return { reasoning: false };
  return {
    reasoning: native.reasoning,
    compat: native.compat,
    thinkingLevelMap: native.thinkingLevelMap,
  };
}
