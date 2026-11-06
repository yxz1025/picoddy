// Native Pi AgentSession integration. AgentSession owns the model/tool loop,
// retries, session history, automatic compaction, and overflow recovery.

import type { AgentEvent, AgentTool } from "@earendil-works/pi-agent-core";
import { join } from "node:path";
import { getPluginSessionResources } from "./plugin_tools.ts";
import { getModels } from "./models.ts";
import { createImageGenerationTool } from "./native_images.ts";
import { installCompletionBoundary } from "./completion_boundary.ts";
import { createRuntimeMetrics } from './runtime_metrics.ts';
import { projectRequirementAssetContext } from './requirement_asset_context.ts';
import { logOperationEvent } from '../infra/operation_log.ts';
import {
  checkToolPermission,
  checkToolPermissionForPlatform,
  logToolCall,
  type PermLevel,
} from "./permissions.ts";
import { detectFileWrites, snapshotFile } from "../infra/file_snapshot.ts";
import type { ProtectedPathPolicy } from "../platform/path_policy.ts";
import type { ResolvedPermissionPolicy } from "./prompt-runtime/types.ts";
import {
  createAgentSession,
  DefaultResourceLoader,
  ModelRuntime,
  type SessionManager,
  SettingsManager,
  createCodemodeExtension,
  createToolSearchExtension,
} from "../vendor/pi_coding_agent.ts";
import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";
import type { PromptResources } from "./prompt-runtime/types.ts";
import type {
  ExtensionAPI,
  InlineExtension,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";

export type NativeAgentSession = Awaited<
  ReturnType<typeof createAgentSession>
>["session"];

const CORE_AGENT_EVENT_TYPES = new Set([
  "agent_start",
  "agent_end",
  "turn_start",
  "turn_end",
  "message_start",
  "message_update",
  "message_end",
  "tool_execution_start",
  "tool_execution_update",
  "tool_execution_end",
]);

export function normalizeAgentSessionEvent(
  event: AgentSessionEvent,
): AgentEvent | undefined {
  if (!CORE_AGENT_EVENT_TYPES.has(event.type)) return undefined;
  if (event.type === "tool_execution_end") {
    return { ...event, output: event.result } as AgentEvent;
  }
  return event as AgentEvent;
}

function asToolDefinition(tool: AgentTool<any>): ToolDefinition<any> {
  return {
    ...tool,
    execute: (
      id: string,
      params: unknown,
      signal: AbortSignal | undefined,
      onUpdate: Parameters<AgentTool<any>["execute"]>[3],
    ) => tool.execute(id, params, signal, onUpdate),
  } as ToolDefinition<any>;
}

export interface PiSessionHandle {
  session: NativeAgentSession;
}

export async function createPiSession(
  onEvent: (event: AgentEvent) => void,
  opts: {
    sessionId: string;
    sessionManager: SessionManager;
    cwd: string;
    agentDir: string;
    modelProvider: string;
    modelId: string;
    tools: AgentTool<any>[];
    resources?: PromptResources;
    buildPrompt: () => string;
    getPermission: () => PermLevel;
    getPermissionPolicy: () => ResolvedPermissionPolicy | undefined;
    getProtectedPathPolicy: () => ProtectedPathPolicy | undefined;
    getToolCallGuard?: () =>
      | ((
        toolName: string,
        input: unknown,
      ) => { block: true; reason: string } | undefined)
      | undefined;
    onRuntimeStatus?: (
      phase: "compacting" | "running",
      message: string,
    ) => void;
  },
): Promise<PiSessionHandle> {
  const models = getModels();
  const metrics = createRuntimeMetrics(opts.sessionId);
  const allowedNames = new Set(opts.tools.map(tool => tool.name));
  const orchestration = opts.tools.length > 0;
  const imageGeneration = allowedNames.has("present_files") && (allowedNames.has("write") || allowedNames.has("bash"));
  if (orchestration) { allowedNames.add("codemode"); allowedNames.add("tool_search"); }
  if (imageGeneration) allowedNames.add("generate_image");

  const runtimeExtension: InlineExtension = {
    name: "picoddy-runtime",
    hidden: true,
    factory: (pi: ExtensionAPI) => {
      pi.on('context_with_system', event => {
        const projection = projectRequirementAssetContext(event.messages);
        if (projection.references > 0) logOperationEvent('agent.context.asset_projection', 'event', {
          sessionId: opts.sessionId, references: projection.references, removedCharacters: projection.removedCharacters,
        });
        if (projection.contextReferences > 0 || projection.contextFieldsRemoved > 0) logOperationEvent('agent.context.requirement_projection', 'event', {
          sessionId: opts.sessionId, references: projection.contextReferences,
          fieldsRemoved: projection.contextFieldsRemoved, removedCharacters: projection.removedCharacters,
        });
        return { messages: projection.messages };
      });
      pi.on('before_provider_request', event => { metrics.request(event.payload); });
      pi.on("before_agent_start", () => ({ systemPrompt: opts.buildPrompt() }));
      pi.on("tool_call", async (event) => {
        if (!allowedNames.has(event.toolName)) return { block: true, reason: `当前会话未授权工具 ${event.toolName}` };
        // The script itself has no IO. Its nested calls pass this same hook.
        if (event.toolName === "codemode" || event.toolName === "tool_search") return;
        const permissionTool = event.toolName === "generate_image" ? "write" : event.toolName;
        const runtimePolicy = opts.getPermissionPolicy();
        const protectedPathPolicy = opts.getProtectedPathPolicy();
        const decision = runtimePolicy
          ? await runtimePolicy.check(permissionTool, event.input)
          : protectedPathPolicy
          ? await checkToolPermissionForPlatform(
            protectedPathPolicy.os,
            opts.sessionId,
            opts.getPermission(),
            permissionTool,
            event.input,
            protectedPathPolicy,
          )
          : await checkToolPermission(
            opts.sessionId,
            opts.getPermission(),
            permissionTool,
            event.input,
          );
        if (!decision.allow) return { block: true, reason: decision.reason };
        const guarded = opts.getToolCallGuard?.()?.(
          event.toolName,
          event.input,
        );
        if (guarded) return guarded;
        if (event.toolName === "bash") {
          const command = String(
            (event.input as { command?: unknown }).command ?? "",
          );
          if (
            /(?:^|[;&|]\s*)(?:open|xdg-open|start)\b|Google Chrome|google-chrome|chrome.*(?:headless|file:)|screencapture|osascript\s+.*\bopen\b|file:\/\//i
              .test(command)
          ) {
            return {
              block: true,
              reason:
                "运行时交付约束：不要打开系统浏览器或系统默认应用。请完成文件写入后调用 present_files。",
            };
          }
          for (const file of detectFileWrites(command)) {
            try {
              await snapshotFile(file, opts.sessionId);
            } catch { /* best effort */ }
          }
        }
      });
      pi.on("tool_result", async (event) => {
        await logToolCall(event.toolName, event.input, event.isError);
      });
    },
  };
  const settingsManager = SettingsManager.create(opts.cwd, opts.agentDir, {
    projectTrusted: true,
  });
  const modelRuntime = await ModelRuntime.create({
    authPath: join(opts.agentDir, "auth.json"),
    modelsPath: join(opts.agentDir, "models.json"),
  });
  for (const provider of models.getProviders()) {
    modelRuntime.registerNativeProvider(provider);
  }
  const plugins = getPluginSessionResources(opts.tools.map(tool => tool.name));
  const resourceLoader = new DefaultResourceLoader({
    additionalExtensionPaths: plugins.paths,
    cwd: opts.cwd,
    agentDir: opts.agentDir,
    settingsManager,
    extensionFactories: [
      runtimeExtension,
      ...(orchestration ? [createCodemodeExtension({ mode: "on", models: false }), createToolSearchExtension()] : []),
      ...(imageGeneration ? [(pi: ExtensionAPI) => pi.registerTool(createImageGenerationTool(modelRuntime, opts.cwd))] : []),
    ],
    extensionsOverride: result => {
      for (const extension of result.extensions) {
        for (const [name, registered] of extension.tools) {
          if (!allowedNames.has(name)) extension.tools.delete(name);
          else if (name === "goal_complete" || name === "present_files" || name === "ask_user") registered.definition.exposure = "model-only";
        }
      }
      return result;
    },
    noExtensions: true,
    noSkills: true,
    skillsOverride: () => ({ skills: opts.resources?.skills ?? [], diagnostics: [] }),
    promptsOverride: () => ({ prompts: opts.resources?.promptTemplates ?? [], diagnostics: [] }),
    noPromptTemplates: true,
    noThemes: true,
    noContextFiles: true,
    systemPrompt: "",
  });
  await resourceLoader.reload();
  // Register native extension models before resolving the user's selected model.
  const registrations = resourceLoader.getExtensions().runtime;
  for (const entry of registrations.pendingNativeProviderRegistrations) modelRuntime.registerNativeProvider(entry.provider);
  for (const entry of registrations.pendingProviderRegistrations) modelRuntime.registerProvider(entry.name, entry.config);
  for (const entry of registrations.pendingVirtualModelRegistrations) modelRuntime.registerVirtualModel(entry.definition);
  const model = modelRuntime.getModel(opts.modelProvider, opts.modelId);
  if (!model) throw new Error(`模型 ${opts.modelProvider}/${opts.modelId} 未注册`);
  logOperationEvent('agent.runtime.config', 'event', {
    sessionId: opts.sessionId, provider: opts.modelProvider, model: opts.modelId,
    reasoningSupported: model.reasoning,
    httpIdleTimeoutMs: settingsManager.getHttpIdleTimeoutMs(),
    providerRetry: settingsManager.getProviderRetrySettings(),
    retry: settingsManager.getRetrySettings(),
  });
  const toolNames = [...allowedNames].filter(name => {
    const tool = opts.tools.find(tool => tool.name === name) as (AgentTool & { exposure?: string }) | undefined;
    return tool?.exposure !== "deferred" && tool?.exposure !== "codemode" && tool?.exposure !== "hidden";
  });
  const { session } = await createAgentSession({
    cwd: opts.cwd,
    agentDir: opts.agentDir,
    modelRuntime,
    settingsManager,
    resourceLoader,
    sessionManager: opts.sessionManager,
    model,
    // Preserve saved/configured levels. Pi clamps unsupported off to the
    // lowest supported level (e.g. Qwen 3.8 low), not a fabricated off mode.
    thinkingLevel: opts.sessionManager.getBranch().some(entry => entry.type === 'thinking_level_change')
      ? undefined
      : settingsManager.getModelThinkingLevel(model.provider, model.id) ?? settingsManager.getDefaultThinkingLevel() ?? 'off',
    noTools: "all",
    tools: [...allowedNames],
    customTools: opts.tools.filter(tool => !plugins.toolNames.has(tool.name)).map(tool => ({
      ...asToolDefinition(tool),
      ...(["goal_complete", "present_files", "ask_user"].includes(tool.name) ? { exposure: "model-only" as const } : {}),
    })),
  });
  try {
    await session.bindExtensions({ mode: "rpc" });
  } catch (error) {
    await disposePiSession(session).catch(() => {});
    throw error;
  }
  session.setActiveToolsByName(toolNames);
  logOperationEvent('agent.runtime.thinking', 'event', {
    sessionId: opts.sessionId, model: model.id, thinkingLevel: session.thinkingLevel,
    availableThinkingLevels: session.getAvailableThinkingLevels(),
  });
  installCompletionBoundary(session.agent);
  session.subscribe((event) => {
    metrics.event(event);
    if (event.type === "compaction_start") {
      opts.onRuntimeStatus?.(
        "compacting",
        "正在整理长会话上下文，保留近期对话和关键进展…",
      );
    } else if (event.type === "compaction_end") {
      opts.onRuntimeStatus?.("running", "正在继续执行任务…");
    }
    const normalized = normalizeAgentSessionEvent(event);
    if (normalized) onEvent(normalized);
  });
  return { session };
}

/** Deliver the native shutdown event before invalidating plugin contexts. */
export async function disposePiSession(session: NativeAgentSession, reason: "quit" | "reload" = "quit"): Promise<void> {
  try {
    await session.extensionRunner.emit({ type: "session_shutdown", reason });
  } finally {
    session.dispose();
  }
}
