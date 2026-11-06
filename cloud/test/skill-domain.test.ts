import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import test from "node:test";

import type { Database } from "../src/infra/db.ts";
import { createSkillService } from "../src/domains/skill/node/service.ts";
import { HttpError } from "../src/shared/errors.ts";

const ownerId = "11111111-1111-4111-8111-111111111111";
const skillId = "22222222-2222-4222-8222-222222222222";
const createdAt = "2026-10-12T01:00:00.000Z";
const updatedAt = "2026-10-12T02:00:00.000Z";

interface Step {
  includes: string;
  rows?: Record<string, unknown>[];
  error?: unknown;
}

function scriptedDatabase(steps: Step[]) {
  const calls: Array<{ sql: string; values?: readonly unknown[] }> = [];
  let transactions = 0;
  const database = {
    async query(sql: string, values?: readonly unknown[]) {
      calls.push({ sql, values });
      const step = steps.shift();
      assert.ok(step, `Unexpected query: ${sql}`);
      assert.ok(sql.includes(step.includes), `Expected SQL containing ${step.includes}, got ${sql}`);
      if (step.error) throw step.error;
      const rows = step.rows ?? [];
      return { rows, rowCount: rows.length };
    },
    async transaction<T>(fn: (client: unknown) => Promise<T>): Promise<T> {
      transactions += 1;
      return fn(database);
    },
  } as unknown as Database;
  return {
    calls,
    database,
    transactions: () => transactions,
    assertConsumed: () => assert.equal(steps.length, 0, `${steps.length} scripted queries were unused`),
  };
}

function packageSource(name = "Report Builder"): string {
  return `---\nname: ${name}\ndescription: Builds reports safely\n---\n\n# Instructions\n`;
}

function packageBody(name = "Report Builder") {
  return {
    filename: "SKILL.md",
    contentBase64: Buffer.from(packageSource(name)).toString("base64"),
  };
}

const packageVersion = createHash("sha256").update(JSON.stringify([{ path: 'SKILL.md', contentBase64: Buffer.from(packageSource()).toString('base64') }])).digest("hex");

function skillRow(overrides: Record<string, unknown> = {}) {
  return {
    id: skillId,
    name: "Report Builder",
    data: { description: "Builds reports safely", currentVersion: "old-version", enabled: true },
    created_at: createdAt,
    updated_at: updatedAt,
    ...overrides,
  };
}

test("skill service rejects null and malformed inputs before querying the store", async () => {
  const scripted = scriptedDatabase([]);
  const service = createSkillService({ database: scripted.database, maxUploadBytes: 1024 });

  await assert.rejects(
    service.create(ownerId, null),
    (error: unknown) => error instanceof HttpError && error.status === 400 && error.code === "INVALID_REQUEST",
  );
  await assert.rejects(
    service.update(ownerId, skillId, null),
    (error: unknown) => error instanceof HttpError && error.status === 400 && error.code === "INVALID_REQUEST",
  );
  await assert.rejects(
    service.addVersion(ownerId, skillId, { ...packageBody(), expectedVersion: null }),
    (error: unknown) => error instanceof HttpError && error.status === 400 && error.code === "EXPECTED_VERSION_REQUIRED",
  );
  await assert.rejects(
    service.create(ownerId, { filename: "SKILL.md", contentBase64: "not base64" }),
    (error: unknown) => error instanceof HttpError && error.status === 400 && error.code === "INVALID_BASE64",
  );
  await assert.rejects(
    createSkillService({ database: scripted.database, maxUploadBytes: 4 }).create(
      ownerId,
      packageBody(),
    ),
    (error: unknown) => error instanceof HttpError && error.status === 413 && error.code === "UPLOAD_TOO_LARGE",
  );
  assert.equal(scripted.calls.length, 0);
});

