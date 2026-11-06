import assert from "node:assert/strict";
import test from "node:test";

import {
  filterSkillHubSkills,
  isSkillHubInstalled,
  resolveLocalSkillVersion,
  skillHubCategories,
  skillHubIdentity,
  skillHubInstallVersion,
  skillHubNamespaceDisplayName,
  skillVersionLabel,
  type SkillHubNamespace,
  type SkillHubSkill,
} from "./skillHubModel.ts";

const namespaces: SkillHubNamespace[] = [
  { id: 1, slug: "front", displayName: "产品设计", status: "ACTIVE", description: null, type: "TEAM" },
  { id: 2, slug: "backend", displayName: "后端研发", status: "ACTIVE", description: null, type: "TEAM" },
];

const skills: SkillHubSkill[] = [
  {
    id: 1,
    namespace: "front",
    slug: "api-doc-sync",
    displayName: "API 文档同步",
    summary: "根据接口文档同步前端调用",
    status: "ACTIVE",
    downloadCount: 4,
    updatedAt: "2026-06-03T05:38:46Z",
    headlineVersion: { id: 10, version: "2.0.0", status: "PUBLISHED" },
    publishedVersion: { id: 9, version: "1.0.0", status: "PUBLISHED" },
  },
  {
    id: 2,
    namespace: "backend",
    slug: "grill-me",
    displayName: "后端设计审查",
    summary: "压力测试你的设计",
    status: "ACTIVE",
    downloadCount: 3,
    updatedAt: "2026-05-11T03:33:56Z",
    headlineVersion: null,
    publishedVersion: { id: 11, version: "1.2.0", status: "PUBLISHED" },
  },
];

test("SkillHub identity and install version are stable", () => {
  assert.equal(skillHubIdentity(skills[0]), "front/api-doc-sync");
  assert.equal(skillHubInstallVersion(skills[0]), "1.0.0");
  assert.equal(skillHubInstallVersion(skills[1]), "1.2.0");
  assert.equal(skillHubInstallVersion({
    ...skills[0],
    headlineVersion: { id: 12, version: "3.0.0-beta", status: "DRAFT" },
    publishedVersion: null,
  }), null);
});

test("SkillHub categories use display names and preserve catalog order", () => {
  assert.deepEqual(
    skillHubCategories(namespaces),
    [
      { slug: "全部", displayName: "全部" },
      { slug: "front", displayName: "产品设计" },
      { slug: "backend", displayName: "后端研发" },
    ],
  );
  assert.equal(skillHubNamespaceDisplayName("front", namespaces), "产品设计");
  assert.equal(skillHubNamespaceDisplayName("unknown", namespaces), "unknown");
});

test("SkillHub filtering searches display name, slug, summary, and namespace", () => {
  assert.deepEqual(filterSkillHubSkills(skills, "全部", "接口"), [skills[0]]);
  assert.deepEqual(filterSkillHubSkills(skills, "全部", "GRILL"), [skills[1]]);
  assert.deepEqual(filterSkillHubSkills(skills, "全部", "backend"), [skills[1]]);
  assert.deepEqual(filterSkillHubSkills(skills, "front", ""), [skills[0]]);
});

test("skill version labels prefer local then catalog matches", () => {
  assert.equal(skillVersionLabel("1.0.0"), "1.0.0");
  assert.equal(skillVersionLabel("  "), "暂无版本号");
  assert.equal(
    resolveLocalSkillVersion(
      { name: "renamed-skill", version: "9.9.9" },
      skills,
      { "front/api-doc-sync": "renamed-skill" },
    ),
    "9.9.9",
  );
  assert.equal(
    resolveLocalSkillVersion(
      { name: "renamed-skill" },
      skills,
      { "front/api-doc-sync": "renamed-skill" },
    ),
    "1.0.0",
  );
  assert.equal(
    resolveLocalSkillVersion({ name: "grill-me" }, skills, {}),
    "1.2.0",
  );
  assert.equal(
    resolveLocalSkillVersion({ name: "custom-local" }, skills, {}),
    null,
  );
});

test("installed matching supports the remote slug and returned local name", () => {
  assert.equal(isSkillHubInstalled(skills[0], ["api-doc-sync"]), true);
  assert.equal(isSkillHubInstalled(skills[0], ["renamed-skill"]), false);
  assert.equal(
    isSkillHubInstalled(skills[0], ["renamed-skill"], "renamed-skill"),
    true,
  );
});
