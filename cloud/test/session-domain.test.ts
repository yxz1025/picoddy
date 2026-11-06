import assert from "node:assert/strict";
import test from "node:test";

import { createSessionService } from "../src/domains/session/node/service.ts";
import type { Database } from "../src/infra/db.ts";
import { HttpError } from "../src/shared/errors.ts";

interface Step {
  includes: string;
  rows: Array<Record<string, unknown>>;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^$()|[\]\\{}]/g, "\\$&");
}

function scriptedDatabase(steps: Step[]) {
  const calls: Array<{ sql: string; values: readonly unknown[] | undefined }> = [];
  let transactions = 0;
  async function query(sql: string, values?: readonly unknown[]) {
    const normalized = sql.replace(/\s+/g, " ").trim();
    calls.push({ sql: normalized, values });
    const step = steps.shift();
    assert.ok(step, "Unexpected SQL: " + normalized);
    assert.match(normalized, new RegExp(escapeRegex(step.includes)));
    return {
      rows: step.rows,
      rowCount: step.rows.length,
      command: "",
      oid: 0,
      fields: [],
    };
  }
  const database = {
    query,
    async transaction<T>(fn: (client: any) => Promise<T>): Promise<T> {
      transactions += 1;
      return fn({ query });
    },
  } as Database;
  return {
    database,
    calls,
    transactions: () => transactions,
    assertConsumed: () => assert.equal(steps.length, 0),
  };
}

const ownerId = "11111111-1111-4111-8111-111111111111";
const conversationId = "22222222-2222-4222-8222-222222222222";
const workspaceId = "33333333-3333-4333-8333-333333333333";
const createdAt = "2026-01-02T03:04:05.000Z";
const updatedAt = "2026-01-03T03:04:05.000Z";

test('tool-result message DTO retains delivery batch metadata without internal provider fields', async () => {
  const details = { files: [{ path: '/cloud-files/id/report.md', title: 'Report' }], problems: [] };
  const scripted = scriptedDatabase([
    { includes: 'SELECT id FROM conversations', rows: [{ id: conversationId }] },
    { includes: 'SELECT id,content,created_at FROM (', rows: [{
      id: 'message', created_at: createdAt,
      content: { role: 'toolResult', toolCallId: 'call', toolName: 'present_files',
        content: [{ type: 'text', text: 'Delivered' }], details, isError: false, internal: 'not public' },
    }] },
  ]);
  const [message] = await createSessionService(scripted.database).messages(ownerId, conversationId);
  assert.equal(message.toolName, 'present_files');
  assert.equal(message.toolCallId, 'call');
  assert.deepEqual(message.details, details);
  assert.equal(Object.hasOwn(message, 'internal'), false);
});

test("list returns owner-scoped public conversation DTOs", async () => {
  const scripted = scriptedDatabase([{
    includes: "FROM conversations WHERE owner_id=$1 ORDER BY updated_at DESC,id",
    rows: [{
      id: conversationId,
      title: "Private",
      workspace_id: workspaceId,
      category: 'assistant', expert_id: null, expert_revision: null,
      created_at: new Date(createdAt),
      updated_at: updatedAt,
    }],
  }]);

  const result = await createSessionService(scripted.database).list(ownerId);

  assert.deepEqual(result, [{
    id: conversationId,
    title: "Private",
    workspaceId,
    category: 'assistant', expertId: null, expertRevision: null,
    createdAt,
    updatedAt,
  }]);
  assert.deepEqual(scripted.calls[0].values, [ownerId]);
  scripted.assertConsumed();
});

test("create validates workspace ownership and preserves insert SQL", async () => {
  const scripted = scriptedDatabase([
    { includes: 'SELECT id FROM users WHERE id=$1 FOR UPDATE', rows: [{ id: ownerId }] },
    {
      includes: "SELECT id FROM resources WHERE id=$1 AND owner_id=$2 AND kind='workspace' AND deleted_at IS NULL",
      rows: [{ id: workspaceId }],
    },
    {
      includes: "INSERT INTO conversations (owner_id,title,workspace_id,category) VALUES($1,$2,$3,$4)",
      rows: [{
        id: conversationId,
        title: "Trimmed title",
        workspace_id: workspaceId,
        created_at: createdAt,
        updated_at: updatedAt,
      }],
    },
  ]);

  const result = await createSessionService(scripted.database).create(ownerId, {
    title: "  Trimmed title  ",
    workspaceId,
  });

  assert.equal(result.title, "Trimmed title");
  assert.deepEqual(scripted.calls[0].values, [ownerId]);
  assert.deepEqual(scripted.calls[1].values, [workspaceId, ownerId]);
  assert.deepEqual(scripted.calls[2].values, [ownerId, "Trimmed title", workspaceId, 'assistant']);
  assert.equal(scripted.transactions(), 1);
  scripted.assertConsumed();
});

test("create rejects a workspace outside the owner scope", async () => {
  const scripted = scriptedDatabase([
    { includes: 'SELECT id FROM users WHERE id=$1 FOR UPDATE', rows: [{ id: ownerId }] },
    { includes: "SELECT id FROM resources", rows: [] },
  ]);

  await assert.rejects(
    createSessionService(scripted.database).create(ownerId, { title: "Private", workspaceId }),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 400 &&
      error.code === "INVALID_WORKSPACE",
  );
  scripted.assertConsumed();
});

