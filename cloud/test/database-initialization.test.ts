import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import test from 'node:test';
import { Pool } from 'pg';
import * as db from '../src/infra/db.ts';

test('schema fingerprints are stable across Windows and Linux line endings', () => {
  assert.equal(db.schemaFingerprint('CREATE TABLE example (id int);\r\n'), db.schemaFingerprint('CREATE TABLE example (id int);\n'));
});

test('fresh schema is a single workspace-only definition, not an upgrade chain', async () => {
  const sql = await readFile(new URL('../database/schema.sql', import.meta.url), 'utf8');
  assert.match(sql, /workspace_id uuid/);
  assert.match(sql, /'workspace'/);
  assert.doesNotMatch(sql, /project_id|'project'|ALTER TABLE|schema_migrations/);
  for (const table of ['runs', 'session_runtime', 'file_deletions', 'user_preferences', 'rag_documents']) {
    assert.match(sql, new RegExp(`CREATE TABLE ${table} \\(`));
  }
  assert.match(sql, /CREATE TABLE auth_challenges \(/);
  assert.match(sql, /provider text NOT NULL DEFAULT 'cas'/);
  assert.match(sql, /subject text NOT NULL/);
  assert.match(sql, /CREATE UNIQUE INDEX users_identity_unique\s+ON users\s*\(provider,\s*subject\)/);
  assert.doesNotMatch(sql, /password_hash|login_attempts/);
});

test('initialization is explicit, repeatable, and refuses unknown or changed schemas', {
  skip: !process.env.TEST_DATABASE_URL,
}, async () => {
  assert.match(new URL(process.env.TEST_DATABASE_URL!).pathname, /test/i, 'Initialization integration checks require a dedicated test database');
  const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
  const schema = `init_test_${randomUUID().replaceAll('-', '')}`;
  await admin.query(`CREATE SCHEMA "${schema}"`);
  const target = new Pool({ connectionString: process.env.TEST_DATABASE_URL, options: `-c search_path=${schema}` });
  try {
    await assert.rejects(db.assertDatabaseInitialized(target), /db:init/);
    await target.query('CREATE TABLE unrelated (id integer)');
    await assert.rejects(db.initializeDatabase(target), /not empty/);
    await target.query('DROP TABLE unrelated');
    await target.query("CREATE TYPE unrelated_type AS ENUM ('sample')");
    await assert.rejects(db.initializeDatabase(target), /not empty/);
    await target.query('DROP TYPE unrelated_type');
    await db.initializeDatabase(target);
    await db.initializeDatabase(target);
    await db.assertDatabaseInitialized(target);
    const people = await target.query("INSERT INTO users(subject,email,name) VALUES('one','one@test','One'),('two','two@test','Two') RETURNING id");
    await assert.rejects(
      target.query("INSERT INTO users(subject,name) VALUES('one','Duplicate identity')"),
      /unique/i,
    );
    const [one, two] = people.rows.map(row => row.id);
    const space = await target.query("INSERT INTO resources(owner_id,kind,name) VALUES($1,'workspace','Private') RETURNING id", [one]);
    await assert.rejects(target.query('INSERT INTO conversations(owner_id,title,workspace_id) VALUES($1,$2,$3)', [two, 'Foreign', space.rows[0].id]), /foreign key/i);
    const conversation = await target.query("INSERT INTO conversations(owner_id,title) VALUES($1,'Private') RETURNING id", [one]);
    await assert.rejects(target.query("INSERT INTO runs(owner_id,conversation_id,prompt,selection,idempotency_key) VALUES($1,$2,'x','{}','cross-owner')", [two, conversation.rows[0].id]), /foreign key/i);
    const { rows } = await target.query("SELECT column_name FROM information_schema.columns WHERE table_schema=$1 AND table_name='conversations'", [schema]);
    assert.ok(rows.some(row => row.column_name === 'workspace_id'));
    assert.ok(!rows.some(row => row.column_name === 'project_id'));
    await target.query("UPDATE schema_installation SET definition_hash='changed'");
    await assert.rejects(db.initializeDatabase(target), /does not match/);
    await assert.rejects(db.assertDatabaseInitialized(target), /does not match/);
  } finally {
    await target.end();
    await admin.query(`DROP SCHEMA "${schema}" CASCADE`);
    await admin.end();
  }
});
