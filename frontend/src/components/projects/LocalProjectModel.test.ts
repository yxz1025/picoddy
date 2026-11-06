import assert from "node:assert/strict";
import test from "node:test";
import type { LocalProject } from "../../../../src/domains/project/shared/workflow";
import {
  createProjectDraft,
  filterLocalProjects,
  projectDraftError,
  stageStartBlocker,
} from "./LocalProjectModel";

function project(overrides: Partial<LocalProject> = {}): LocalProject {
  return {
    id: "project-1",
    name: "本地零售工作台",
    description: "改进库存预警",
    instructions: "保留现有实现",
    dirPath: "/work/retail",
    templateId: "development",
    connectors: [],
    repositories: [],
    stages: [{
      id: "discovery",
      title: "需求澄清",
      goal: "明确范围",
      expertId: "expert-product",
      expertName: "产品专家",
      status: "active",
      conversationId: null,
      review: null,
      approvedAt: null,
    }],
    assets: [],
    events: [],
    currentStageId: "discovery",
    archived: false,
    createdAt: 1,
    updatedAt: 2,
    revision: 1,
    ...overrides,
  };
}

test("filters projects by status and Chinese search text", () => {
  const items = [
    project(),
    project({ id: "review", name: "官网改版", stages: [{ ...project().stages[0], status: "review" }] }),
    project({ id: "archived", name: "历史迁移", archived: true }),
  ];

  assert.deepEqual(filterLocalProjects(items, "active", "库存").map(item => item.id), ["project-1"]);
  assert.deepEqual(filterLocalProjects(items, "review", "").map(item => item.id), ["review"]);
  assert.deepEqual(filterLocalProjects(items, "archived", "历史").map(item => item.id), ["archived"]);
});

test("blocks stage start until its installed expert is available", () => {
  const stage = project().stages[0];
  assert.equal(stageStartBlocker(stage, []), "请先为本阶段选择可用的专家");
  assert.equal(stageStartBlocker(stage, ["expert-product"]), null);
  assert.equal(stageStartBlocker({ ...stage, status: "completed" }, ["expert-product"]), "已完成阶段无需重新开始");
});

test("creates an editable draft from a template without inventing expert ids", () => {
  const draft = createProjectDraft("research");
  assert.equal(draft.templateId, "research");
  assert.equal(draft.stages.length, 3);
  assert.ok(draft.stages.every(stage => stage.expertId.length > 0));
  assert.ok(draft.stages.every(stage => stage.expertName.length > 0));
});

test("only requires a name and goal with valid template stages", () => {
  const draft = createProjectDraft("blank");
  assert.equal(projectDraftError(draft), "请为项目起个名字");
  assert.equal(projectDraftError({ ...draft, name: "项目", description: "目标" }), null);
  assert.equal(projectDraftError({ ...draft, name: "项目", description: "目标", instructions: "保留真实依据" }), null);
});
