import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { atomicJson, readJson } from "./storage.ts";
import type { Release, UpdateJournal } from "./types.ts";

export class Journal {
  private path: string;
  constructor(root: string) { this.path = join(root, "journal.json"); }
  read(): UpdateJournal | undefined {
    const record = readJson<UpdateJournal>(this.path);
    if (!record) return;
    if (record.schemaVersion !== 1 || typeof record.toVersion !== "string" || !Number.isInteger(record.bootAttempts) ||
        !/^backup-[a-f\d-]{36}$/.test(record.backupId) ||
        !["install-requested", "verifying", "healthy", "install-incomplete", "recovery-required"].includes(record.phase)) throw new Error("BOOT_FAILED");
    return record;
  }
  request(fromVersion: string, release: Release, backupId: string) {
    atomicJson(this.path, { schemaVersion: 1, attemptId: randomUUID(), releaseId: release.releaseId, fromVersion,
      toVersion: release.version, phase: "install-requested", backupId, requestedAt: new Date().toISOString(), bootAttempts: 0, healthyAt: null } satisfies UpdateJournal);
  }
  boot(version: string): "normal" | "verifying" | "incomplete" | "recovery" {
    const record = this.read();
    if (!record || record.phase === "healthy") return "normal";
    // A manual DMG replacement may happen after the old version was reopened.
    // Keep the target pending so that replacement still receives health checks.
    if (record.phase === "install-incomplete" && record.toVersion !== version) return "normal";
    if (record.toVersion !== version) {
      if (record.fromVersion === version) { atomicJson(this.path, { ...record, phase: "install-incomplete" }); return "incomplete"; }
      // A manual repair with a different version still runs database compatibility checks.
      atomicJson(this.path, { ...record, phase: "install-incomplete" }); return "normal";
    }
    if (record.bootAttempts >= 2 || record.phase === "recovery-required") return "recovery";
    atomicJson(this.path, { ...record, phase: "verifying", bootAttempts: record.bootAttempts + 1 });
    return "verifying";
  }
  healthy() {
    const record = this.read();
    if (record?.phase === "verifying") atomicJson(this.path, { ...record, phase: "healthy", healthyAt: new Date().toISOString() });
  }
  failed() {
    const record = this.read();
    if (record?.phase === "verifying") atomicJson(this.path, { ...record, phase: "recovery-required" });
  }
  retry() {
    const record = this.read();
    if (record) atomicJson(this.path, { ...record, bootAttempts: 0, phase: "install-requested" });
  }
}
