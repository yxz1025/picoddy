import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { createAutomationResourceService } from "../src/domains/automation/node/service.ts";
import { createConnectorResourceService } from "../src/domains/connector/node/service.ts";
import { createExpertResourceService } from "../src/domains/expert/node/service.ts";
import { createMemoryResourceService } from "../src/domains/memory/node/service.ts";
import { createModelSettingsService } from "../src/domains/settings/node/service.ts";
import type { Config } from "../src/config.ts";
import type { Database } from "../src/infra/db.ts";
import { seal, unseal } from "../src/infra/crypto.ts";

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
    assert.ok(step, `Unexpected SQL: ${normalized}`);
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
const resourceId = "22222222-2222-4222-8222-222222222222";
const skillId = "33333333-3333-4333-8333-333333333333";
const workspaceId = "44444444-4444-4444-8444-444444444444";
const createdAt = "2026-10-12T01:02:03.000Z";
const updatedAt = "2026-10-12T02:03:04.000Z";
const encryptionKey = "0123456789abcdef0123456789abcdef";

const config = {
  encryptionKey,
  modelAllowedHosts: ["api.openai.com", "models.example.test"],
} as Config;

test("expert creation validates skill ownership inside the insert transaction", async () => {
  const scripted = scriptedDatabase([
    {
      includes: "WHERE owner_id=$1 AND kind=$2 AND id=ANY($3::uuid[]) AND deleted_at IS NULL",
      rows: [{ id: skillId }],
    },
    {
      includes: "INSERT INTO resources(owner_id,kind,name,data,secret)",
      rows: [{
        id: resourceId,
        name: "Reviewer",
        data: { prompt: "Review carefully", skillIds: [skillId] },
        secret: null,
        created_at: createdAt,
        updated_at: updatedAt,
      }],
    },
  ]);

  const result = await createExpertResourceService({
    database: scripted.database,
    ownerId,
  }).create({ name: " Reviewer ", prompt: "Review carefully", skillIds: [skillId] });

  assert.equal(scripted.transactions(), 1);
  assert.equal(result.name, "Reviewer");
  assert.deepEqual(scripted.calls[0].values, [ownerId, "skill", [skillId]]);
  assert.deepEqual(scripted.calls[1].values?.slice(0, 3), [ownerId, "expert", "Reviewer"]);
  scripted.assertConsumed();
});

test("default model creation serializes on the owner before clearing other defaults", async () => {
  const scripted = scriptedDatabase([
    { includes: "SELECT id FROM users WHERE id=$1 FOR UPDATE", rows: [{ id: ownerId }] },
    {
      includes: "UPDATE resources SET data=jsonb_set(data,'{isDefault}','false'::jsonb)",
      rows: [],
    },
    {
      includes: "INSERT INTO resources(owner_id,kind,name,data,secret)",
      rows: [{
        id: resourceId,
        name: "Primary",
        data: { provider: "openai", model: "gpt-test", isDefault: true },
        secret: seal({ apiKey: "secret-key" }, encryptionKey),
        created_at: createdAt,
        updated_at: updatedAt,
      }],
    },
  ]);

  const result = await createModelSettingsService({
    database: scripted.database,
    ownerId,
    config,
  }).create({
    name: "Primary",
    provider: "openai",
    model: "gpt-test",
    apiKey: "secret-key",
    isDefault: true,
  });

  assert.equal(result.apiKeyConfigured, true);
  assert.deepEqual(scripted.calls.map((call) => call.values?.slice(0, 2)), [
    [ownerId],
    [ownerId],
    [ownerId, "model"],
  ]);
  scripted.assertConsumed();
});

test("connector patch preserves omitted encrypted env and headers", async () => {
  const existingSecret = seal({
    env: { TOKEN: "keep-env" },
    headers: { Authorization: "keep-header" },
  }, encryptionKey);
  const scripted = scriptedDatabase([
    {
      includes: "WHERE id=$1 AND owner_id=$2 AND kind=$3 AND deleted_at IS NULL FOR UPDATE",
      rows: [{
        id: resourceId,
        name: "Before",
        data: { transport: "http", url: "https://connector.example.test/mcp" },
        secret: existingSecret,
        created_at: createdAt,
        updated_at: updatedAt,
      }],
    },
    {
      includes: "UPDATE resources SET name=$4,data=$5::jsonb,secret=$6,updated_at=now()",
      rows: [{
        id: resourceId,
        name: "After",
        data: { transport: "http", url: "https://connector.example.test/mcp" },
        secret: existingSecret,
        created_at: createdAt,
        updated_at: updatedAt,
      }],
    },
  ]);

  const result = await createConnectorResourceService({
    database: scripted.database,
    ownerId,
    config,
  }).update(resourceId, { name: "After" });

  const writtenSecret = scripted.calls[1].values?.[5];
  assert.equal(typeof writtenSecret, "string");
  assert.deepEqual(unseal(writtenSecret as string, encryptionKey), {
    env: { TOKEN: "keep-env" },
    headers: { Authorization: "keep-header" },
  });
  assert.equal(result.envConfigured, true);
  assert.equal(result.headersConfigured, true);
  scripted.assertConsumed();
});

