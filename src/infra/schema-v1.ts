import { createHash } from "node:crypto";
import type { DatabaseSync } from "node:sqlite";

const tables = `
    CREATE TABLE IF NOT EXISTS tool_audit_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      tool_name TEXT NOT NULL,
      args TEXT,
      is_error INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversations (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL DEFAULT '新对话',
      category TEXT NOT NULL DEFAULT 'assistant',
      model_provider TEXT DEFAULT 'deepseek',
      model_id TEXT DEFAULT 'deepseek-v4-flash',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_conversations_cat ON conversations(category);
    CREATE INDEX IF NOT EXISTS idx_conversations_updated ON conversations(updated_at);

    CREATE TABLE IF NOT EXISTS messages (
      id TEXT PRIMARY KEY,
      conversation_id TEXT NOT NULL,
      role TEXT NOT NULL,
      content TEXT NOT NULL,
      tool_name TEXT,
      tool_args TEXT,
      is_error INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );
    CREATE INDEX IF NOT EXISTS idx_messages_conv ON messages(conversation_id);

    CREATE TABLE IF NOT EXISTS message_content_parts (
      message_id TEXT NOT NULL,
      content_index INTEGER NOT NULL,
      part_type TEXT NOT NULL,
      content TEXT NOT NULL,
      PRIMARY KEY (message_id, content_index),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_message_content_parts_msg
      ON message_content_parts(message_id);

    CREATE TABLE IF NOT EXISTS attachments (
      id TEXT PRIMARY KEY,
      original_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      mime_type TEXT NOT NULL DEFAULT '',
      extension TEXT NOT NULL DEFAULT '',
      size INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS message_attachments (
      message_id TEXT NOT NULL,
      attachment_id TEXT NOT NULL,
      position INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (message_id, attachment_id),
      FOREIGN KEY (message_id) REFERENCES messages(id) ON DELETE CASCADE,
      FOREIGN KEY (attachment_id) REFERENCES attachments(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_message_attachments_message
      ON message_attachments(message_id, position);

    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      scope TEXT NOT NULL DEFAULT 'user',
      kind TEXT NOT NULL DEFAULT 'fact',
      content TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      conversation_id TEXT,
      file_name TEXT NOT NULL,
      file_path TEXT NOT NULL,
      kind TEXT NOT NULL DEFAULT 'docx',
      bytes INTEGER DEFAULT 0,
      created_at INTEGER NOT NULL,
      FOREIGN KEY (conversation_id) REFERENCES conversations(id)
    );
    CREATE INDEX IF NOT EXISTS idx_artifacts_conv ON artifacts(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_artifacts_created ON artifacts(created_at);

    CREATE TABLE IF NOT EXISTS settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS artifact_versions (
      artifact_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      file_path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (artifact_id, version),
      FOREIGN KEY (artifact_id) REFERENCES artifacts(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_versions_art ON artifact_versions(artifact_id);

    CREATE TABLE IF NOT EXISTS projects (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT DEFAULT '',
      dir_path TEXT DEFAULT '',
      color TEXT DEFAULT '#3b82f6',
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS workspaces (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      dir_path TEXT NOT NULL DEFAULT '',
      icon TEXT DEFAULT '📁',
      last_opened_at INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS conversation_forks (
      src TEXT NOT NULL,
      dst TEXT NOT NULL,
      from_msg TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (src, dst)
    );

    CREATE TABLE IF NOT EXISTS automations (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      workspace_id TEXT,
      trigger_type TEXT NOT NULL,
      trigger_config TEXT NOT NULL,
      action_type TEXT NOT NULL,
      action_config TEXT NOT NULL,
      prompt TEXT,
      expert_id TEXT,
      permission TEXT DEFAULT 'default',
      connector TEXT,
      schedule_type TEXT DEFAULT 'cron',
      valid_from INTEGER,
      valid_until INTEGER,
      push_to_wxmp INTEGER DEFAULT 0,
      last_run INTEGER,
      next_run INTEGER,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS automation_runs (
      id TEXT PRIMARY KEY,
      automation_id TEXT NOT NULL,
      status TEXT NOT NULL,
      session_id TEXT,
      summary TEXT,
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      FOREIGN KEY (automation_id) REFERENCES automations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_auto_runs_aid ON automation_runs(automation_id);

    CREATE TABLE IF NOT EXISTS file_snapshots (
      id TEXT PRIMARY KEY,
      original_path TEXT NOT NULL,
      snapshot_path TEXT NOT NULL,
      session_id TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_snap_path ON file_snapshots(original_path);

    CREATE TABLE IF NOT EXISTS auth_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      nick TEXT NOT NULL,
      avatar TEXT DEFAULT '',
      profile_json TEXT NOT NULL DEFAULT '{}',
      access_token TEXT NOT NULL,
      refresh_token TEXT DEFAULT '',
      logged_in_at INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS doc_chunks (
      id TEXT PRIMARY KEY,
      doc_path TEXT NOT NULL,
      chunk_index INTEGER NOT NULL,
      text TEXT NOT NULL,
      keywords TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_chunks_doc ON doc_chunks(doc_path);

    CREATE TABLE IF NOT EXISTS doc_documents (
      doc_path TEXT PRIMARY KEY,
      content_hash TEXT NOT NULL DEFAULT '',
      file_size INTEGER NOT NULL DEFAULT 0,
      modified_at INTEGER NOT NULL DEFAULT 0,
      indexed_at INTEGER NOT NULL,
      tracked INTEGER NOT NULL DEFAULT 0
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS doc_chunks_fts USING fts5(
      chunk_id UNINDEXED,
      doc_path UNINDEXED,
      chunk_index UNINDEXED,
      text,
      tokenize = 'unicode61'
    );

    CREATE TABLE IF NOT EXISTS connector_agent_sessions (
      parent_conversation_id TEXT NOT NULL,
      connector_id TEXT NOT NULL,
      child_conversation_id TEXT NOT NULL,
      catalog_version TEXT NOT NULL,
      installed_version TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      PRIMARY KEY (parent_conversation_id, connector_id),
      FOREIGN KEY (parent_conversation_id) REFERENCES conversations(id) ON DELETE CASCADE,
      FOREIGN KEY (child_conversation_id) REFERENCES conversations(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_agent_sessions_child
      ON connector_agent_sessions(child_conversation_id);

    CREATE TABLE IF NOT EXISTS usage_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      conversation_id TEXT,
      provider TEXT,
      model TEXT,
      input_tokens INTEGER DEFAULT 0,
      output_tokens INTEGER DEFAULT 0,
      total_tokens INTEGER DEFAULT 0,
      cost REAL DEFAULT 0,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_usage_conv ON usage_logs(conversation_id);
    CREATE INDEX IF NOT EXISTS idx_usage_created ON usage_logs(created_at);
  `;
