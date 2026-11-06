// src/domains/automation/node/store.ts
// 自动化 CRUD + 运行记录。对照 08 计划功能 8 + 参考设计 子系统⑬。

import { getDb } from "../../../infra/db.ts";

export type TriggerType = "cron" | "file_watch";
export type ActionType = "prompt" | "skill";
export type ScheduleType = "cron" | "interval" | "once";
export type RunStatus = "queued" | "running" | "inProgress" | "completed" | "failed" | "timedOut" | "cancelled";
export type ActiveRunStatus = "queued" | "running" | "inProgress";
export type TerminalRunStatus = "completed" | "failed" | "timedOut" | "cancelled";
export type PermissionLevel = "readonly" | "default" | "full";

export interface TriggerConfig {
  cron?: string;        // schedule_type=cron: "*/5 * * * *" 5 段
  intervalMinutes?: number; // schedule_type=interval
  onceAt?: number;      // schedule_type=once: Unix timestamp (ms)
  path?: string;        // file_watch: 监听目录
  pattern?: string;     // file_watch: 文件名 glob
}
export interface ActionConfig {
  prompt?: string;      // action_type=prompt
  skill?: string;       // action_type=skill
}

export interface Automation {
  id: string;
  name: string;
  enabled: boolean;
  workspaceId: string | null;
  triggerType: TriggerType;
  triggerConfig: TriggerConfig;
  actionType: ActionType;
  actionConfig: ActionConfig;
  prompt: string | null;
  expertId: string | null;
  permission: PermissionLevel;
  connector: string | null;
  scheduleType: ScheduleType;
  validFrom: number | null;
  validUntil: number | null;
  pushToWxmp: boolean;
  lastRun: number | null;
  nextRun: number | null;
  createdAt: number;
}

export interface AutomationRun {
  id: string;
  automationId: string;
  status: RunStatus;
  sessionId: string | null;
  summary: string | null;
  startedAt: number;
  finishedAt: number | null;
}

function uuid(): string { return crypto.randomUUID(); }

function rowToAutomation(r: any): Automation {
  return {
    id: r.id,
    name: r.name,
    enabled: !!r.enabled,
    workspaceId: r.workspace_id ?? null,
    triggerType: r.trigger_type,
    triggerConfig: JSON.parse(r.trigger_config || "{}"),
    actionType: r.action_type,
    actionConfig: JSON.parse(r.action_config || "{}"),
    prompt: r.prompt ?? null,
    expertId: r.expert_id ?? null,
    permission: (r.permission || "default") as PermissionLevel,
    connector: r.connector ?? null,
    scheduleType: (r.schedule_type || "cron") as ScheduleType,
    validFrom: r.valid_from ?? null,
    validUntil: r.valid_until ?? null,
    pushToWxmp: !!r.push_to_wxmp,
    lastRun: r.last_run ?? null,
    nextRun: r.next_run ?? null,
    createdAt: r.created_at,
  };
}

export function listAutomations(): Automation[] {
  const db = getDb();
  return (db.prepare("SELECT * FROM automations ORDER BY created_at DESC").all() as any[]).map(rowToAutomation);
}

export function getAutomation(id: string): Automation | null {
  const db = getDb();
  const r = db.prepare("SELECT * FROM automations WHERE id = ?").get(id) as any;
  return r ? rowToAutomation(r) : null;
}

export function createAutomation(a: {
  name: string;
  workspaceId?: string | null;
  triggerType: TriggerType;
  triggerConfig?: TriggerConfig;
  actionType: ActionType;
  actionConfig?: ActionConfig;
  prompt?: string;
  expertId?: string | null;
  permission?: PermissionLevel;
  connector?: string | null;
  scheduleType?: ScheduleType;
  validFrom?: number | null;
  validUntil?: number | null;
  pushToWxmp?: boolean;
}): Automation {
  const db = getDb();
  const id = uuid();
  const now = Date.now();
  const triggerConfig = a.triggerConfig || {};
  const actionConfig = a.actionConfig || {};
  db.prepare(
    `INSERT INTO automations (
      id, name, enabled, workspace_id, trigger_type, trigger_config, action_type, action_config,
      prompt, expert_id, permission, connector, schedule_type, valid_from, valid_until, push_to_wxmp,
      last_run, next_run, created_at
    ) VALUES (?, ?, 1, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?)`,
  ).run(
    id,
    a.name,
    a.workspaceId ?? null,
    a.triggerType,
    JSON.stringify(triggerConfig),
    a.actionType,
    JSON.stringify(actionConfig),
    a.prompt ?? null,
    a.expertId ?? null,
    a.permission ?? "default",
    a.connector ?? null,
    a.scheduleType ?? "cron",
    a.validFrom ?? null,
    a.validUntil ?? null,
    a.pushToWxmp ? 1 : 0,
    now,
  );
  return getAutomation(id)!;
}

