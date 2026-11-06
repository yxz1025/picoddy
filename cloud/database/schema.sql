CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  provider text NOT NULL DEFAULT 'cas' CHECK (provider = 'cas'),
  subject text NOT NULL,
  email text,
  name text NOT NULL,
  avatar text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
  disabled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_identity_unique ON users (provider, subject);

CREATE TABLE sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  gateway_secret text,
  browser_hash text,
  expires_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX sessions_owner_id_idx ON sessions (owner_id);
CREATE INDEX sessions_browser_idx ON sessions (browser_hash);
CREATE INDEX sessions_expires_at_idx ON sessions (expires_at);

CREATE TABLE auth_challenges (
  state_hash text PRIMARY KEY,
  browser_hash text NOT NULL,
  address_hash text NOT NULL,
  service_url text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked boolean NOT NULL DEFAULT false
);
CREATE INDEX auth_challenges_expiry_idx ON auth_challenges (expires_at);
CREATE INDEX auth_challenges_address_idx ON auth_challenges (address_hash, created_at);

CREATE TABLE resources (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  UNIQUE (id, owner_id),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (
    kind IN ('skill', 'expert', 'connector', 'model', 'workspace', 'memory', 'automation')
  ),
  name text NOT NULL,
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  secret text,
  deleted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX resources_owner_kind_idx
  ON resources (owner_id, kind, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX resources_skill_name_unique
  ON resources (owner_id, lower(name))
  WHERE kind = 'skill' AND deleted_at IS NULL;

CREATE TABLE skill_versions (
  skill_id uuid NOT NULL,
  FOREIGN KEY (skill_id, owner_id) REFERENCES resources(id, owner_id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  version text NOT NULL,
  description text NOT NULL DEFAULT '',
  files jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (skill_id, version)
);
CREATE INDEX skill_versions_owner_idx ON skill_versions (owner_id, skill_id, created_at DESC);

CREATE TABLE conversations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  UNIQUE (id, owner_id),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title text NOT NULL,
  category text NOT NULL DEFAULT 'assistant' CHECK (category IN ('assistant','skill_creator','expert_creator')),
  expert_id uuid,
  expert_revision text,
  parent_id uuid,
  FOREIGN KEY (parent_id,owner_id) REFERENCES conversations(id,owner_id) ON DELETE SET NULL (parent_id),
  FOREIGN KEY (expert_id, owner_id) REFERENCES resources(id, owner_id) ON DELETE SET NULL (expert_id),
  workspace_id uuid,
  FOREIGN KEY (workspace_id, owner_id) REFERENCES resources(id, owner_id) ON DELETE SET NULL (workspace_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX conversations_owner_updated_idx
  ON conversations (owner_id, updated_at DESC);

CREATE TABLE skill_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL UNIQUE,
  FOREIGN KEY (conversation_id, owner_id) REFERENCES conversations(id, owner_id) ON DELETE CASCADE,
  skill_id uuid,
  FOREIGN KEY (skill_id, owner_id) REFERENCES resources(id, owner_id),
  base_version text,
  skill_name text,
  revision integer NOT NULL DEFAULT 0 CHECK (revision>=0),
  status text NOT NULL DEFAULT 'editing' CHECK (status IN ('editing','valid','installed')),
  files jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(files)='array'),
  validation jsonb,
  validated_revision integer,
  published_version text,
  installed_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX skill_drafts_owner ON skill_drafts(owner_id,conversation_id);

CREATE TABLE expert_drafts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid UNIQUE NOT NULL,
  FOREIGN KEY (conversation_id,owner_id) REFERENCES conversations(id,owner_id) ON DELETE CASCADE,
  operation text NOT NULL DEFAULT 'create' CHECK (operation IN ('create','edit')),
  expert_id uuid,
  FOREIGN KEY (expert_id,owner_id) REFERENCES resources(id,owner_id),
  base_revision text,
  revision integer NOT NULL DEFAULT 0 CHECK(revision>=0),
  status text NOT NULL DEFAULT 'editing' CHECK(status IN ('editing','valid','published')),
  profile jsonb NOT NULL DEFAULT '{"name":"","prompt":"","skillIds":[],"description":"","tags":[],"quickPrompts":[],"icon":"🤖","categoryId":"cloud"}'::jsonb,
  preserved_data jsonb NOT NULL DEFAULT '{}'::jsonb,
  validation jsonb,
  validated_revision integer,
  published_revision text,
  published_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX expert_drafts_owner ON expert_drafts(owner_id,conversation_id);

CREATE TABLE runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  UNIQUE (id, owner_id),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  FOREIGN KEY (conversation_id, owner_id) REFERENCES conversations(id, owner_id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (
    status IN (
      'queued', 'provisioning', 'running', 'waiting_approval', 'cancelling',
      'cleanup_pending', 'interrupted', 'succeeded', 'failed', 'cancelled'
    )
  ),
  prompt text NOT NULL,
  selection jsonb NOT NULL,
  idempotency_key text NOT NULL,
  parent_run_id uuid,
  parent_tool_call_id text,
  child_index integer CHECK (child_index BETWEEN 0 AND 7),
  FOREIGN KEY (parent_run_id,owner_id) REFERENCES runs(id,owner_id) ON DELETE SET NULL (parent_run_id),
  UNIQUE (parent_run_id,parent_tool_call_id,child_index),
  CHECK ((parent_tool_call_id IS NULL AND child_index IS NULL) OR
    (parent_tool_call_id IS NOT NULL AND child_index IS NOT NULL)),
  started_at timestamptz,
  finished_at timestamptz,
  cleanup_target_status text,
  cleanup_after timestamptz,
  lease_token uuid,
  lease_until timestamptz,
  cancel_requested boolean NOT NULL DEFAULT false,
  sandbox_id text,
  error text,
  usage jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, conversation_id, idempotency_key)
);
CREATE UNIQUE INDEX runs_one_active_per_conversation_idx
  ON runs (owner_id, conversation_id)
  WHERE status IN (
    'queued', 'provisioning', 'running', 'waiting_approval', 'cancelling', 'cleanup_pending'
  );
CREATE INDEX runs_claim_idx ON runs (created_at)
  WHERE status = 'queued' AND cancel_requested = false;
CREATE INDEX runs_lease_idx ON runs (lease_until)
  WHERE status IN ('provisioning', 'running', 'waiting_approval', 'cancelling', 'cleanup_pending');
CREATE INDEX runs_owner_conversation_idx
  ON runs (owner_id, conversation_id, created_at DESC);

CREATE TABLE messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  FOREIGN KEY (conversation_id, owner_id) REFERENCES conversations(id, owner_id) ON DELETE CASCADE,
  run_id uuid,
  FOREIGN KEY (run_id, owner_id) REFERENCES runs(id, owner_id) ON DELETE SET NULL (run_id),
  content jsonb NOT NULL,
  runtime_sequence bigint GENERATED ALWAYS AS IDENTITY,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX messages_conversation_idx
  ON messages (owner_id, conversation_id, created_at, id);

CREATE TABLE events (
  id bigserial PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  FOREIGN KEY (run_id, owner_id) REFERENCES runs(id, owner_id) ON DELETE CASCADE,
  type text NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_run_cursor_idx ON events (owner_id, run_id, id);

CREATE TABLE files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id uuid,
  FOREIGN KEY (run_id, owner_id) REFERENCES runs(id, owner_id) ON DELETE SET NULL (run_id),
  name text NOT NULL,
  mime_type text NOT NULL,
  object_key text NOT NULL UNIQUE,
  size bigint NOT NULL CHECK (size >= 0),
  sha256 text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX files_owner_created_idx ON files (owner_id, created_at DESC);

CREATE TABLE approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  FOREIGN KEY (run_id, owner_id) REFERENCES runs(id, owner_id) ON DELETE CASCADE,
  tool_call_id text NOT NULL,
  tool text NOT NULL,
  input jsonb NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'denied')),
  created_at timestamptz NOT NULL DEFAULT now(),
  decided_at timestamptz,
  UNIQUE (run_id, tool_call_id)
);
CREATE INDEX approvals_run_idx ON approvals (owner_id, run_id, created_at);

