import { Type } from "typebox";
import type { AgentTool } from "@earendil-works/pi-agent-core";
import { createAutomation, deleteAutomation, getAutomation, listAutomations, updateAutomation } from "../../domains/automation/node/store.ts";
import { initAutomationNextRun } from "../../domains/automation/node/scheduler.ts";
import { loadMcpConfig } from "../mcp.ts";

const schema = Type.Object({
  mode: Type.Union([Type.Literal("list"), Type.Literal("connectors"), Type.Literal("view"), Type.Literal("create"), Type.Literal("update"), Type.Literal("delete")]),
  id: Type.Optional(Type.String()), name: Type.Optional(Type.String()), prompt: Type.Optional(Type.String()),
  cron: Type.Optional(Type.String({ description: "5段 cron；每天12点为 0 12 * * *，使用本机时区" })),
  scheduleType: Type.Optional(Type.Union([Type.Literal("cron"), Type.Literal("interval"), Type.Literal("once")])),
  intervalMinutes: Type.Optional(Type.Number()), onceAt: Type.Optional(Type.Number()), enabled: Type.Optional(Type.Boolean()),
  connector: Type.Optional(Type.Union([Type.String(), Type.Null()], { description: "连接器配置名；先调用 connectors 查看可用名称，传 null 可移除" })),
});

export const automationUpdateTool: AgentTool<typeof schema, any> = {
  name: "automation_update", label: "管理定时任务",
  description: "管理本项目内置自动化任务及其 MCP 连接器。用户要求定时执行时必须调用此工具，禁止改用 launchd、crontab 或 Windows 任务计划程序，除非用户明确要求系统级任务。先 connectors 查看可用连接器，再将准确名称写入 connector；先 list 避免重复；创建后返回任务 ID 和下次运行时间。",
  parameters: schema,
  execute: async (_id, p) => {
    if (p.mode === "list") return { content: [{ type: "text", text: JSON.stringify(listAutomations()) }] };
    if (p.mode === "connectors") {
      const config = await loadMcpConfig();
      const available = Object.entries(config.mcpServers)
        .filter(([, c]) => c.type !== "managed-cli" && !c.disabled && c.enabled !== false)
        .map(([name, c]) => ({ name, displayName: c.displayName || name }));
      return { content: [{ type: "text", text: JSON.stringify(available) }] };
    }
    if (p.mode === "create") {
      if (!p.name?.trim() || !p.prompt?.trim()) throw new Error("创建任务需要名称和执行提示词");
      const scheduleType = p.scheduleType ?? "cron";
      if (scheduleType === "cron" && (!p.cron || p.cron.trim().split(/\s+/).length !== 5)) throw new Error("cron 必须为5段格式，例如每天12点：0 12 * * *");
      if (scheduleType === "interval" && (!Number.isInteger(p.intervalMinutes) || p.intervalMinutes! < 1)) throw new Error("间隔分钟数必须为正整数");
      if (scheduleType === "once" && (!p.onceAt || p.onceAt <= Date.now())) throw new Error("一次性任务需要未来时间戳（毫秒）");
      if (p.connector) {
        const config = await loadMcpConfig();
        const selected = config.mcpServers[p.connector];
        if (!selected || selected.type === "managed-cli" || selected.disabled || selected.enabled === false) throw new Error("所选连接器不存在、已停用或不支持定时任务；请先调用 connectors 查看可用连接器");
      }
      const automation = createAutomation({ name: p.name.trim(), triggerType: "cron", triggerConfig: { cron: p.cron, intervalMinutes: p.intervalMinutes, onceAt: p.onceAt }, actionType: "prompt", actionConfig: { prompt: p.prompt }, prompt: p.prompt, connector: p.connector || null, scheduleType });
      initAutomationNextRun(automation);
      return { content: [{ type: "text", text: JSON.stringify(getAutomation(automation.id)) }] };
    }
    if (!p.id) throw new Error("此操作需要任务 ID");
    const current = getAutomation(p.id);
    if (!current) throw new Error("自动化任务不存在");
    if (p.mode === "view") return { content: [{ type: "text", text: JSON.stringify(current) }] };
    if (p.mode === "delete") { deleteAutomation(p.id); return { content: [{ type: "text", text: "任务已删除" }] }; }
    if (p.connector) {
      const config = await loadMcpConfig();
      const selected = config.mcpServers[p.connector];
      if (!selected || selected.type === "managed-cli" || selected.disabled || selected.enabled === false) throw new Error("所选连接器不存在、已停用或不支持定时任务");
    }
    updateAutomation(p.id, { name: p.name ?? current.name, prompt: p.prompt ?? current.prompt, actionConfig: p.prompt ? { ...current.actionConfig, prompt: p.prompt } : current.actionConfig, enabled: p.enabled ?? current.enabled, triggerConfig: p.cron ? { ...current.triggerConfig, cron: p.cron } : current.triggerConfig, connector: p.connector !== undefined ? p.connector : current.connector, nextRun: null });
    initAutomationNextRun(getAutomation(p.id)!);
    return { content: [{ type: "text", text: JSON.stringify(getAutomation(p.id)) }] };
  },
};
