// src/agent/tools/index.ts
// 工具注册表。pi 极简哲学：read / write / bash + memory + 文档工具
// 对照 pi-mono coding-agent 的工具集

import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createConnectorCommandGateway } from "../../domains/connector/node/command_gateway.ts";
import { managedConnectorAssembly } from "../../domains/connector/node/assembly.ts";
import {
  type AgentManager,
  createAgentManager,
} from "../../domains/connector/node/agent_manager.ts";
import { createMcpManagedConnectorStore } from "../../domains/connector/node/mcp_store.ts";
import {
  appendMessageWithAttachments,
  createConversation,
  deleteConversation,
  getConversation,
} from "../../domains/session/node/store.ts";
import {
  registerPluginToolNames,
  unregisterPluginToolNames,
} from "../prompt-runtime/capability-catalog.ts";
import { provider } from "../provider.ts";
import { createConnectorCliExecuteTool } from "./connector_cli_execute.ts";
import {
  buildConnectorDelegateTools,
  type ConnectorChildTurnOptions,
  type ConnectorRunChildTurn,
  resolveChildAttachmentItems,
} from "./connector_delegate.ts";
import {
  createBashTool,
  createCodingTools,
  createLocalBashOperations,
  createReadOnlyTools,
} from "../../vendor/pi_coding_agent.ts";
import { memoryRecallTool, memoryWriteTool } from "./memory.ts";
import { automationUpdateTool } from "./automation.ts";
import {
  editDocxFreeTool,
  editDocxTool,
  editPptxTool,
  editXlsxTool,
  readDocTool,
  resolveDocToolWriteTargets,
  writeDocxTool,
  writePptxTool,
  writeXlsxTool,
} from "./doc.ts";
import { webFetchTool, webSearchTool } from "./web.ts";
import {
  appFocusTool,
  computerTool,
  cursorPosTool,
  keyTypeTool,
  mouseClickTool,
  mouseMoveTool,
  screenshotTool,
} from "./os.ts";
import {
  ragIndexTool,
  ragQueryTool,
  ragRefreshTool,
  ragStatusTool,
} from "./rag.ts";
import { subagentTool } from "./subagent.ts";
import { goalCompleteTool } from "./goal.ts";
import { getPluginTools, mergePluginTools } from "../plugin_tools.ts";
import { askUserQuestionTool } from "./ask.ts";
import { connectCloudServiceTool } from "./connect_cloud_service.ts";
import { presentFilesTool } from "./present_files.ts";
import { readMeTool, widgetGuidelinesTool } from "./read_me.ts";
import { showWidgetTool } from "./show_widget.ts";
import { getSkillDraftTools } from "./skill_draft.ts";
import { getExpertDraftTools } from "./expert_draft.ts";
import { platformPaths } from "../../platform/paths.ts";
import { isMacOS, isWindows } from "../../platform/runtime.ts";
import { createDefaultManagedRuntimeService } from "../../platform/runtime/index.ts";
import { createWindowsShellTool } from "./windows_shell.ts";
import { dependencyInstallEnvironment, withDependencyInstallPolicy } from "./dependency_install.ts";
import { createDefaultProtectedPathPolicy } from "../../platform/path_policy.ts";
import { protectShellTool } from "./protected_shell.ts";
import { protectFileTool } from "./protected_file.ts";
import type { ProtectedPathPolicy } from "../../platform/path_policy.ts";
import { isPathWithin } from "../../platform/path_policy.ts";
import { collectMcpPathTargets } from "./mcp_path_guard.ts";
import { guardAttachmentReadTool } from "./attachment_read_guard.ts";

export interface FullToolsOptions {
  cwd: string;
  protectedWorkspace: boolean;
  selectedMcpTools?: AgentTool[];
  policy?: ProtectedPathPolicy;
  mutationLockPath?: string;
}

const FILE_WRITE_TOOL_NAMES = new Set([
  "write",
  "edit",
  "delete",
  "remove",
  "move",
  "copy",
  "write_file",
  "edit_file",
  "delete_file",
  "move_file",
  "copy_file",
  "write_docx",
  "write_xlsx",
  "write_pptx",
  "edit_docx",
  "edit_xlsx",
  "edit_docx_free",
  "edit_pptx",
]);

