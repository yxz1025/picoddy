import { DatabaseSync } from "node:sqlite";
import { copyFileSync, existsSync, renameSync, openSync, closeSync, fsyncSync } from "node:fs";
import { join } from "node:path";
import { backupClosedDatabase, checkpointAndClose } from "../../infra/update-backup.ts";
import { SCHEMA_VERSION } from "../../infra/schema-v2.ts";

/** Only callable before application services start, after explicit native confirmation. */
export function restoreBackup(dataDir: string, backupId: string, version: string): string {
  if (!/^backup-[a-f\d-]{36}$/.test(backupId)) throw new Error("Invalid backup ID");
  const source = join(dataDir, "updates", "backups", backupId, "pi-a.db");
  const check = new DatabaseSync(source, { readOnly: true });
  try {
    const rows = check.prepare("PRAGMA integrity_check").all();
    if (rows.length !== 1 || Object.values(rows[0])[0] !== "ok") throw new Error("Invalid backup database");
    if (Number(check.prepare("PRAGMA user_version").get()!.user_version) > SCHEMA_VERSION) throw new Error("Backup requires a newer application");
  } finally { check.close(); }
  const database = join(dataDir, "pi-a.db");
  if (existsSync(database)) checkpointAndClose(new DatabaseSync(database));
  const savedCurrent = backupClosedDatabase(dataDir, version);
  const replacement = join(dataDir, "pi-a.db.restore");
  copyFileSync(source, replacement);
  const fd = openSync(replacement, "r+");
  try { fsyncSync(fd); } finally { closeSync(fd); }
  renameSync(replacement, database);
  return savedCurrent;
}
