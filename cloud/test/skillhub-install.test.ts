import assert from "node:assert/strict";
import { test } from "node:test";

import { strToU8, zipSync } from "fflate";

import type { Database } from "../src/infra/db.ts";
import { HttpError } from "../src/shared/errors.ts";
import {
  installSkillHubExpert,
  installSkillHubSkill,
  type SkillHubExpertArchiveInstaller,
} from "../src/domains/skillhub/node/install.ts";

const OWNER_ID = "10000000-0000-4000-8000-000000000001";

function responseBody(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
}

function skillArchive(name = "weekly-report"): Uint8Array {
  return zipSync({
    "package/": new Uint8Array(),
    "package/SKILL.md": strToU8(
      `---\nname: ${name}\ndescription: Generate a weekly report\n---\n\nUse the supplied files.\n`,
    ),
    "package/scripts/render.js": strToU8("export default true;\n"),
  });
}

function fakeSkillDatabase() {
  const resources: Array<Record<string, any>> = [];
  const versions: Array<Record<string, any>> = [];
  let writes = 0;
  const client = {
    async query(sql: string, values: readonly unknown[] = []) {
      if (/INSERT INTO resources/.test(sql)) {
        writes += 1;
        const now = new Date("2026-10-13T00:00:00.000Z");
        const row = {
          id: "20000000-0000-4000-8000-000000000002",
          owner_id: values[0],
          name: values[1],
          data: JSON.parse(String(values[2])),
          created_at: now,
          updated_at: now,
        };
        resources.push(row);
        return { rows: [row], rowCount: 1 };
      }
      if (/INSERT INTO skill_versions/.test(sql)) {
        writes += 1;
        versions.push({
          skill_id: values[0], owner_id: values[1], version: values[2],
          description: values[3], files: JSON.parse(String(values[4])),
        });
        return { rows: [], rowCount: 1 };
      }
      throw new Error(`Unexpected transaction query: ${sql}`);
    },
  };
  const database = {
    async query(sql: string, values: readonly unknown[] = []) {
      if (/FROM resources/.test(sql) && /kind='skill'/.test(sql)) {
        assert.equal(values[0], OWNER_ID);
        return { rows: resources, rowCount: resources.length };
      }
      throw new Error(`Unexpected database query: ${sql}`);
    },
    async transaction<T>(work: (value: any) => Promise<T>) {
      return work(client);
    },
  } as Database;
  return { database, resources, versions, get writes() { return writes; } };
}

test("downloads the pinned namespaced package with the user token and stores a validated skill", async () => {
  const archive = skillArchive();
  const state = fakeSkillDatabase();
  let request: { url: URL; init: RequestInit } | undefined;

  const installed = await installSkillHubSkill({
    database: state.database,
    ownerId: OWNER_ID,
    maxUploadBytes: 16 * 1024 * 1024,
    baseUrl: "https://skillhub.example.test/registry",
    downloadHosts: ["cdn.example.test"],
    credential: { token: "sk_user_token" },
    fetchImpl: async (input, init = {}) => {
      request = { url: new URL(String(input)), init };
      return new Response(responseBody(archive), {
        status: 200,
        headers: { "content-length": String(archive.byteLength) },
      });
    },
  }, { namespace: "office", slug: "weekly-report", version: "1.2.3" });

  assert.equal(
    request?.url.pathname,
    "/registry/api/v1/skills/office/weekly-report/versions/1.2.3/download",
  );
  assert.deepEqual([...request!.url.searchParams], []);
  assert.equal(request?.init.method, "GET");
  assert.equal((request?.init.headers as Record<string, string>).Authorization, "Bearer sk_user_token");
  assert.equal(request?.init.redirect, "manual");
  assert.equal(installed.name, "weekly-report");
  assert.match(installed.version ?? "", /^[a-f0-9]{64}$/);
  assert.equal(state.resources[0]?.owner_id, OWNER_ID);
  assert.deepEqual(
    state.versions[0]?.files.map((file: { path: string }) => file.path),
    ["SKILL.md", "scripts/render.js"],
  );
});