function protectWritableTool(
  tool: AgentTool<any>,
  policy: ProtectedPathPolicy,
  lockPath: string,
): AgentTool<any> {
  return FILE_WRITE_TOOL_NAMES.has(tool.name)
    ? protectFileTool(tool, policy, { lockPath })
    : tool;
}

function protectDocumentTool(
  tool: AgentTool<any>,
  policy: ProtectedPathPolicy,
  lockPath: string,
): AgentTool<any> {
  return protectFileTool(tool, policy, {
    resolveTargets: (input) =>
      resolveDocToolWriteTargets(
        tool.name,
        input as Record<string, unknown>,
      ),
    lockPath,
  });
}

/** 全量工具（Craft 模式）：pi 原生 read/bash/edit/write + memory + 文档 + 联网 + MCP */
export function getFullTools(
  options: FullToolsOptions | AgentTool<any>[] = {
    cwd: platformPaths.artifactsDir,
    protectedWorkspace: false,
  },
): AgentTool<any>[] {
  // Transitional array form remains task-local, but no longer grants HOME as cwd.
  const normalized: FullToolsOptions = Array.isArray(options)
    ? {
      cwd: platformPaths.artifactsDir,
      protectedWorkspace: false,
      selectedMcpTools: options,
    }
    : options;
  const { cwd, protectedWorkspace } = normalized;
  if (!cwd) throw new Error("getFullTools requires an explicit session cwd");
  const selectedMcpTools = normalized.selectedMcpTools ?? [];
  const pathPolicy = normalized.policy ?? createDefaultProtectedPathPolicy({
    cwd,
  });
  const mutationLockPath = normalized.mutationLockPath ?? platformPaths.join(
    platformPaths.systemDir,
    ".agent-mutation.lock",
  );
  const actuallyProtected = pathPolicy.protectedRoots.some((root) =>
    isPathWithin(root, cwd, pathPolicy.os)
  );
  if (protectedWorkspace !== actuallyProtected) {
    throw new Error(
      "protectedWorkspace does not match the resolved cwd policy",
    );
  }
  if (actuallyProtected) {
    // Keep explicitly selected MCP tools available in the protected fallback
    // workspace. Local filesystem writes remain unavailable, while read/query
    // connectors such as database MCPs can still execute normally.
    return getReadOnlyTools(
      cwd,
      selectedMcpTools,
      pathPolicy,
      mutationLockPath,
    );
  }
  const codingTools = createCodingTools(cwd);
  const managedCodingTools = !isWindows
    ? [
      ...codingTools.filter((tool) => tool.name !== "bash"),
      createBashTool(cwd, {
        operations: {
          ...createLocalBashOperations(),
          exec: async (command, commandCwd, options) => {
            const env = isMacOS
              ? await createDefaultManagedRuntimeService().buildShellEnv(options.env)
              : options.env;
            return createLocalBashOperations().exec(command, commandCwd, {
              ...options,
              env: { ...dependencyInstallEnvironment(), ...env },
            });
          },
        },
      }),
    ]
    : codingTools;
  const platformCodingTools = (isWindows
    ? [
      ...codingTools.filter((tool) => tool.name !== "bash"),
      createWindowsShellTool(cwd),
    ]
    : managedCodingTools).map((tool) =>
      guardAttachmentReadTool(tool, cwd)
    ).map((tool) =>
      tool.name === "bash"
        ? withDependencyInstallPolicy(protectShellTool(
          tool as unknown as AgentTool<any>,
          pathPolicy,
          { lockPath: mutationLockPath },
        ), cwd)
        : protectWritableTool(
          tool as unknown as AgentTool<any>,
          pathPolicy,
          mutationLockPath,
        )
    );
  return mergePluginTools(
    ([
      ...platformCodingTools,
      subagentTool,
      goalCompleteTool,
      automationUpdateTool,
      memoryRecallTool,
      memoryWriteTool,
      readDocTool,
      protectDocumentTool(writeDocxTool, pathPolicy, mutationLockPath),
      protectDocumentTool(writeXlsxTool, pathPolicy, mutationLockPath),
      protectDocumentTool(writePptxTool, pathPolicy, mutationLockPath),
      protectDocumentTool(editDocxTool, pathPolicy, mutationLockPath),
      protectDocumentTool(editXlsxTool, pathPolicy, mutationLockPath),
      protectDocumentTool(editDocxFreeTool, pathPolicy, mutationLockPath),
      protectDocumentTool(editPptxTool, pathPolicy, mutationLockPath),
      webFetchTool,
      webSearchTool,
      // Computer Use 工具（对标 CodeX / Anthropic 规范）
      computerTool,
      screenshotTool,
      mouseClickTool,
      mouseMoveTool,
      keyTypeTool,
      appFocusTool,
      cursorPosTool,
      // RAG 工具
      ragIndexTool,
      ragQueryTool,
      ragRefreshTool,
      ragStatusTool,
      // 交互式提问（对标 参考设计 AskUserQuestion）
      askUserQuestionTool,
      connectCloudServiceTool,
      presentFilesTool,
      // Visualizer 可视化（对标 参考设计 s19）
      readMeTool,
      widgetGuidelinesTool,
      showWidgetTool,
      ...selectedMcpTools.map((tool) =>
        protectFileTool(tool, pathPolicy, {
          resolveTargets: (input) => collectMcpPathTargets(input, pathPolicy),
          lockPath: mutationLockPath,
        })
      ),
    ] as unknown as AgentTool<any>[])
      .map((tool) =>
        tool.name === "bash"
          ? tool
          : protectWritableTool(tool, pathPolicy, mutationLockPath)
      ),
    getPluginTools(),
  );
}

