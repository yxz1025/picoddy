import { ApiError, requestCloudJson, unsupported } from "./cloudHttp";

type Row = Record<string, any>;

function desktop(row: Row, skills: Row[] = []): Row {
  const skill = row.skillIds?.length === 1 ? skills.find((item) => item.id === row.skillIds[0]) : undefined;
  return {
    id: row.id, name: row.name, enabled: row.enabled, workspaceId: null,
    triggerType: "cron", triggerConfig: { cron: row.cron },
    actionType: skill ? "skill" : "prompt", actionConfig: { prompt: row.prompt, ...(skill ? { skill: skill.name } : {}) }, prompt: row.prompt,
    expertId: null, permission: "default", connector: null, scheduleType: "cron",
    validFrom: null, validUntil: null, pushToWxmp: false,
    lastRun: row.lastRunAt ? Date.parse(row.lastRunAt) : null,
    nextRun: row.nextRunAt ? Date.parse(row.nextRunAt) : null,
    createdAt: Date.parse(row.createdAt),
  };
}

export function desktopCron(body: Row): string {
  if (body.scheduleType === "once") unsupported("云端暂不支持单次定时，请使用 Cron");
  if (body.scheduleType === "interval") {
    const minutes = Number(body.triggerConfig?.intervalMinutes);
    if (Number.isInteger(minutes) && minutes > 0 && minutes <= 60 && 60 % minutes === 0) {
      return minutes === 60 ? "0 * * * *" : `*/${minutes} * * * *`;
    }
    unsupported("当前间隔不能精确转换为 Cron，请改用 Cron 表达式");
  }
  const cron = body.triggerConfig?.cron;
  if (typeof cron !== "string" || cron.trim().split(/\s+/).length !== 5) {
    throw new ApiError(400, "请输入五段式 Cron 表达式", "INVALID_SCHEDULE");
  }
  return cron.trim();
}

export async function requestCloudAutomation(method: string, path: string, body: Row = {}): Promise<unknown> {
  if (path.endsWith("/run") || path.endsWith("/runs")) unsupported("云端尚未接入手动触发及自动化历史面板");
  if (method === "GET") {
    const rows = await requestCloudJson<Row[]>("GET", "/api/automations");
    const skills = await requestCloudJson<Row[]>("GET", "/api/skills");
    const runs = rows.some((row) => row.lastRunId) ? await requestCloudJson<Row[]>("GET", "/api/runs") : [];
    const mapped = rows.map((row) => desktop({ ...row, lastRunAt: runs.find((run) => run.id === row.lastRunId)?.createdAt }, skills));
    if (path === "/api/automations") return mapped;
    const item = mapped.find((row) => row.id === path.split("/").pop());
    if (!item) throw new ApiError(404, "自动化不存在", "NOT_FOUND");
    return item;
  }
  if (method === "DELETE") return requestCloudJson("DELETE", path);
  const update = method === "PUT" || method === "PATCH";
  const current = update
    ? (await requestCloudJson<Row[]>("GET", "/api/automations")).find((row) => row.id === path.split("/").pop())
    : undefined;
  if (update && !current) throw new ApiError(404, "自动化不存在", "NOT_FOUND");
  if (update && Object.keys(body).every((key) => key === "enabled")) {
    return desktop(await requestCloudJson<Row>("PATCH", path, body));
  }
  const skills = current ? await requestCloudJson<Row[]>("GET", "/api/skills") : [];
  const merged = { ...(current ? desktop(current, skills) : {}), ...body };
  if (merged.workspaceId || merged.expertId || merged.connector || merged.pushToWxmp || merged.validFrom || merged.validUntil) {
    unsupported("云端定时任务暂不支持空间/专家绑定、推送及有效期；请清空这些选项");
  }
  if (merged.triggerType && !["schedule", "cron", "interval"].includes(merged.triggerType)) {
    unsupported("云端暂不支持此触发器，请选择定时任务");
  }
  if (merged.permission === "readonly") unsupported("云端尚未实现只读工具策略，不能以只读配置启动任务");
  const skillIds: string[] = [];
  if (merged.actionType === "skill") {
    const skills = await requestCloudJson<Row[]>("GET", "/api/skills");
    const skill = skills.find((row) => row.name === merged.actionConfig?.skill && row.enabled !== false);
    if (!skill) throw new ApiError(400, "请选择已启用的技能", "INVALID_SELECTION");
    skillIds.push(skill.id);
  }
  const prompt = merged.prompt || merged.actionConfig?.prompt || (skillIds.length ? `执行技能 ${merged.actionConfig.skill}` : "");
  if (!prompt.trim()) throw new ApiError(400, "任务提示词不能为空", "INVALID_REQUEST");
  const result = await requestCloudJson<Row>(update ? "PATCH" : "POST", path, {
    name: merged.name, prompt, cron: desktopCron(merged),
    timezone: current?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone,
    skillIds: merged.actionType === "skill" ? skillIds : current?.skillIds ?? [],
    connectorIds: current?.connectorIds ?? [],
    ...(current?.modelId ? { modelId: current.modelId } : {}), enabled: merged.enabled ?? true,
  });
  return desktop(result, skills);
}
