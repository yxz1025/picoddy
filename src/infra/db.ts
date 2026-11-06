// src/infra/db.ts
// node:sqlite 封装（spike 验证 DatabaseSync 可用，替代 better-sqlite3）
// MVP：初始化 + tool_audit_log 表验证连通。完整 schema 见 03 文档 §六

import { DatabaseSync } from "node:sqlite";
import { statSync, mkdirSync, readFileSync } from "node:fs";

import { platformPaths } from "../platform/paths.ts";
import { startOperation } from "./operation_log.ts";
import { checkpointAndClose, backupClosedDatabase } from "./update-backup.ts";
import { SCHEMA_CHECKSUM as V1_CHECKSUM, applySchemaV1 } from "./schema-v1.ts";
import { SCHEMA_VERSION, SCHEMA_CHECKSUM, applySchemaV2 } from "./schema-v2.ts";

let db: DatabaseSync | null = null;
let updateFrozen = false;


const DATA_DIR = platformPaths.appDataDir;
const DB_PATH = platformPaths.join(DATA_DIR, "pi-a.db");

/** 初始化数据库（幂等） */
function initDbInternal(): DatabaseSync {
  if (updateFrozen) throw new Error("TASK_BUSY");
  if (db) return db;

  // 确保 data 目录存在
  try {
    mkdirSync(DATA_DIR, { recursive: true });
  } catch { /* 已存在 */ }

  // sqlite-vec is an optional acceleration layer. Extension loading is
  // enabled here; the RAG runtime catches unsupported platforms and falls
  // back to SQLite FTS5.
  db = new DatabaseSync(DB_PATH, { allowExtension: true, timeout: 5000 });
  const version = Number(db.prepare("PRAGMA user_version").get()!.user_version);
  if (version > SCHEMA_VERSION) { db.close(); db = null; throw new Error("数据库版本高于当前应用支持范围，请安装较新版本"); }
  if (version === 1) {
    const row = db.prepare("SELECT checksum FROM schema_migrations WHERE version=1").get();
    if (row?.checksum !== V1_CHECKSUM) { db.close(); db = null; throw new Error("数据库迁移校验失败"); }
  }
  if (version === SCHEMA_VERSION) {
    const row = db.prepare("SELECT checksum FROM schema_migrations WHERE version=?").get(SCHEMA_VERSION);
    if (row?.checksum !== SCHEMA_CHECKSUM) { db.close(); db = null; throw new Error("数据库迁移校验失败"); }
    db.exec("PRAGMA journal_mode = WAL;");
    db.exec("PRAGMA foreign_keys = ON;");
    return db;
  }
  // Manual reinstall and IT distribution also pass through this pre-migration backup.
  const hasTables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' LIMIT 1").get();
  if (hasTables) {
    checkpointAndClose(db); db = null;
    backupClosedDatabase(DATA_DIR, "before-schema-2");
    db = new DatabaseSync(DB_PATH, { allowExtension: true, timeout: 5000 });
  }
  db.exec("PRAGMA journal_mode = WAL;");
  db.exec("PRAGMA foreign_keys = ON;");

  db.exec("BEGIN IMMEDIATE");
  try {
    if (version < 1) applySchemaV1(db);
    db.exec("CREATE TABLE IF NOT EXISTS schema_migrations(version INTEGER PRIMARY KEY, checksum TEXT NOT NULL, appliedAt TEXT NOT NULL)");
    if (version < 1) db.prepare("INSERT INTO schema_migrations VALUES(?, ?, ?)").run(1, V1_CHECKSUM, new Date().toISOString());
    applySchemaV2(db);
    db.prepare("INSERT INTO schema_migrations VALUES(?, ?, ?)").run(SCHEMA_VERSION, SCHEMA_CHECKSUM, new Date().toISOString());
    db.exec(`PRAGMA user_version = ${SCHEMA_VERSION}`);
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    db.close();
    db = null;
    throw error;
  }
  console.log(`[db] 已初始化: ${DB_PATH}`);
  return db;
}

export function initDb(): DatabaseSync {
  const wasInitialized = db !== null;
  const operation = startOperation("database.init", { path: DB_PATH });
  try {
    const result = initDbInternal();
    operation.success({ reused: wasInitialized });
    return result;
  } catch (error) {
    if (db) { try { db.exec("ROLLBACK"); } catch {} try { db.close(); } catch {} db = null; }
    operation.error(error);
    throw error;
  }
}

export function getDb(): DatabaseSync {
  if (!db) return initDb();
  return db;
}

/** 记录工具调用审计 */
export function logToolAudit(toolName: string, args: unknown, isError: boolean): void {
  try {
    const d = getDb();
    d.prepare(
      "INSERT INTO tool_audit_log (tool_name, args, is_error, created_at) VALUES (?, ?, ?, ?)",
    ).run(toolName, JSON.stringify(args ?? {}), isError ? 1 : 0, Date.now());
  } catch (e) {
    console.warn("[db] 审计写入失败:", (e as Error).message);
  }
}

export function closeDb(): void {
  if (db) {
    db.close();
    db = null;
  }
}

export function freezeDatabaseForUpdate(version: string): string {
  updateFrozen = true;
  try {
    if (db) { const current = db; checkpointAndClose(current); db = null; }
    return backupClosedDatabase(DATA_DIR, version);
  } catch (error) { updateFrozen = false; throw error; }
}
export function resumeDatabaseAfterUpdate(): void {
  updateFrozen = false;
  getDb();
}