CREATE TABLE automation_runs (
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  automation_id uuid NOT NULL,
  FOREIGN KEY (automation_id, owner_id) REFERENCES resources(id, owner_id) ON DELETE CASCADE,
  scheduled_for timestamptz NOT NULL,
  run_id uuid,
  FOREIGN KEY (run_id, owner_id) REFERENCES runs(id, owner_id) ON DELETE SET NULL (run_id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (automation_id, scheduled_for)
);

CREATE INDEX runs_cleanup_due_idx ON runs (updated_at) WHERE status='cleanup_pending';

-- AgentSession checkpoints are control-plane state, never a sandbox filesystem.
CREATE INDEX messages_runtime_cursor ON messages(owner_id, conversation_id, runtime_sequence);
CREATE TABLE session_runtime (
  conversation_id uuid PRIMARY KEY,
  FOREIGN KEY (conversation_id, owner_id) REFERENCES conversations(id, owner_id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  transcript_cursor bigint NOT NULL,
  entries jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX session_runtime_owner ON session_runtime(owner_id, conversation_id);

CREATE TABLE file_deletions (
  id uuid PRIMARY KEY,
  object_key text NOT NULL UNIQUE,
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  lease_token uuid,
  lease_until timestamptz,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((lease_token IS NULL) = (lease_until IS NULL))
);

CREATE INDEX file_deletions_claim_idx
  ON file_deletions (attempts, next_attempt_at, lease_until, id);

CREATE TABLE user_preferences (
  owner_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  data jsonb NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(data)='object'),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE rag_documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  FOREIGN KEY (conversation_id, owner_id) REFERENCES conversations(id, owner_id) ON DELETE CASCADE,
  source_path text NOT NULL CHECK (
    length(source_path) BETWEEN 12 AND 1024 AND source_path LIKE '/workspace/%'
  ),
  source_name text NOT NULL CHECK (length(source_name) BETWEEN 1 AND 255),
  content_hash text NOT NULL CHECK (content_hash ~ '^[a-f0-9]{64}$'),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  source_size bigint NOT NULL CHECK (source_size >= 0),
  source_modified_at timestamptz,
  chunk_count integer NOT NULL DEFAULT 0 CHECK (chunk_count BETWEEN 0 AND 1000),
  embedding_status text NOT NULL CHECK (embedding_status IN ('hybrid', 'bm25')),
  embedding_model text NOT NULL,
  embedding_error text,
  indexed_by_run_id uuid,
  FOREIGN KEY (indexed_by_run_id, owner_id) REFERENCES runs(id, owner_id) ON DELETE SET NULL (indexed_by_run_id),
  indexed_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, conversation_id, source_path),
  UNIQUE (id, owner_id, conversation_id)
);

CREATE INDEX rag_documents_scope_idx
  ON rag_documents (owner_id, conversation_id, indexed_at DESC, id);

CREATE TABLE rag_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  document_id uuid NOT NULL,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  conversation_id uuid NOT NULL,
  FOREIGN KEY (conversation_id, owner_id) REFERENCES conversations(id, owner_id) ON DELETE CASCADE,
  document_version integer NOT NULL CHECK (document_version > 0),
  chunk_index integer NOT NULL CHECK (chunk_index BETWEEN 0 AND 999),
  text text NOT NULL CHECK (octet_length(text) BETWEEN 1 AND 16384),
  line_start integer NOT NULL CHECK (line_start > 0),
  line_end integer NOT NULL CHECK (line_end >= line_start),
  page integer CHECK (page > 0),
  embedding double precision[],
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (document_id, owner_id, conversation_id)
    REFERENCES rag_documents(id, owner_id, conversation_id) ON DELETE CASCADE,
  UNIQUE (document_id, document_version, chunk_index),
  CHECK (embedding IS NULL OR cardinality(embedding) = 384)
);

