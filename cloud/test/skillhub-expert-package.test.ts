import assert from "node:assert/strict";
import { test } from "node:test";

import { strToU8, zipSync } from "fflate";

import type { Database } from "../src/infra/db.ts";
import { expertRevision } from "../src/domains/expert/node/binding.ts";
import { HttpError } from "../src/shared/errors.ts";
import { parseZipFiles } from "../src/domains/skill/node/package.ts";
import {
  createSkillHubExpertArchiveInstaller,
  type SkillHubPackageSource,
} from "../src/domains/skillhub/node/install.ts";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";
const EXPERT_ID = "20000000-0000-4000-8000-000000000002";

function expertArchive(options: {
  prompt?: string;
  avatar?: string;
  skills?: string[];
  extraFiles?: Record<string, Uint8Array>;
  schemaVersion?: number;
} = {}): Uint8Array {
  const avatar = options.avatar ?? "assets/avatar.png";
  const plugin = {
    schemaVersion: options.schemaVersion ?? 2,
    name: "analyst",
    expertType: "agent",
    agentName: "analyst",
    agents: ["./agents/analyst.md"],
    skills: options.skills ?? ["./skills/charting"],
    profession: { zh: "零售分析专家", en: "Retail analyst" },
    displayName: { zh: "零售分析", en: "Retail analysis" },
    displayDescription: { zh: "分析零售经营数据", en: "Analyse retail operations" },
    categoryId: "retail",
    tags: [{ zh: "零售", en: "Retail" }],
    quickPrompts: [{ zh: "分析本周销售", en: "Review this week's sales" }],
    defaultInitPrompt: { zh: "请上传经营数据", en: "Upload operating data" },
    avatar,
  };
  return zipSync({
    "expert-package/": new Uint8Array(),
    "expert-package/.picoddy-plugin/plugin.json": strToU8(JSON.stringify(plugin)),
    "expert-package/agents/analyst.md": strToU8(options.prompt ?? "Analyse the supplied retail data."),
    [`expert-package/${avatar}`]: new Uint8Array([0x89, 0x50, 0x4e, 0x47]),
    "expert-package/skills/charting/SKILL.md": strToU8(
      "---\nname: charting\ndescription: Build charts\n---\n\nCreate a chart from supplied data.\n",
    ),
    "expert-package/skills/charting/scripts/render.js": strToU8("export default true;\n"),
    ...Object.fromEntries(
      Object.entries(options.extraFiles ?? {}).map(([path, bytes]) => [`expert-package/${path}`, bytes]),
    ),
  });
}

function source(version = "2.0.0"): SkillHubPackageSource {
  return { namespace: "retail", slug: "analyst", version };
}

function moderatelyCompressibleBytes(bytes: number): Uint8Array {
  const output = Buffer.alloc(bytes);
  const block = Buffer.alloc(16 * 1024);
  let state = 0x6d2b79f5;
  for (let offset = 0; offset < bytes; offset += block.byteLength * 2) {
    for (let index = 0; index < block.byteLength; index += 1) {
      state ^= state << 13;
      state ^= state >>> 17;
      state ^= state << 5;
      block[index] = state & 0xff;
    }
    const first = Math.min(block.byteLength, bytes - offset);
    block.copy(output, offset, 0, first);
    const secondOffset = offset + first;
    const second = Math.min(first, bytes - secondOffset);
    if (second > 0) block.copy(output, secondOffset, 0, second);
  }
  return output;
}

function fakeExpertDatabase() {
  let row: Record<string, any> | undefined;
  let writes = 0;
  const client = {
    async query(sql: string, values: readonly unknown[] = []) {
      if (/SELECT id FROM users/.test(sql)) {
        assert.equal(values[0], OWNER_ID);
        return { rows: [{ id: OWNER_ID }], rowCount: 1 };
      }
      if (/FROM resources/.test(sql) && /skillhubPackage/.test(sql)) {
        assert.deepEqual(values.slice(0, 3), [OWNER_ID, "retail", "analyst"]);
        return { rows: row ? [row] : [], rowCount: row ? 1 : 0 };
      }
      if (/INSERT INTO resources/.test(sql)) {
        writes += 1;
        const now = new Date("2026-10-13T00:00:00.000Z");
        row = {
          id: EXPERT_ID,
          name: values[1],
          data: JSON.parse(String(values[2])),
          secret: null,
          created_at: now,
          updated_at: now,
        };
        return { rows: [row], rowCount: 1 };
      }
      if (/UPDATE resources SET name=/.test(sql)) {
        writes += 1;
        assert.equal(values[0], EXPERT_ID);
        assert.equal(values[1], OWNER_ID);
        row = {
          ...row,
          name: values[2],
          data: JSON.parse(String(values[3])),
          updated_at: new Date("2026-10-13T00:01:00.000Z"),
        };
        return { rows: [row], rowCount: 1 };
      }
      throw new Error(`Unexpected transaction query: ${sql}`);
    },
  };
  return {
    database: {
      async query() { throw new Error("Unexpected non-transaction query"); },
      async transaction<T>(work: (value: any) => Promise<T>) { return work(client); },
    } as Database,
    get row() { return row; },
    get writes() { return writes; },
  };
}

test("parseZipFiles strips one validated package root and preserves every file", () => {
  const files = parseZipFiles(expertArchive());
  assert.deepEqual(files.map(file => file.path), [
    ".picoddy-plugin/plugin.json",
    "agents/analyst.md",
    "assets/avatar.png",
    "skills/charting/SKILL.md",
    "skills/charting/scripts/render.js",
  ]);
});