test("skill creation atomically stores the resource and immutable first version for its owner", async () => {
  const scripted = scriptedDatabase([
    {
      includes: "INSERT INTO resources",
      rows: [skillRow({
        data: { description: "Builds reports safely", currentVersion: packageVersion, enabled: true },
      })],
    },
    { includes: "INSERT INTO skill_versions", rows: [] },
  ]);
  const service = createSkillService({ database: scripted.database, maxUploadBytes: 1024 });

  const result = await service.create(ownerId, packageBody());

  assert.equal(result.id, skillId);
  assert.equal(result.name, "Report Builder");
  assert.equal(result.enabled, true);
  assert.equal(result.version, packageVersion);
  assert.equal(scripted.transactions(), 1);
  assert.equal(scripted.calls[0]!.values?.[0], ownerId);
  assert.equal(scripted.calls[1]!.values?.[1], ownerId);
  assert.equal(scripted.calls[1]!.values?.[2], result.version);
  scripted.assertConsumed();
});

test("adding a version locks the owned skill and atomically advances only its current pointer", async () => {
  const scripted = scriptedDatabase([
    { includes: "FOR UPDATE", rows: [skillRow()] },
    { includes: "INSERT INTO skill_versions", rows: [] },
    {
      includes: "UPDATE resources SET",
      rows: [skillRow({
        data: { description: "Builds reports safely", currentVersion: "new-version", enabled: true },
      })],
    },
  ]);
  const service = createSkillService({ database: scripted.database, maxUploadBytes: 1024 });

  const result = await service.addVersion(ownerId, skillId, {
    ...packageBody(),
    expectedVersion: "old-version",
  });

  assert.equal(result.id, skillId);
  assert.equal(scripted.transactions(), 1);
  assert.deepEqual(scripted.calls[0]!.values, [skillId, ownerId]);
  assert.equal(scripted.calls[1]!.values?.[0], skillId);
  assert.equal(scripted.calls[1]!.values?.[1], ownerId);
  assert.match(String(scripted.calls[1]!.values?.[2]), /^[a-f0-9]{64}$/);
  assert.equal(scripted.calls[2]!.values?.[1], ownerId);
  scripted.assertConsumed();
});

test("adding a version rejects stale expectedVersion without inserting files", async () => {
  const scripted = scriptedDatabase([
    { includes: "FOR UPDATE", rows: [skillRow()] },
  ]);
  const service = createSkillService({ database: scripted.database, maxUploadBytes: 1024 });

  await assert.rejects(
    service.addVersion(ownerId, skillId, { ...packageBody(), expectedVersion: "stale-version" }),
    (error: unknown) => error instanceof HttpError && error.status === 409 && error.code === "VERSION_CONFLICT",
  );
  assert.equal(scripted.calls.length, 1);
  scripted.assertConsumed();
});

test("enabled update locks the owned skill and enforces optional expectedVersion", async () => {
  const scripted = scriptedDatabase([
    { includes: "FOR UPDATE", rows: [skillRow()] },
    {
      includes: "jsonb_set",
      rows: [skillRow({ data: { description: "Builds reports safely", currentVersion: "old-version", enabled: false } })],
    },
  ]);
  const service = createSkillService({ database: scripted.database, maxUploadBytes: 1024 });

  const result = await service.update(ownerId, skillId, {
    enabled: false,
    expectedVersion: "old-version",
  });

  assert.equal(result.enabled, false);
  assert.equal(scripted.transactions(), 1);
  assert.deepEqual(scripted.calls[0]!.values, [skillId, ownerId]);
  assert.deepEqual(scripted.calls[1]!.values, [skillId, ownerId, "false"]);
  scripted.assertConsumed();
});