test("model patch preserves an omitted API key and excludes itself when resetting defaults", async () => {
  const existingSecret = seal({ apiKey: "keep-model-key" }, encryptionKey);
  const scripted = scriptedDatabase([
    { includes: "SELECT id FROM users WHERE id=$1 FOR UPDATE", rows: [{ id: ownerId }] },
    {
      includes: "WHERE id=$1 AND owner_id=$2 AND kind=$3 AND deleted_at IS NULL FOR UPDATE",
      rows: [{
        id: resourceId,
        name: "Before",
        data: { provider: "openai", model: "gpt-test", isDefault: false },
        secret: existingSecret,
        created_at: createdAt,
        updated_at: updatedAt,
      }],
    },
    {
      includes: "WHERE owner_id=$1 AND kind='model' AND id<>$2 AND deleted_at IS NULL",
      rows: [],
    },
    {
      includes: "UPDATE resources SET name=$4,data=$5::jsonb,secret=$6,updated_at=now()",
      rows: [{
        id: resourceId,
        name: "Before",
        data: { provider: "openai", model: "gpt-test", isDefault: true },
        secret: existingSecret,
        created_at: createdAt,
        updated_at: updatedAt,
      }],
    },
  ]);

  const result = await createModelSettingsService({
    database: scripted.database,
    ownerId,
    config,
  }).update(resourceId, { isDefault: true });

  assert.equal(result.apiKeyConfigured, true);
  assert.deepEqual(
    unseal(scripted.calls[3].values?.[5] as string, encryptionKey),
    { apiKey: "keep-model-key" },
  );
  assert.deepEqual(scripted.calls[2].values, [ownerId, resourceId]);
  scripted.assertConsumed();
});

test("memory workspace references are checked in the same transaction as insert", async () => {
  const scripted = scriptedDatabase([
    { includes: 'SELECT id FROM users WHERE id=$1 FOR UPDATE', rows: [{ id: ownerId }] },
    {
      includes: "WHERE owner_id=$1 AND kind=$2 AND id=ANY($3::uuid[]) AND deleted_at IS NULL",
      rows: [{ id: workspaceId }],
    },
    {
      includes: "INSERT INTO resources(owner_id,kind,name,data,secret)",
      rows: [{
        id: resourceId,
        name: "Decision",
        data: { content: "Keep this", workspaceId },
        secret: null,
        created_at: createdAt,
        updated_at: updatedAt,
      }],
    },
  ]);

  const result = await createMemoryResourceService({
    database: scripted.database,
    ownerId,
  }).create({ title: "Decision", content: "Keep this", workspaceId });

  assert.equal(scripted.transactions(), 1);
  assert.equal(result.title, "Decision");
  assert.deepEqual(scripted.calls[0].values, [ownerId]);
  assert.deepEqual(scripted.calls[1].values, [ownerId, "workspace", [workspaceId]]);
  scripted.assertConsumed();
});

test("automation patch preserves scheduler-owned state fields", async () => {
  const existing = {
    id: resourceId,
    name: "Daily",
    data: {
      prompt: "Summarize",
      cron: "0 9 * * *",
      timezone: "Asia/Shanghai",
      skillIds: [],
      connectorIds: [],
      enabled: true,
      lastRunId: "run-before",
      lastError: "old-error",
      nextRunAt: "2026-10-13T01:00:00.000Z",
    },
    secret: null,
    created_at: createdAt,
    updated_at: updatedAt,
  };
  const scripted = scriptedDatabase([
    {
      includes: "WHERE id=$1 AND owner_id=$2 AND kind=$3 AND deleted_at IS NULL FOR UPDATE",
      rows: [existing],
    },
    {
      includes: "UPDATE resources SET name=$4,data=$5::jsonb,secret=$6,updated_at=now()",
      rows: [{ ...existing, name: "Renamed", data: { ...existing.data, nextRunAt: null } }],
    },
  ]);

  await createAutomationResourceService({
    database: scripted.database,
    ownerId,
  }).update(resourceId, { name: "Renamed", cron: "30 9 * * *" });

  const data = JSON.parse(scripted.calls[1].values?.[4] as string) as Record<string, unknown>;
  assert.equal(data.lastRunId, "run-before");
  assert.equal(data.lastError, "old-error");
  assert.equal(data.nextRunAt, null);
  scripted.assertConsumed();
});

test("HTTP resource adapter contains no persistence SQL", async () => {
  const source = await readFile(
    new URL("../src/transport/http/resources.ts", import.meta.url),
    "utf8",
  );

  assert.doesNotMatch(source, /\b(?:SELECT|INSERT|UPDATE|DELETE)\b\s+(?:FROM|INTO|resources|users)/i);
  assert.doesNotMatch(source, /database\.query|database\.transaction/);
});