export function updateAutomation(id: string, patch: Partial<{
  name: string; enabled: boolean; workspaceId: string | null;
  triggerType: TriggerType; triggerConfig: TriggerConfig;
  actionType: ActionType; actionConfig: ActionConfig;
  prompt: string | null; expertId: string | null; permission: PermissionLevel;
  connector: string | null; scheduleType: ScheduleType;
  validFrom: number | null; validUntil: number | null; pushToWxmp: boolean;
  lastRun: number | null; nextRun: number | null;
}>): void {
  const db = getDb();
  const cur = getAutomation(id);
  if (!cur) throw new Error("自动化不存在");
  const merged = {
    name: patch.name ?? cur.name,
    enabled: patch.enabled ?? cur.enabled,
    workspaceId: patch.workspaceId !== undefined ? patch.workspaceId : cur.workspaceId,
    triggerType: patch.triggerType ?? cur.triggerType,
    triggerConfig: patch.triggerConfig ?? cur.triggerConfig,
    actionType: patch.actionType ?? cur.actionType,
    actionConfig: patch.actionConfig ?? cur.actionConfig,
    prompt: patch.prompt !== undefined ? patch.prompt : cur.prompt,
    expertId: patch.expertId !== undefined ? patch.expertId : cur.expertId,
    permission: patch.permission ?? cur.permission,
    connector: patch.connector !== undefined ? patch.connector : cur.connector,
    scheduleType: patch.scheduleType ?? cur.scheduleType,
    validFrom: patch.validFrom !== undefined ? patch.validFrom : cur.validFrom,
    validUntil: patch.validUntil !== undefined ? patch.validUntil : cur.validUntil,
    pushToWxmp: patch.pushToWxmp ?? cur.pushToWxmp,
    lastRun: patch.lastRun !== undefined ? patch.lastRun : cur.lastRun,
    nextRun: patch.nextRun !== undefined ? patch.nextRun : cur.nextRun,
  };
  db.prepare(
    `UPDATE automations SET
      name=?, enabled=?, workspace_id=?, trigger_type=?, trigger_config=?, action_type=?, action_config=?,
      prompt=?, expert_id=?, permission=?, connector=?, schedule_type=?, valid_from=?, valid_until=?,
      push_to_wxmp=?, last_run=?, next_run=?
    WHERE id=?`,
  ).run(
    merged.name,
    merged.enabled ? 1 : 0,
    merged.workspaceId,
    merged.triggerType,
    JSON.stringify(merged.triggerConfig),
    merged.actionType,
    JSON.stringify(merged.actionConfig),
    merged.prompt,
    merged.expertId,
    merged.permission,
    merged.connector,
    merged.scheduleType,
    merged.validFrom,
    merged.validUntil,
    merged.pushToWxmp ? 1 : 0,
    merged.lastRun,
    merged.nextRun,
    id,
  );
}

export function deleteAutomation(id: string): void {
  const db = getDb();
  db.prepare("DELETE FROM automations WHERE id = ?").run(id);
}

export function listRuns(automationId: string, limit = 50): AutomationRun[] {
  const db = getDb();
  return db.prepare(
    "SELECT id, automation_id as automationId, status, session_id as sessionId, summary, started_at as startedAt, finished_at as finishedAt FROM automation_runs WHERE automation_id = ? ORDER BY started_at DESC LIMIT ?",
  ).all(automationId, limit) as unknown as AutomationRun[];
}

