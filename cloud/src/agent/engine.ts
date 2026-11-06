import type { AgentMessage, AgentTool } from '@earendil-works/pi-agent-core';
import { InMemoryCredentialStore, InMemoryModelsStore, type Model } from '@earendil-works/pi-ai';
import {
  createAgentSession, createExtensionRuntime, createSyntheticSourceInfo, ModelRuntime, SessionManager, SettingsManager,
  type ResourceLoader, type FileEntry,
} from '@earendil-works/pi-coding-agent';

/** Desktop src/agent/engine.ts lifecycle, with explicit cloud-owned resources.
 * No DefaultResourceLoader, filesystem sessions, local tools or user extensions.
 */
export async function createCloudSession(input: {
  sessionId: string;
  systemPrompt: string;
  messages: AgentMessage[];
  entries?: FileEntry[];
  model: Model<any>;
  apiKey: string;
  tools: AgentTool<any>[];
  beforeTool?: () => Promise<void>;
}) {
  const cwd = '/workspace';
  const manager = SessionManager.inMemory(cwd, { id: input.sessionId }, input.entries);
  for (const message of input.messages) {
    if (['user', 'assistant', 'toolResult', 'system'].includes(message.role)) {
      manager.appendMessage(message as Parameters<SessionManager['appendMessage']>[0]);
    } else throw new Error('UNSUPPORTED_TRANSCRIPT_ROLE');
  }
  const credentials = new InMemoryCredentialStore();
  // A secret is a literal value, never SDK models.json's executable config syntax.
  await credentials.modify(input.model.provider, async () => ({ type: 'api_key', key: input.apiKey }));
  const runtime = await ModelRuntime.create({
    credentials, modelsStore: new InMemoryModelsStore(), modelsPath: null,
    refreshOnCreate: false, allowModelNetwork: false,
  });
  runtime.registerProvider(input.model.provider, {
    api: input.model.api, baseUrl: input.model.baseUrl, models: [input.model],
  });
  const extensionRuntime = createExtensionRuntime();
  // Trusted application hook, not a user plugin. Match the desktop's exact
  // leading-prompt projection instead of relying on SDK default prompt sections.
  const extensions: ReturnType<ResourceLoader['getExtensions']> = {
    extensions: [{
      path: 'builtin:cloud-runtime', resolvedPath: 'builtin:cloud-runtime', hidden: true,
      sourceInfo: createSyntheticSourceInfo('builtin:cloud-runtime', { source: 'builtin' }),
      handlers: new Map([['before_agent_start', [async () => ({ systemPrompt: input.systemPrompt })]]]),
      tools: new Map(), messageRenderers: new Map(), commands: new Map(), flags: new Map(), shortcuts: new Map(),
    }],
    errors: [], runtime: extensionRuntime,
  };
  const loader: ResourceLoader = {
    getExtensions: () => extensions,
    getSkills: () => ({ skills: [], diagnostics: [] }),
    getPrompts: () => ({ prompts: [], diagnostics: [] }),
    getThemes: () => ({ themes: [], diagnostics: [] }),
    getAgentsFiles: () => ({ agentsFiles: [] }),
    getSystemPrompt: () => input.systemPrompt,
    getSystemPromptSource: () => undefined,
    getAppendSystemPrompt: () => [],
    getAppendSystemPromptSources: () => [],
    extendResources: () => { throw new Error('CLOUD_RESOURCE_DISCOVERY_DISABLED'); },
    reload: async () => {},
  };
  const { session } = await createAgentSession({
    cwd, agentDir: cwd, modelRuntime: runtime, model: input.model,
    sessionManager: manager,
    settingsManager: SettingsManager.inMemory({
      compaction: { enabled: true }, retry: { enabled: true, maxRetries: 2 },
      cacheWarming: 'off',
    }),
    resourceLoader: loader, noTools: 'all',
    tools: input.tools.map(tool => tool.name),
    customTools: input.tools.map(tool => ({ ...tool, execute: async (id, args, signal, onUpdate) => {
      await input.beforeTool?.();
      signal?.throwIfAborted();
      return tool.execute(id, args, signal, onUpdate);
    } })),
  });
  session.agent.toolExecution = 'sequential';
  try {
    await session.bindExtensions({ mode: 'rpc' });
  } catch (error) {
    session.dispose();
    throw error;
  }
  return { session, manager };
}
