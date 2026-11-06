import type { Model, ProviderStreams } from '@earendil-works/pi-ai';
import { openAICompletionsApi } from '@earendil-works/pi-ai/api/openai-completions.lazy';
import { anthropicMessagesApi } from '@earendil-works/pi-ai/api/anthropic-messages.lazy';
import { googleGenerativeAIApi } from '@earendil-works/pi-ai/api/google-generative-ai.lazy';
import { unseal } from '../infra/crypto.ts';
import type { ResourceSnapshot } from '../cloud/runs/types.ts';

const endpoints: Record<string, string> = {
  openai: 'https://api.openai.com/v1', anthropic: 'https://api.anthropic.com',
  google: 'https://generativelanguage.googleapis.com', deepseek: 'https://api.deepseek.com',
  moonshot: 'https://api.moonshot.cn/v1', qwen: 'https://dashscope.aliyuncs.com/compatible-mode/v1',
};

export function resolveCloudModel(snapshot: ResourceSnapshot, encryptionKey: string, allowedHosts?: string[]) {
  const data = snapshot.data;
  const provider = String(data.provider);
  const baseUrl = String(data.baseUrl || endpoints[provider] || '');
  const url = new URL(baseUrl);
  const allowed = new Set(allowedHosts || Object.values(endpoints).map(value => new URL(value).hostname));
  if (url.protocol !== 'https:' || url.username || url.password || !allowed.has(url.hostname) || (url.port && url.port !== '443')) {
    throw new Error('MODEL_HOST_NOT_ALLOWED: 请由管理员配置可信模型域名');
  }
  const secrets = unseal(snapshot.secret || '', encryptionKey) as { apiKey?: string };
  if (!secrets.apiKey) throw new Error('MODEL_KEY_MISSING');
  const api = provider === 'anthropic' ? 'anthropic-messages' : provider === 'google' ? 'google-generative-ai' : 'openai-completions';
  const streams: ProviderStreams = provider === 'anthropic' ? anthropicMessagesApi() : provider === 'google' ? googleGenerativeAIApi() : openAICompletionsApi();
  const model: Model<any> = {
    id: String(data.model), name: snapshot.name, provider, api, baseUrl,
    reasoning: false, input: ['text'], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
    contextWindow: 128000, maxTokens: 8192,
  };
  return { model, streams, apiKey: secrets.apiKey };
}
