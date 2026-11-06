// src/domains/settings/node/store.ts
// 全局设置存储。基于 SQLite settings 表。

import { getDb } from "../../../infra/db.ts";
import { keepAwakeManager } from "../../../platform/power.ts";

/** 获取配置项，若不存在则返回默认值 */
export function getSetting(key: string, defaultVal: string): string {
  try {
    const db = getDb();
    const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
    return row ? row.value : defaultVal;
  } catch (e) {
    console.warn(`[settings] 读取 ${key} 失败:`, (e as Error).message);
    return defaultVal;
  }
}

/** 开启/关闭系统锁屏防睡眠。 */
export function applyKeepAwake(enabled: boolean) {
  void keepAwakeManager.setEnabled(enabled).catch((e) => {
    console.warn("[keep-awake] 更新防休眠状态失败:", (e as Error).message);
  });
}

/** 写入/更新配置项 */
export function setSetting(key: string, val: string): void {
  try {
    const db = getDb();
    db.prepare(
      "INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = ?",
    ).run(key, val, val);

    if (key === "keep_awake") {
      applyKeepAwake(val === "true");
    }
  } catch (e) {
    console.warn(`[settings] 写入 ${key} 失败:`, (e as Error).message);
  }
}
