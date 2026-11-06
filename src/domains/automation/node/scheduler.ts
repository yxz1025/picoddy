import { updateGate } from "../../../infra/update-gate.ts";
// src/domains/automation/node/scheduler.ts
// 自动化调度器。对照 08 计划功能 8 + 参考设计 子系统⑬。
// 30s 扫描一次，对 next_run <= now 的 cron 自动化触发执行。
// cron 解析：5 段 "分 时 日 月 周"，支持 * / 数字 / */n / a-b / a,b。

import {
  type Automation,
  listDueAutomations,
  listEnabledCronAutomations,
  listEnabledIntervalAutomations,
  listEnabledOnceAutomations,
  recoverInterruptedRuns,
  updateAutomation,
} from "./store.ts";
import { claimAutomationRun, AutomationAlreadyRunningError } from "./coordinator.ts";
import { executeAutomationRun, superviseAutomationRun } from "./executor.ts";

let timer: ReturnType<typeof setInterval> | null = null;
let scanRunning = false;

/** 简单 cron 字段匹配：field 是 cron 段，value 是当前值 */
function matchField(field: string, value: number): boolean {
  if (field === "*") return true;
  if (field.startsWith("*/")) {
    const step = parseInt(field.slice(2), 10);
    return step > 0 && value % step === 0;
  }
  if (field.includes(",")) {
    return field.split(",").some((f) => matchField(f, value));
  }
  if (field.includes("-")) {
    const [a, b] = field.split("-").map(Number);
    return value >= a && value <= b;
  }
  return parseInt(field, 10) === value;
}

/** 判断 cron 表达式是否匹配给定时间 */
export function matchCron(expr: string, d: Date): boolean {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return false;
  const [m, h, dom, mon, dow] = parts;
  return matchField(m, d.getMinutes()) &&
    matchField(h, d.getHours()) &&
    matchField(dom, d.getDate()) &&
    matchField(mon, d.getMonth() + 1) &&
    matchField(dow, d.getDay());
}

/** 计算从 from 之后下一个匹配 cron 的时间（分钟级，最多扫 7 天） */
export function nextCronTime(expr: string, from: Date): Date | null {
  const t = new Date(from);
  t.setSeconds(0, 0);
  t.setMinutes(t.getMinutes() + 1); // 从下一分钟开始
  const limit = from.getTime() + 7 * 24 * 60 * 60 * 1000;
  while (t.getTime() < limit) {
    if (matchCron(expr, t)) return t;
    t.setMinutes(t.getMinutes() + 1);
  }
  return null;
}

/** 检查自动化是否在有效日期范围内 */
function isWithinValidity(a: Automation, now: number): boolean {
  if (a.validFrom && now < a.validFrom) return false;
  if (a.validUntil && now > a.validUntil) return false;
  return true;
}

/** 领取并派发到后台执行器；不等待 Agent 完成。 */
async function dispatchScheduledAutomation(a: Automation): Promise<void> {
  try {
    const claimed = await claimAutomationRun(a.id, "scheduled");
    superviseAutomationRun(executeAutomationRun(
      claimed.automation,
      claimed.run.id,
      claimed.run.sessionId!,
      claimed.prompt,
    ));
  } catch (error) {
    if (error instanceof AutomationAlreadyRunningError) return;
    console.error(`[scheduler] 自动化派发失败: ${a.name}`, error);
  }
}

/** 初始化自动化的 next_run */
export function initAutomationNextRun(a: Automation): void {
  if (!a.enabled || a.triggerType !== "cron") return;
  const now = Date.now();
  if (!isWithinValidity(a, now)) return;
  if (a.scheduleType === "once") {
    const t = a.triggerConfig.onceAt;
    if (t && t > now) updateAutomation(a.id, { nextRun: t });
    else if (t && t <= now) {
      updateAutomation(a.id, { nextRun: null, enabled: false });
    }
  } else if (a.scheduleType === "interval") {
    const mins = a.triggerConfig.intervalMinutes ?? 30;
    updateAutomation(a.id, { nextRun: now + mins * 60 * 1000 });
  } else if (a.scheduleType === "cron" && a.triggerConfig.cron) {
    const nt = nextCronTime(a.triggerConfig.cron, new Date());
    if (nt) updateAutomation(a.id, { nextRun: nt.getTime() });
  }
}

/** 启动调度器（应用启动时调用一次） */
export function startScheduler(recover = true): void {
  if (timer !== null) return;
  const recovered = recover ? recoverInterruptedRuns() : 0;
  if (recovered > 0) console.warn(`[scheduler] 已收敛 ${recovered} 个中断的自动化运行`);
  // 初始化所有启用自动化的 next_run（若为空）
  for (const a of listEnabledCronAutomations()) {
    if (a.nextRun === null) initAutomationNextRun(a);
  }
  for (const a of listEnabledIntervalAutomations()) {
    if (a.nextRun === null) initAutomationNextRun(a);
  }
  for (const a of listEnabledOnceAutomations()) {
    if (a.nextRun === null) initAutomationNextRun(a);
  }
  timer = setInterval(async () => {
    if (scanRunning || updateGate.draining) return;
    scanRunning = true;
    try {
      const now = Date.now();
      const due = listDueAutomations(now).filter((a) => isWithinValidity(a, now));
      for (const a of due) {
        if (updateGate.draining) break;
        console.log(`[scheduler] 触发自动化: ${a.name}`);
        await updateGate.run("automation", () => dispatchScheduledAutomation(a));
      }
    } finally {
      scanRunning = false;
    }
  }, 30000);
  console.log("[scheduler] 自动化调度器已启动（30s 扫描）");
}

export function stopScheduler(): void {
  if (timer !== null) {
    clearInterval(timer);
    timer = null;
  }
}