test("version listing verifies ownership and never returns package contents", async () => {
  const scripted = scriptedDatabase([
    { includes: "FOR SHARE", rows: [{ id: skillId }] },
    {
      includes: "FROM skill_versions",
      rows: [{
        version: "version-one",
        description: "First",
        files: [{ path: "SKILL.md", contentBase64: "private" }, { path: "scripts/run.py", contentBase64: "private" }],
        created_at: createdAt,
      }],
    },
  ]);
  const service = createSkillService({ database: scripted.database, maxUploadBytes: 1024 });

  const versions = await service.versions(ownerId, skillId);

  assert.deepEqual(versions, [{
    version: "version-one",
    description: "First",
    files: [{ path: "SKILL.md" }, { path: "scripts/run.py" }],
    createdAt,
  }]);
  assert.equal(scripted.transactions(), 1);
  assert.deepEqual(scripted.calls[0]!.values, [skillId, ownerId]);
  assert.deepEqual(scripted.calls[1]!.values, [skillId, ownerId]);
  scripted.assertConsumed();
});

test("current skill content is read from the owner-scoped immutable version", async () => {
  const scripted = scriptedDatabase([
    {
      includes: "JOIN skill_versions",
      rows: [{
        ...skillRow(),
        version: "old-version",
        description: "Builds reports safely",
        files: [
          { path: "SKILL.md", contentBase64: packageBody().contentBase64 },
          { path: "scripts/run.py", contentBase64: Buffer.from("print('ok')\n").toString("base64") },
        ],
      }],
    },
  ]);
  const service = createSkillService({ database: scripted.database, maxUploadBytes: 1024 });

  const content = await service.content(ownerId, skillId);

  assert.deepEqual(content, {
    version: "old-version",
    description: "Builds reports safely",
    body: "# Instructions\n",
    hasExtraFrontmatter: false,
    files: [{ path: "SKILL.md" }, { path: "scripts/run.py" }],
  });
  assert.deepEqual(scripted.calls[0]!.values, [skillId, ownerId]);
  scripted.assertConsumed();
});

test('skill content flags metadata that the simple text editor cannot preserve', async () => {
  const markdown = '---\nname: reports\ndescription: Reports\nlicense: MIT\nmetadata:\n  team: finance\n---\nBody\n';
  const scripted = scriptedDatabase([{ includes: 'JOIN skill_versions', rows: [{
    ...skillRow(), name: 'reports', version: 'v1',
    files: [{ path: 'SKILL.md', contentBase64: Buffer.from(markdown).toString('base64') }],
  }] }]);
  const content = await createSkillService({ database: scripted.database, maxUploadBytes: 1024 }).content(ownerId, skillId);
  assert.equal(content.hasExtraFrontmatter, true);
});

test("current skill content does not reveal another owner's version", async () => {
  const scripted = scriptedDatabase([
    { includes: "JOIN skill_versions", rows: [] },
  ]);
  const service = createSkillService({ database: scripted.database, maxUploadBytes: 1024 });

  await assert.rejects(
    service.content(ownerId, skillId),
    (error: unknown) => error instanceof HttpError && error.status === 404 && error.code === "NOT_FOUND",
  );
  assert.deepEqual(scripted.calls[0]!.values, [skillId, ownerId]);
  scripted.assertConsumed();
});

test("skill deletion is soft, disables the skill, and remains owner scoped", async () => {
  const scripted = scriptedDatabase([
    { includes: "deleted_at=now()", rows: [{ id: skillId }] },
  ]);
  const service = createSkillService({ database: scripted.database, maxUploadBytes: 1024 });

  await service.remove(ownerId, skillId);

  assert.deepEqual(scripted.calls[0]!.values, [skillId, ownerId]);
  scripted.assertConsumed();
});

test("database uniqueness errors retain stable domain error codes", async () => {
  const uniqueViolation = Object.assign(new Error("duplicate"), { code: "23505" });
  const scripted = scriptedDatabase([
    { includes: "INSERT INTO resources", error: uniqueViolation },
  ]);
  const service = createSkillService({ database: scripted.database, maxUploadBytes: 1024 });

  await assert.rejects(
    service.create(ownerId, packageBody()),
    (error: unknown) => error instanceof HttpError && error.status === 409 && error.code === "SKILL_ALREADY_EXISTS",
  );
  scripted.assertConsumed();
});