test("rejects an invalid skill package before owner storage", async () => {
  const state = fakeSkillDatabase();
  await assert.rejects(
    installSkillHubSkill({
      database: state.database,
      ownerId: OWNER_ID,
      maxUploadBytes: 1024,
      baseUrl: "https://skillhub.example.test",
      downloadHosts: ["cdn.example.test"],
      credential: { token: "sk_user_token" },
      fetchImpl: async () => new Response(responseBody(strToU8("not a zip")), { status: 200 }),
    }, { namespace: "global", slug: "broken", version: "1" }),
    (error: unknown) => error instanceof HttpError && error.code === "INVALID_SKILLHUB_PACKAGE",
  );
  assert.equal(state.writes, 0);
});

test("bounds the streamed archive before parsing or database writes", async () => {
  const state = fakeSkillDatabase();
  await assert.rejects(
    installSkillHubSkill({
      database: state.database,
      ownerId: OWNER_ID,
      maxUploadBytes: 8,
      baseUrl: "https://skillhub.example.test",
      downloadHosts: ["cdn.example.test"],
      credential: { token: "sk_user_token" },
      fetchImpl: async () => new Response(responseBody(new Uint8Array(9)), {
        status: 200,
        headers: { "content-length": "9" },
      }),
    }, { namespace: "global", slug: "large", version: "1" }),
    (error: unknown) => error instanceof HttpError && error.status === 413,
  );
  assert.equal(state.writes, 0);
});

test("passes the complete expert archive only to the validating catalog installer", async () => {
  const archive = zipSync({
    ".picoddy-plugin/plugin.json": strToU8(JSON.stringify({ name: "analyst", expertType: "agent" })),
    "agents/analyst.md": strToU8("Analyse the supplied data."),
    "assets/avatar.png": new Uint8Array([1, 2, 3]),
  });
  let received: Parameters<SkillHubExpertArchiveInstaller<Record<string, unknown>>["validateAndInstall"]>[0] | undefined;
  const expert = await installSkillHubExpert({
    database: fakeSkillDatabase().database,
    ownerId: OWNER_ID,
    maxUploadBytes: 16 * 1024 * 1024,
    baseUrl: "https://skillhub.example.test",
    downloadHosts: ["cdn.example.test"],
    credential: { token: "sk_user_token" },
    fetchImpl: async () => new Response(responseBody(archive), { status: 200 }),
    expertCatalog: {
      async validateAndInstall(input) {
        received = input;
        return {
          id: "30000000-0000-4000-8000-000000000003",
          name: "Retail analyst",
          description: "Analyses retail data",
          tags: ["retail"],
          quickPrompts: ["Review this week"],
          revision: "expert-revision",
          available: true,
        };
      },
    },
  }, { namespace: "retail", slug: "analyst", version: "2.0.0" });

  assert.equal(received?.ownerId, OWNER_ID);
  assert.deepEqual(received?.source, {
    namespace: "retail", slug: "analyst", version: "2.0.0",
  });
  assert.deepEqual(received?.archive, archive);
  assert.equal(expert.revision, "expert-revision");
});

test("expert installation fails closed without a complete-package catalog", async () => {
  await assert.rejects(
    installSkillHubExpert({
      database: fakeSkillDatabase().database,
      ownerId: OWNER_ID,
      maxUploadBytes: 1024,
      baseUrl: "https://skillhub.example.test",
      downloadHosts: ["cdn.example.test"],
      credential: { token: "sk_user_token" },
      fetchImpl: async () => new Response(responseBody(new Uint8Array([1])), { status: 200 }),
    }, { namespace: "retail", slug: "analyst", version: "2.0.0" }),
    (error: unknown) => error instanceof HttpError && error.code === "EXPERT_PACKAGE_STORAGE_UNAVAILABLE",
  );
});

test("rejects unsafe canonical version path segments before making a request", async () => {
  for (const version of [".", "..", "v1/next", "v1\\next", "v1\u0000next"]) {
    let requested = false;
    await assert.rejects(
      installSkillHubSkill({
        database: fakeSkillDatabase().database,
        ownerId: OWNER_ID,
        maxUploadBytes: 1024,
        baseUrl: "https://skillhub.example.test",
        downloadHosts: ["cdn.example.test"],
        credential: { token: "sk_user_token" },
        fetchImpl: async () => {
          requested = true;
          return new Response();
        },
      }, { namespace: "global", slug: "unsafe", version }),
      (error: unknown) => error instanceof HttpError && error.code === "INVALID_SKILLHUB_INSTALL",
    );
    assert.equal(requested, false);
  }
});