/** 只读工具（Plan 模式） */
export function getReadOnlyTools(
  cwd: string = platformPaths.artifactsDir,
  selectedMcpTools: AgentTool<any>[] = [],
  policy: ProtectedPathPolicy = createDefaultProtectedPathPolicy({ cwd }),
  mutationLockPath: string = platformPaths.join(
    platformPaths.systemDir,
    ".agent-mutation.lock",
  ),
): AgentTool<any>[] {
  if (!cwd) {
    throw new Error("getReadOnlyTools requires an explicit session cwd");
  }
  const ro = createReadOnlyTools(cwd).map((tool) =>
    guardAttachmentReadTool(tool, cwd)
  );
  return mergePluginTools(
    [
      ...ro,
      memoryRecallTool,
      readDocTool,
      webFetchTool,
      webSearchTool,
      askUserQuestionTool,
      connectCloudServiceTool,
      presentFilesTool,
      readMeTool,
      widgetGuidelinesTool,
      showWidgetTool,
      ...selectedMcpTools.map((tool) =>
        protectFileTool(tool, policy, {
          resolveTargets: (input) => collectMcpPathTargets(input, policy),
          lockPath: mutationLockPath,
        })
      ),
    ] as unknown as AgentTool<any>[],
    getPluginTools(),
  );
}

/** 兼容旧接口 */
export function getTools(): AgentTool<any>[] {
  return getFullTools({
    cwd: platformPaths.artifactsDir,
    protectedWorkspace: false,
  });
}

/** Skill Creator 专用工具：仅允许操作当前会话草稿和向用户提问。 */
export function getSkillCreatorTools(): AgentTool[] {
  return [
    ...getSkillDraftTools(),
    askUserQuestionTool,
  ];
}

let connectorCliTool: AgentTool | undefined;
/** 连接器子会话专用工具：仅暴露受管 CLI 网关（惰性单例，复用共享装配的 Registry 与运行时）。 */
export function getConnectorChildTools(): AgentTool[] {
  connectorCliTool ??= createConnectorCliExecuteTool({
    gateway: (async () => {
      const { registry, runtime } = await managedConnectorAssembly();
      return createConnectorCommandGateway({ registry, runtime });
    })(),
  });
  return [connectorCliTool];
}

