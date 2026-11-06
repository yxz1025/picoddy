export class ChannelModelConfigurationError extends Error {}
interface Selection { provider: string; modelId: string }
/** Channels have no interactive model picker. Never invent a provider when no model is selected. */
export function selectChannelModel(current: Selection, defaults: Selection): Selection {
  for (const selection of [current, defaults]) {
    if (selection.provider.trim() && selection.modelId.trim()) return { provider: selection.provider.trim(), modelId: selection.modelId.trim() };
  }
  throw new ChannelModelConfigurationError('机器人尚未选择模型。请在电脑端「设置 → 模型」设置默认模型，或打开对应的钉钉任务选择模型，然后重新 @机器人。');
}