test("follows an allowlisted HTTPS signed download without forwarding credentials", async () => {
  const archive = skillArchive("redirected-skill");
  const state = fakeSkillDatabase();
  const calls: Array<{ url: URL; headers: Record<string, string>; signal: AbortSignal | undefined }> = [];
  const installed = await installSkillHubSkill({
    database: state.database,
    ownerId: OWNER_ID,
    maxUploadBytes: 16 * 1024 * 1024,
    baseUrl: "https://skillhub.example.test/registry",
    downloadHosts: ["skillhub-example.oss-cn-hangzhou.aliyuncs.com"],
    credential: { token: "sk_user_token" },
    fetchImpl: async (input, init = {}) => {
      const url = new URL(String(input));
      const headers = init.headers as Record<string, string>;
      calls.push({ url, headers, signal: init.signal ?? undefined });
      if (calls.length === 1) {
        return new Response(null, {
          status: 302,
          headers: {
            location: "https://skillhub-example.oss-cn-hangzhou.aliyuncs.com/packages/220/224/bundle.zip?signature=secret",
          },
        });
      }
      return new Response(responseBody(archive), { status: 200 });
    },
  }, { namespace: "team-ui", slug: "redirected-skill", version: "1.0.0" });

  assert.equal(installed.name, "redirected-skill");
  assert.equal(calls.length, 2);
  assert.equal(calls[0]!.headers.Authorization, "Bearer sk_user_token");
  assert.equal("Authorization" in calls[1]!.headers, false);
  assert.equal("Cookie" in calls[1]!.headers, false);
  assert.equal(calls[1]!.url.search, "?signature=secret");
  assert.equal(calls[0]!.signal, calls[1]!.signal);
});

test("rejects untrusted or insecure download redirects before contacting them", async () => {
  for (const location of [
    "https://untrusted.example.test/package.zip?signature=secret",
    "http://cdn.example.test/package.zip?signature=secret",
    "https://user@cdn.example.test/package.zip?signature=secret",
    "https://cdn.example.test/package.zip?signature=secret#fragment",
  ]) {
    let requests = 0;
    await assert.rejects(
      installSkillHubSkill({
        database: fakeSkillDatabase().database,
        ownerId: OWNER_ID,
        maxUploadBytes: 1024,
        baseUrl: "https://skillhub.example.test",
        downloadHosts: ["cdn.example.test"],
        credential: { token: "sk_user_token" },
        fetchImpl: async () => {
          requests += 1;
          return new Response(null, { status: 302, headers: { location } });
        },
      }, { namespace: "global", slug: "redirected", version: "1.0.0" }),
      (error: unknown) => error instanceof HttpError && error.code === "SKILLHUB_REDIRECT_REJECTED",
    );
    assert.equal(requests, 1);
  }
});

test("keeps credentials only on the exact registry path and caps redirects at three", async () => {
  let requests = 0;
  await assert.rejects(
    installSkillHubSkill({
      database: fakeSkillDatabase().database,
      ownerId: OWNER_ID,
      maxUploadBytes: 1024,
      baseUrl: "https://skillhub.example.test",
      downloadHosts: ["cdn.example.test"],
      credential: { token: "sk_user_token" },
      fetchImpl: async (input, init = {}) => {
        requests += 1;
        assert.equal(
          (init.headers as Record<string, string>).Authorization,
          "Bearer sk_user_token",
        );
        const next = new URL(String(input));
        next.searchParams.set("hop", String(requests));
        return new Response(null, { status: 302, headers: { location: next.toString() } });
      },
    }, { namespace: "global", slug: "redirect-loop", version: "1.0.0" }),
    (error: unknown) => error instanceof HttpError && error.code === "SKILLHUB_REDIRECT_REJECTED",
  );
  assert.equal(requests, 4);
});