let agentManagerPromise: Promise<AgentManager> | undefined;
function agentManager(): Promise<AgentManager> {
  agentManagerPromise ??= (async () => {
    const { registry } = await managedConnectorAssembly();
    return createAgentManager({
      appDataDir: platformPaths.appDataDir,
      registry,
      store: createMcpManagedConnectorStore(platformPaths.appDataDir, registry, true),
      createChild: (parentId) =>
        createConversation("连接器任务", "connector-agent", undefined, parentId)
          .id,
      deleteChild: (childId) => deleteConversation(childId),
      disposeChild: async (childId) => {
        await provider.dispose(childId);
      },
    });
  })();
  return agentManagerPromise;
}

const runChildTurn: ConnectorRunChildTurn = async (
  options: ConnectorChildTurnOptions,
) => {
  const promptText = [
    options.task,
    ...(options.summary ? [`父会话摘要：${options.summary}`] : []),
  ].join("\n\n");
  const attachmentIds = options.attachmentIds ?? [];
  const attachments = attachmentIds.length > 0
    ? resolveChildAttachmentItems(attachmentIds)
    : [];
  const persistPrompt = () => {
    appendMessageWithAttachments(
      options.childConversationId,
      "user",
      promptText,
      [...attachmentIds],
    );
  };
  // 子会话无前端监听，需挂接落库监听保证 assistant 输出可被回读。
  await provider.attachPersistence(options.childConversationId);
  await provider.prompt(
    options.childConversationId,
    promptText,
    {
      mode: "craft",
      permission: "L1",
      connector: options.connector,
      connectorCommandContext: options.connectorContext,
      ...(attachments.length > 0 ? { attachments } : {}),
    },
    persistPrompt,
    persistPrompt,
  );
  const state = getConversation(options.childConversationId);
  if (state?.status !== "done") {
    throw new Error(
      `连接器子任务未完成（${
        state?.status ?? "unknown"
      }），请核查已有操作结果，不要直接重放外部操作。`,
    );
  }
};

let delegateToolCache: readonly AgentTool[] = [];
let registeredDelegateNames: readonly string[] = [];

/** 主 agent 工具装配用：返回最近一次刷新的 ready 连接器 delegate 工具（同步）。 */
export function getConnectorDelegateTools(): AgentTool[] {
  return [...delegateToolCache];
}

/** 按连接器当前状态刷新主 agent 的 delegate 工具缓存（登出/卸载/版本替换后失效）。 */
export async function refreshConnectorDelegateTools(): Promise<AgentTool[]> {
  try {
    const { registry } = await managedConnectorAssembly();
    const tools = await buildConnectorDelegateTools({
      registry,
      store: createMcpManagedConnectorStore(platformPaths.appDataDir, registry, true),
      manager: await agentManager(),
      runChildTurn,
    });
    unregisterPluginToolNames(registeredDelegateNames);
    registeredDelegateNames = tools.map((tool) => tool.name);
    registerPluginToolNames(registeredDelegateNames);
    delegateToolCache = [...tools];
  } catch (cause) {
    console.warn("[connector] delegate 工具刷新失败:", cause);
    delegateToolCache = [];
  }
  return [...delegateToolCache];
}

export {
  appFocusTool,
  askUserQuestionTool,
  computerTool,
  connectCloudServiceTool,
  cursorPosTool,
  editDocxFreeTool,
  editDocxTool,
  editPptxTool,
  editXlsxTool,
  getExpertDraftTools,
  getSkillDraftTools,
  keyTypeTool,
  memoryRecallTool,
  memoryWriteTool,
  mouseClickTool,
  mouseMoveTool,
  presentFilesTool,
  ragIndexTool,
  ragQueryTool,
  ragRefreshTool,
  ragStatusTool,
  readDocTool,
  readMeTool,
  widgetGuidelinesTool,
  screenshotTool,
  showWidgetTool,
  subagentTool,
  webFetchTool,
  webSearchTool,
  writeDocxTool,
  writePptxTool,
  writeXlsxTool,
};
