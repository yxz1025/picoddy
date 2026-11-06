import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

const sql = `
CREATE TABLE IF NOT EXISTS requirement_spaces (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  tapd_origin TEXT NOT NULL,
  tapd_workspace_id TEXT NOT NULL,
  tapd_story_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(account_id, tapd_origin, tapd_workspace_id, tapd_story_id)
);
CREATE TABLE IF NOT EXISTS requirement_work_items (
  id TEXT PRIMARY KEY,
  space_id TEXT NOT NULL REFERENCES requirement_spaces(id),
  title TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(id, space_id)
);
CREATE TABLE IF NOT EXISTS requirement_conversations (
  conversation_id TEXT PRIMARY KEY REFERENCES conversations(id) ON DELETE CASCADE,
  space_id TEXT NOT NULL REFERENCES requirement_spaces(id),
  work_item_id TEXT,
  request_key TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  FOREIGN KEY(work_item_id, space_id) REFERENCES requirement_work_items(id, space_id),
  UNIQUE(space_id, request_key)
);
CREATE INDEX IF NOT EXISTS idx_requirement_conversations_space
  ON requirement_conversations(space_id, work_item_id);
`;

export const SCHEMA_VERSION = 2;
export const SCHEMA_CHECKSUM = createHash("sha256").update(sql).digest("hex");
export function applySchemaV2(db: DatabaseSync): void { db.exec(sql); }
