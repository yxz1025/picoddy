import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createBashTool, createLocalBashOperations } from "../../vendor/pi_coding_agent.ts";
import { getDb } from "../../infra/db.ts";
import { sessionContext } from "../../infra/context.ts";
import { platformPaths } from "../../platform/paths.ts";
import { createDefaultProtectedPathPolicy } from "../../platform/path_policy.ts";
import { createDefaultManagedRuntimeService } from "../../platform/runtime/index.ts";
import { createWindowsShellTool } from "./windows_shell.ts";
import { protectShellTool } from "./protected_shell.ts";

/** Compatibility entry point; shares the active tool registry's execution guard. */
export const sandboxedBashTool: AgentTool = {
  ...createBashTool(process.cwd()),
  description: "执行终端命令。所有路径可读，系统目录禁止修改，其他目录允许读写。",
  execute: async (id, input, signal, onUpdate) => {
    let cwd = process.cwd();
    const sessionId = sessionContext.getStore()?.sessionId;
    if (sessionId) {
      const db = getDb();
      const workspace = db.prepare(
        "SELECT w.dir_path FROM conversations c JOIN workspaces w ON c.workspace_id = w.id WHERE c.id = ?",
      ).get(sessionId) as { dir_path: string } | undefined;
      if (workspace?.dir_path) cwd = platformPaths.expandHome(workspace.dir_path);
    }
    const policy = createDefaultProtectedPathPolicy({ cwd });
    const local = createLocalBashOperations();
    const tool = process.platform === "win32"
      ? createWindowsShellTool(cwd)
      : createBashTool(cwd, {
        operations: {
          ...local,
          exec: async (command, commandCwd, options) => {
            const env = await createDefaultManagedRuntimeService().buildShellEnv(options.env);
            return local.exec(command, commandCwd, { ...options, env });
          },
        },
      });
    return protectShellTool(tool, policy).execute(id, input, signal, onUpdate);
  },
};