const columns = [
  [
    "conversations",
    "project_id",
    "TEXT"
  ],
  [
    "conversations",
    "expert_id",
    "TEXT"
  ],
  [
    "conversations",
    "expert_revision",
    "TEXT"
  ],
  [
    "conversations",
    "expert_catalog_source",
    "TEXT"
  ],
  [
    "conversations",
    "expert_operation",
    "TEXT"
  ],
  [
    "conversations",
    "expert_target_id",
    "TEXT"
  ],
  [
    "conversations",
    "expert_target_revision",
    "TEXT"
  ],
  [
    "conversations",
    "expert_draft_root",
    "TEXT"
  ],
  [
    "conversations",
    "expert_notice",
    "TEXT"
  ],
  [
    "conversations",
    "skill_operation",
    "TEXT"
  ],
  [
    "conversations",
    "skill_target_name",
    "TEXT"
  ],
  [
    "conversations",
    "workspace_id",
    "TEXT"
  ],
  [
    "conversations",
    "parent_id",
    "TEXT"
  ],
  [
    "conversations",
    "core_session_path",
    "TEXT"
  ],
  [
    "memories",
    "session_id",
    "TEXT"
  ],
  [
    "auth_sessions",
    "profile_json",
    "TEXT NOT NULL DEFAULT '{}'"
  ],
  [
    "messages",
    "branch_id",
    "TEXT DEFAULT 'main'"
  ],
  [
    "messages",
    "parent_id",
    "TEXT"
  ],
  [
    "doc_chunks",
    "embedding",
    "BLOB"
  ],
  [
    "doc_chunks",
    "content_hash",
    "TEXT DEFAULT ''"
  ],
  [
    "doc_chunks",
    "line_start",
    "INTEGER DEFAULT 1"
  ],
  [
    "doc_chunks",
    "line_end",
    "INTEGER DEFAULT 1"
  ],
  [
    "conversations",
    "category",
    "TEXT NOT NULL DEFAULT 'assistant'"
  ],
  [
    "conversations",
    "status",
    "TEXT NOT NULL DEFAULT 'idle'"
  ],
  [
    "automations",
    "workspace_id",
    "TEXT"
  ],
  [
    "automations",
    "prompt",
    "TEXT"
  ],
  [
    "automations",
    "expert_id",
    "TEXT"
  ],
  [
    "automations",
    "permission",
    "TEXT DEFAULT 'default'"
  ],
  [
    "automations",
    "connector",
    "TEXT"
  ],
  [
    "automations",
    "schedule_type",
    "TEXT DEFAULT 'cron'"
  ],
  [
    "automations",
    "valid_from",
    "INTEGER"
  ],
  [
    "automations",
    "valid_until",
    "INTEGER"
  ],
  [
    "automations",
    "push_to_wxmp",
    "INTEGER DEFAULT 0"
  ]
];
const indexes = [
  "CREATE INDEX IF NOT EXISTS idx_memories_scope_updated ON memories(scope, updated_at)",
  "CREATE INDEX IF NOT EXISTS idx_memories_working_session ON memories(scope, session_id, created_at)",
  "CREATE INDEX IF NOT EXISTS idx_memories_updated ON memories(updated_at)"
];
export const SCHEMA_VERSION = 1;
export const SCHEMA_CHECKSUM = createHash("sha256").update(JSON.stringify({ tables, columns, indexes })).digest("hex");

/** Version one adopts existing installations by adding only missing columns. */
export function applySchemaV1(db: DatabaseSync): void {
  db.exec(tables);
  for (const [table, name, definition] of columns) {
    const existing = db.prepare(`PRAGMA table_info(${table})`).all();
    if (!existing.some((column) => column.name === name)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${name} ${definition}`);
  }
  for (const sql of indexes) db.exec(sql);
}