test("get and update conceal conversations owned by another account", async () => {
  const getDatabase = scriptedDatabase([{
    includes: "FROM conversations WHERE id=$1 AND owner_id=$2",
    rows: [],
  }]);
  await assert.rejects(
    createSessionService(getDatabase.database).get(ownerId, conversationId),
    (error: unknown) =>
      error instanceof HttpError && error.status === 404 && error.code === "NOT_FOUND",
  );

  const updateDatabase = scriptedDatabase([{
    includes: "UPDATE conversations SET title=coalesce($3,title)",
    rows: [],
  }]);
  await assert.rejects(
    createSessionService(updateDatabase.database).update(ownerId, conversationId, { title: "Renamed" }),
    (error: unknown) =>
      error instanceof HttpError && error.status === 404 && error.code === "NOT_FOUND",
  );
  assert.deepEqual(
    updateDatabase.calls[0].values,
    [conversationId, ownerId, "Renamed", false, null],
  );
});

test("update preserves explicit workspace clearing", async () => {
  const scripted = scriptedDatabase([{
    includes: "UPDATE conversations SET title=coalesce($3,title)",
    rows: [{
      id: conversationId,
      title: "Private",
      workspace_id: null,
      created_at: createdAt,
      updated_at: updatedAt,
    }],
  }]);

  const result = await createSessionService(scripted.database).update(
    ownerId,
    conversationId,
    { workspaceId: null },
  );

  assert.equal(result.workspaceId, null);
  assert.deepEqual(scripted.calls[0].values, [
    conversationId,
    ownerId,
    null,
    true,
    null,
  ]);
});

test("remove locks user then conversation before checking active runs", async () => {
  const scripted = scriptedDatabase([
    { includes: "SELECT id FROM users WHERE id=$1 FOR UPDATE", rows: [{ id: ownerId }] },
    {
      includes: "SELECT id FROM conversations WHERE id=$1 AND owner_id=$2 FOR UPDATE",
      rows: [{ id: conversationId }],
    },
    {
      includes: "SELECT r.id FROM runs r WHERE r.owner_id=$2 AND r.status=ANY($3::text[]) AND (r.conversation_id=$1 OR r.parent_run_id IN (SELECT id FROM runs WHERE conversation_id=$1 AND owner_id=$2)) LIMIT 1",
      rows: [],
    },
    {
      includes: "UPDATE resources SET deleted_at=now(),updated_at=now() WHERE owner_id=$2 AND kind='memory' AND deleted_at IS NULL AND data->>'scope'='working' AND data->>'conversationId'=$1",
      rows: [],
    },
    {
      includes: "DELETE FROM conversations WHERE id=$1 AND owner_id=$2",
      rows: [],
    },
  ]);

  await createSessionService(scripted.database).remove(ownerId, conversationId);

  assert.equal(scripted.transactions(), 1);
  assert.deepEqual(scripted.calls.map((call) => call.values), [
    [ownerId],
    [conversationId, ownerId],
    [
      conversationId,
      ownerId,
      ["queued", "provisioning", "running", "waiting_approval", "cancelling", "cleanup_pending"],
    ],
    [conversationId, ownerId],
    [conversationId, ownerId],
  ]);
  scripted.assertConsumed();
});

test("remove refuses deletion while an active run exists", async () => {
  const scripted = scriptedDatabase([
    { includes: "SELECT id FROM users WHERE id=$1 FOR UPDATE", rows: [{ id: ownerId }] },
    {
      includes: "SELECT id FROM conversations WHERE id=$1 AND owner_id=$2 FOR UPDATE",
      rows: [{ id: conversationId }],
    },
    { includes: "SELECT id FROM runs", rows: [{ id: "active-run" }] },
  ]);

  await assert.rejects(
    createSessionService(scripted.database).remove(ownerId, conversationId),
    (error: unknown) =>
      error instanceof HttpError &&
      error.status === 409 &&
      error.code === "RUN_ALREADY_ACTIVE",
  );
  assert.equal(scripted.calls.some((call) => call.sql.startsWith("DELETE")), false);
  scripted.assertConsumed();
});

test("messages checks ownership before returning Pi content", async () => {
  const scripted = scriptedDatabase([
    {
      includes: "SELECT id FROM conversations WHERE id=$1 AND owner_id=$2",
      rows: [{ id: conversationId }],
    },
    {
      includes: "SELECT id,content,created_at FROM (",
      rows: [{
        id: "44444444-4444-4444-8444-444444444444",
        content: { role: "assistant", content: [{ type: "text", text: "Done" }] },
        created_at: createdAt,
      }],
    },
  ]);

  const result = await createSessionService(scripted.database).messages(ownerId, conversationId);

  assert.deepEqual(result, [{
    id: "44444444-4444-4444-8444-444444444444",
    role: "assistant",
    content: [{ type: "text", text: "Done" }],
    createdAt,
  }]);
  assert.deepEqual(scripted.calls[1].values, [conversationId, ownerId]);
  assert.match(scripted.calls[1].sql, /type='delivery_batch'/);
  assert.match(scripted.calls[1].sql, /NOT EXISTS/);
  assert.match(scripted.calls[1].sql, /m\.run_id=e\.run_id/);
  scripted.assertConsumed();
});