export function createRun(automationId: string, sessionId: string | null, status: RunStatus = "queued"): AutomationRun {
  const db = getDb();
  const id = uuid();
  const now = Date.now();
  db.prepare(
    "INSERT INTO automation_runs (id, automation_id, status, session_id, summary, started_at, finished_at) VALUES (?, ?, ?, ?, NULL, ?, NULL)",
  ).run(id, automationId, status, sessionId, now);
  return { id, automationId, status, sessionId, summary: null, startedAt: now, finishedAt: null };
}

export function getRun(runId: string): AutomationRun | null {
  return getDb().prepare(
    "SELECT id, automation_id as automationId, status, session_id as sessionId, summary, started_at as startedAt, finished_at as finishedAt FROM automation_runs WHERE id = ?",
  ).get(runId) as unknown as AutomationRun | undefined ?? null;
}

export function getActiveRun(automationId: string): AutomationRun | null {
  return getDb().prepare(
    "SELECT id, automation_id as automationId, status, session_id as sessionId, summary, started_at as startedAt, finished_at as finishedAt FROM automation_runs WHERE automation_id = ? AND status IN ('queued','running','inProgress') ORDER BY started_at DESC LIMIT 1",
  ).get(automationId) as unknown as AutomationRun | undefined ?? null;
}

export function markRunRunning(runId: string): boolean {
  return getDb().prepare(
    "UPDATE automation_runs SET status='running' WHERE id=? AND status='queued'",
  ).run(runId).changes === 1;
}

export function finishRun(runId: string, status: TerminalRunStatus, summary: string | null): boolean {
  const db = getDb();
  return db.prepare("UPDATE automation_runs SET status=?, summary=?, finished_at=? WHERE id=? AND status IN ('queued','running','inProgress')")
    .run(status, summary, Date.now(), runId).changes === 1;
}

export function recoverInterruptedRuns(now = Date.now()): number {
  const db = getDb();
  const active = db.prepare(
    "SELECT id, session_id as sessionId FROM automation_runs WHERE status IN ('queued','running','inProgress')",
  ).all() as Array<{ id: string; sessionId: string | null }>;
  if (active.length === 0) return 0;
  const summary = "应用退出或任务中断，运行未正常完成";
  const finish = db.prepare(
    "UPDATE automation_runs SET status='timedOut', summary=?, finished_at=? WHERE id=? AND status IN ('queued','running','inProgress')",
  );
  const hasMessages = db.prepare("SELECT 1 FROM messages WHERE conversation_id=? LIMIT 1");
  const insertMessage = db.prepare(
    "INSERT INTO messages (id, conversation_id, role, content, is_error, created_at) VALUES (?, ?, 'assistant', ?, 1, ?)",
  );
  db.exec("BEGIN IMMEDIATE");
  try {
    for (const run of active) {
      finish.run(summary, now, run.id);
      if (run.sessionId && !hasMessages.get(run.sessionId)) {
        insertMessage.run(uuid(), run.sessionId, summary, now);
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return active.length;
}

/** 列出所有到期（next_run <= now）的启用 cron 自动化 */
export function listDueAutomations(now: number): Automation[] {
  const db = getDb();
  return (db.prepare("SELECT * FROM automations WHERE enabled=1 AND trigger_type='cron' AND next_run IS NOT NULL AND next_run <= ?").all(now) as any[]).map(rowToAutomation);
}

/** 列出所有启用的 cron 自动化（用于初始化 next_run） */
export function listEnabledCronAutomations(): Automation[] {
  const db = getDb();
  return (db.prepare("SELECT * FROM automations WHERE enabled=1 AND trigger_type='cron'").all() as any[]).map(rowToAutomation);
}

/** 列出所有启用的一次性自动化（once） */
export function listEnabledOnceAutomations(): Automation[] {
  const db = getDb();
  return (db.prepare("SELECT * FROM automations WHERE enabled=1 AND trigger_type='cron' AND schedule_type='once'").all() as any[]).map(rowToAutomation);
}

/** 列出所有启用的间隔自动化（interval） */
export function listEnabledIntervalAutomations(): Automation[] {
  const db = getDb();
  return (db.prepare("SELECT * FROM automations WHERE enabled=1 AND trigger_type='cron' AND schedule_type='interval'").all() as any[]).map(rowToAutomation);
}