CREATE INDEX rag_chunks_scope_idx
  ON rag_chunks (owner_id, conversation_id, document_id, chunk_index);

CREATE INDEX rag_chunks_vectors_idx
  ON rag_chunks (owner_id, conversation_id)
  WHERE embedding IS NOT NULL;

CREATE TABLE workspace_heads (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  workspace_id uuid UNIQUE,
  conversation_id uuid UNIQUE,
  revision integer NOT NULL DEFAULT 0 CHECK (revision >= 0),
  manifest jsonb NOT NULL DEFAULT '[]' CHECK (jsonb_typeof(manifest)='array'),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (id, owner_id),
  CHECK ((workspace_id IS NULL) <> (conversation_id IS NULL)),
  CHECK (id=coalesce(workspace_id, conversation_id)),
  FOREIGN KEY (workspace_id, owner_id) REFERENCES resources(id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (conversation_id, owner_id) REFERENCES conversations(id, owner_id) ON DELETE CASCADE
);

CREATE TABLE workspace_versions (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id),
  scope_id uuid NOT NULL,
  run_id uuid,
  expected_revision integer NOT NULL CHECK (expected_revision >= 0),
  committed_revision integer,
  status text NOT NULL CHECK (status IN ('staging', 'committed', 'conflict')),
  manifest jsonb NOT NULL CHECK (jsonb_typeof(manifest)='array'),
  created_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (scope_id, owner_id) REFERENCES workspace_heads(id, owner_id) ON DELETE CASCADE,
  FOREIGN KEY (run_id, owner_id) REFERENCES runs(id, owner_id) ON DELETE SET NULL (run_id),
  UNIQUE (scope_id, committed_revision)
);
CREATE INDEX workspace_versions_scope ON workspace_versions(owner_id, scope_id, created_at DESC);

CREATE TABLE user_questions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  run_id uuid NOT NULL,
  FOREIGN KEY (run_id,owner_id) REFERENCES runs(id,owner_id) ON DELETE CASCADE,
  tool_call_id text NOT NULL,
  questions jsonb NOT NULL CHECK(jsonb_typeof(questions)='array'),
  answers jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','answered','cancelled','expired')),
  expires_at timestamptz NOT NULL DEFAULT now()+interval '5 minutes',
  created_at timestamptz NOT NULL DEFAULT now(),
  answered_at timestamptz,
  UNIQUE(run_id,tool_call_id)
);
CREATE INDEX user_questions_pending ON user_questions(owner_id,run_id) WHERE status='pending';

CREATE FUNCTION queue_workspace_objects() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO file_deletions(id,object_key)
  SELECT gen_random_uuid(), item->>'objectKey' FROM (
    SELECT jsonb_array_elements(OLD.manifest) AS item
    UNION ALL
    SELECT jsonb_array_elements(manifest) FROM workspace_versions WHERE scope_id=OLD.id AND owner_id=OLD.owner_id
  ) objects WHERE item->>'objectKey' IS NOT NULL
  ON CONFLICT(object_key) DO NOTHING;
  RETURN OLD;
END;
$$;
CREATE TRIGGER workspace_object_cleanup BEFORE DELETE ON workspace_heads
  FOR EACH ROW EXECUTE FUNCTION queue_workspace_objects();
