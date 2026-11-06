import { DatabaseSync } from "node:sqlite";
import { closeSync, copyFileSync, existsSync, fsyncSync, mkdirSync, openSync, statSync } from "node:fs";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { atomicJson } from "../electron/updates/storage.ts";

function durableCopy(source: string, target: string): void {
  copyFileSync(source, target);
  const fd = openSync(target, "r+");
  try { fsyncSync(fd); } finally { closeSync(fd); }
}

/** Called with all application writers quiesced; checkpoint may still detect an external reader. */
export function checkpointAndClose(database: DatabaseSync): void {
  const row = database.prepare("PRAGMA wal_checkpoint(TRUNCATE)").get() as { busy: number };
  if (row.busy !== 0) throw new Error("BACKUP_FAILED");
  database.close();
}
export function backupClosedDatabase(dataDir: string, version: string): string {
  const id = `backup-${randomUUID()}`;
  const destination = join(dataDir, "updates", "backups", id);
  mkdirSync(destination, { recursive: true, mode: 0o700 });
  const source = join(dataDir, "pi-a.db");
  if (existsSync(source)) {
    const wal = `${source}-wal`;
    if (existsSync(wal) && statSync(wal).size !== 0) throw new Error("BACKUP_FAILED");
    const target = join(destination, "pi-a.db");
    durableCopy(source, target);
    const check = new DatabaseSync(target, { readOnly: true });
    try {
      const rows = check.prepare("PRAGMA integrity_check").all();
      if (rows.length !== 1 || Object.values(rows[0])[0] !== "ok") throw new Error("BACKUP_FAILED");
    } finally { check.close(); }
  }
  // Settings and credential values are in SQLite; copy only known configuration files.
  for (const name of ["mcp.json", "config.json"]) {
    const sourceFile = join(dataDir, name);
    if (existsSync(sourceFile)) durableCopy(sourceFile, join(destination, name));
  }
  atomicJson(join(destination, "backup.json"), { schemaVersion: 1, id, version, createdAt: new Date().toISOString() });
  return id;
}