test("installs a complete validated expert package with bundled skills and safe desktop metadata", async () => {
  const state = fakeExpertDatabase();
  const installer = createSkillHubExpertArchiveInstaller(state.database);
  const installed = await installer.validateAndInstall({
    ownerId: OWNER_ID,
    source: source(),
    archive: expertArchive(),
  });

  assert.equal(installed.id, EXPERT_ID);
  assert.equal(installed.name, "零售分析专家");
  assert.equal(installed.nickname, "零售分析");
  assert.equal(installed.description, "分析零售经营数据");
  assert.equal(installed.icon, "data:image/png;base64,iVBORw==");
  assert.deepEqual(installed.tags, ["零售"]);
  assert.deepEqual(installed.quickPrompts, ["分析本周销售"]);
  assert.equal(installed.catalogSource, "installed");
  assert.equal(installed.available, true);
  assert.match(installed.revision, /^[a-f0-9]{64}$/);
  assert.equal("skillhubPackage" in installed, false);

  const data = state.row!.data;
  assert.equal(installed.revision, data.revision);
  assert.equal(installed.revision, expertRevision({ name: state.row!.name, data }));
  assert.equal(data.prompt, "Analyse the supplied retail data.");
  assert.deepEqual(data.skillIds, []);
  assert.equal(data.skillhubPackage.source.version, "2.0.0");
  assert.equal(data.skillhubPackage.manifest.name, "analyst");
  assert.match(data.skillhubPackage.version, /^[a-f0-9]{64}$/);
  assert.deepEqual(data.skillhubPackage.files.map((file: { path: string }) => file.path), [
    ".picoddy-plugin/plugin.json",
    "agents/analyst.md",
    "assets/avatar.png",
    "skills/charting/SKILL.md",
    "skills/charting/scripts/render.js",
  ]);
  assert.equal(data.bundledSkills.length, 1);
  assert.equal(data.bundledSkills[0].id, "ee38f3f5-4bc6-536d-817d-73232bce55bc");
  assert.equal(data.bundledSkills[0].name, "charting");
  assert.match(data.bundledSkills[0].version, /^[a-f0-9]{64}$/);
  assert.deepEqual(data.bundledSkills[0].files.map((file: { path: string }) => file.path), [
    "SKILL.md",
    "scripts/render.js",
  ]);
});

test("same source version is idempotent, rejects changed bytes, and a new version keeps the resource id", async () => {
  const state = fakeExpertDatabase();
  const installer = createSkillHubExpertArchiveInstaller(state.database);
  const archive = expertArchive();
  const first = await installer.validateAndInstall({ ownerId: OWNER_ID, source: source(), archive });
  const repeated = await installer.validateAndInstall({ ownerId: OWNER_ID, source: source(), archive });
  assert.equal(repeated.id, first.id);
  assert.equal(state.writes, 1);

  await assert.rejects(
    installer.validateAndInstall({
      ownerId: OWNER_ID,
      source: source(),
      archive: expertArchive({ prompt: "Changed bytes under the same published version." }),
    }),
    (error: unknown) => error instanceof HttpError && error.code === "SKILLHUB_VERSION_CHANGED",
  );
  assert.equal(state.writes, 1);

  const updated = await installer.validateAndInstall({
    ownerId: OWNER_ID,
    source: source("2.1.0"),
    archive: expertArchive({ prompt: "Analyse version 2.1 data." }),
  });
  assert.equal(updated.id, first.id);
  assert.equal(state.writes, 2);
  assert.equal(state.row!.data.prompt, "Analyse version 2.1 data.");
  assert.equal(state.row!.data.skillhubPackage.source.version, "2.1.0");
});

test("rejects undeclared bundled skill files without writing an expert", async () => {
  const state = fakeExpertDatabase();
  const installer = createSkillHubExpertArchiveInstaller(state.database);
  await assert.rejects(
    installer.validateAndInstall({
      ownerId: OWNER_ID,
      source: source(),
      archive: expertArchive({ skills: [] }),
    }),
    (error: unknown) => error instanceof HttpError && error.code === "INVALID_SKILLHUB_EXPERT_PACKAGE",
  );
  assert.equal(state.writes, 0);
});

test("preserves SVG avatar files but never returns active SVG as a data URI", async () => {
  const state = fakeExpertDatabase();
  const installed = await createSkillHubExpertArchiveInstaller(state.database).validateAndInstall({
    ownerId: OWNER_ID,
    source: source(),
    archive: expertArchive({
      avatar: "assets/avatar.svg",
      extraFiles: {},
    }),
  });
  assert.equal(installed.icon, "");
  assert.ok(state.row!.data.skillhubPackage.files.some(
    (file: { path: string }) => file.path === "assets/avatar.svg",
  ));
});

test("rejects normalized expert data larger than 64 MiB before writing", async () => {
  const state = fakeExpertDatabase();
  const payload = moderatelyCompressibleBytes(6 * 1024 * 1024);
  await assert.rejects(
    createSkillHubExpertArchiveInstaller(state.database).validateAndInstall({
      ownerId: OWNER_ID,
      source: source(),
      archive: expertArchive({
        extraFiles: Object.fromEntries(
          Array.from({ length: 4 }, (_, index) => [
            `skills/charting/assets/payload-${index}.bin`,
            payload,
          ]),
        ),
      }),
    }),
    (error: unknown) => error instanceof HttpError &&
      error.code === "INVALID_SKILLHUB_EXPERT_PACKAGE",
  );
  assert.equal(state.writes, 0);
});
