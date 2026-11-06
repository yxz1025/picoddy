import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import test from "node:test";

import {
  createLocalProjectWorkflowService,
  type LocalProjectWorkflowRuntime,
} from "./local_workflow.ts";

function projectInput(dirPath: string) {
  return {
    name: "本地研发", description: "实现一个可审核的功能", instructions: "保留真实文件与验证证据",
    dirPath, templateId: "test", connectors: ["filesystem"], repositories: [],
    stages: [
      { id: "discovery", title: "需求", goal: "明确范围", expertId: "product", expertName: "产品专家" },
      { id: "build", title: "开发", goal: "完成代码", expertId: "developer", expertName: "开发专家" },
    ],
  };
}

function harness() {
  const root = mkdtempSync(join(tmpdir(), "picoddy-local-project-"));
  const db = new DatabaseSync(":memory:");
  const conversations = new Map<string, { id: string; status: string; workspaceId: string; expertId?: string }>();
  const deleted: string[] = [];
  let created = 0;
  let failBinding = false;
  const runtime: LocalProjectWorkflowRuntime = {
    ensureWorkspace: async ({ dirPath }) => ({ id: `ws:${dirPath}`, created: true }),
    deleteWorkspace: async () => {},
    createConversation: async ({ workspaceId }) => {
      created += 1;
      const value = { id: `conversation-${created}`, status: "idle", workspaceId };
      conversations.set(value.id, value);
      return value;
    },
    deleteConversation: async (id) => { deleted.push(id); conversations.delete(id); },
    bindExpert: async (id, expertId) => {
      if (failBinding) throw new Error("binding failed");
      conversations.get(id)!.expertId = expertId;
    },
    getConversation: async (id) => conversations.get(id) ?? null,
    isConversationBusy: (id) => conversations.get(id)?.status === "running",
  };
  const service = createLocalProjectWorkflowService({ db, runtime });
  return {
    root, service, runtime, conversations, deleted, created: () => created,
    failNextBinding: () => { failBinding = true; }, allowBinding: () => { failBinding = false; },
  };
}

test('settings cannot replace the expert of an existing stage session', async () => {
  const h=harness();
  const input=projectInput(join(h.root,'project'));
  const project=await h.service.createProject('account',input);
  await h.service.startStage('account',project.id,{stageId:'discovery',modelProvider:'openai',modelId:'gpt'});
  assert.throws(()=>h.service.updateSettings('account',project.id,{stages:input.stages.map(s=>({...s,expertId:'other'}))}),/专家|expert/);
});

test('a concurrent settings write does not get overwritten by a slow stage start', async () => {
  const h=harness();
  const project=await h.service.createProject('account',projectInput(join(h.root,'project')));
  let release!:()=>void;
  let entered!:()=>void;
  const called=new Promise<void>(resolve=>{entered=resolve;});
  const waiting=new Promise<void>(resolve=>{release=resolve;});
  h.runtime.bindExpert=async()=>{entered();await waiting;};
  const pending=h.service.startStage('account',project.id,{stageId:'discovery',modelProvider:'openai',modelId:'gpt'});
  await called;
  h.service.updateSettings('account',project.id,{name:'新的项目名称'});
  release();
  await assert.rejects(pending,/版本|revision|变化/);
  assert.equal(h.service.getProject('account',project.id).name,'新的项目名称');
  assert.equal(h.service.getProject('account',project.id).stages[0].conversationId,null);
});

test('reconfirming an upstream stage unlocks its existing downstream session for revision', async () => {
  const h = harness();
  let project = await h.service.createProject('account', projectInput(join(h.root, 'project')));
  await h.service.startStage('account',project.id,{stageId:'discovery',modelProvider:'openai',modelId:'gpt'});
  project = await h.service.submitReview('account',project.id,{stageId:'discovery',summary:'first',risks:'',assetIds:[]});
  project = h.service.confirmStage('account',project.id,{stageId:'discovery',revision:project.revision});
  const next = await h.service.startStage('account',project.id,{stageId:'build',modelProvider:'openai',modelId:'gpt'});
  project = h.service.reopenStage('account',project.id,{stageId:'discovery'});
  project = await h.service.submitReview('account',project.id,{stageId:'discovery',summary:'revised',risks:'',assetIds:[]});
  project = h.service.confirmStage('account',project.id,{stageId:'discovery',revision:project.revision});
  assert.equal(project.stages[1].status,'active');
  const restored = await h.service.startStage('account',project.id,{stageId:'build',modelProvider:'openai',modelId:'gpt'});
  assert.equal(restored.conversation.id,next.conversation.id);
});

test("projects are persisted and scoped to the active account", async () => {
  const h = harness();
  const project = await h.service.createProject("account-a", projectInput(join(h.root, "project")));
  assert.equal(h.service.listProjects("account-a").length, 1);
  assert.equal(h.service.listProjects("account-b").length, 0);
  assert.equal(h.service.getProject("account-a", project.id).name, "本地研发");
  assert.equal("accountId" in h.service.getProject("account-a", project.id), false);
  assert.throws(() => h.service.getProject("account-b", project.id), /not found|不存在/i);
  assert.equal(readFileSync(join(project.dirPath, ".picoddy", "project.json"), "utf8").includes(project.id), true);
  await assert.rejects(h.service.createProject("account-a", projectInput(project.dirPath)), /目录.*项目|占用|owned/i);
});

test("repository validation records real branch, commit and dirty state", async () => {
  const h = harness();
  const repo = join(h.root, "repo");
  mkdirSync(repo);
  execFileSync("git", ["init", "-b", "main", repo]);
  execFileSync("git", ["-C", repo, "config", "user.email", "test@example.com"]);
  execFileSync("git", ["-C", repo, "config", "user.name", "Test"]);
  writeFileSync(join(repo, "README.md"), "first\n");
  execFileSync("git", ["-C", repo, "add", "README.md"]);
  execFileSync("git", ["-C", repo, "commit", "-m", "initial"]);
  writeFileSync(join(repo, "README.md"), "changed\n");
  const project = await h.service.createProject("account", projectInput(join(h.root, "project")));
  const updated = await h.service.addRepository("account", project.id, { name: "主仓库", path: repo, role: "backend" });
  assert.equal(updated.repositories[0].branch, "main");
  assert.match(updated.repositories[0].commit, /^[0-9a-f]{40}$/);
  assert.equal(updated.repositories[0].dirty, true);
  await assert.rejects(h.service.addRepository("account", project.id, { name: "坏仓库", path: join(h.root, "missing"), role: "backend" }), /仓库|repository|目录/i);
});

test("asset import creates a project work file and immutable hash snapshot", async () => {
  const h = harness();
  const source = join(h.root, "scope.md");
  writeFileSync(source, "scope v1\n");
  const project = await h.service.createProject("account", projectInput(join(h.root, "project")));
  const updated = await h.service.addAsset("account", project.id, { path: source, stageId: "discovery" });
  const asset = updated.assets[0];
  const internal = h.service.inspectAssetSnapshot("account", project.id, asset.id);
  assert.equal(readFileSync(asset.path, "utf8"), "scope v1\n");
  assert.equal(readFileSync(internal.snapshotPath, "utf8"), "scope v1\n");
  assert.notEqual(asset.path, internal.snapshotPath);
  assert.match(asset.hash, /^[0-9a-f]{64}$/);
  writeFileSync(asset.path, "scope v2\n");
  assert.equal(readFileSync(internal.snapshotPath, "utf8"), "scope v1\n");
});

test("start is sequential and idempotent, and binding failure rolls back retry state", async () => {
  const h = harness();
  const project = await h.service.createProject("account", projectInput(join(h.root, "project")));
  await assert.rejects(h.service.startStage("account", project.id, { stageId: "build", modelProvider: "openai", modelId: "gpt" }), /前序|current|当前/i);
  const [first, retry] = await Promise.all([
    h.service.startStage("account", project.id, { stageId: "discovery", modelProvider: "openai", modelId: "gpt" }),
    h.service.startStage("account", project.id, { stageId: "discovery", modelProvider: "openai", modelId: "gpt" }),
  ]);
  assert.equal(first.conversation.id, retry.conversation.id);
  assert.equal(h.created(), 1);
  assert.equal(first.project.stages[0].status, "active");

  const failedHarness = harness();
  const failedProject = await failedHarness.service.createProject("account", projectInput(join(failedHarness.root, "project")));
  failedHarness.failNextBinding();
  await assert.rejects(failedHarness.service.startStage("account", failedProject.id, { stageId: "discovery", modelProvider: "openai", modelId: "gpt" }), /binding failed/);
  assert.deepEqual(failedHarness.deleted, ["conversation-1"]);
  assert.equal(failedHarness.service.getProject("account", failedProject.id).stages[0].conversationId, null);
  failedHarness.allowBinding();
  const recovered = await failedHarness.service.startStage("account", failedProject.id, { stageId: "discovery", modelProvider: "openai", modelId: "gpt" });
  assert.equal(recovered.conversation.id, "conversation-2");
});

test("review is file-backed; confirmation validates revision and hashes then advances once", async () => {
  const h = harness();
  let project = await h.service.createProject("account", projectInput(join(h.root, "project")));
  ({ project } = await h.service.startStage("account", project.id, { stageId: "discovery", modelProvider: "openai", modelId: "gpt" }));
  project = await h.service.submitReview("account", project.id, { stageId: "discovery", summary: "范围已经明确", risks: "仍需确认性能目标", assetIds: [] });
  const reviewRevision = project.revision;
  const reviewAsset = project.assets.find((asset) => project.stages[0].review!.assetIds.includes(asset.id))!;
  assert.match(readFileSync(reviewAsset.path, "utf8"), /范围已经明确/);
  assert.throws(() => h.service.confirmStage("account", project.id, { stageId: "discovery", revision: reviewRevision - 1 }), /版本|revision/i);
  project = h.service.confirmStage("account", project.id, { stageId: "discovery", revision: reviewRevision });
  assert.equal(project.stages[0].status, "completed");
  assert.equal(project.currentStageId, "build");
  assert.equal(project.assets.find((asset) => asset.id === reviewAsset.id)!.confirmed, true);
  const repeated = h.service.confirmStage("account", project.id, { stageId: "discovery", revision: reviewRevision });
  assert.equal(repeated.revision, project.revision);
});

test("confirmation rejects changed work files and running conversations", async () => {
  const h = harness();
  let project = await h.service.createProject("account", projectInput(join(h.root, "project")));
  const started = await h.service.startStage("account", project.id, { stageId: "discovery", modelProvider: "openai", modelId: "gpt" });
  project = await h.service.submitReview("account", project.id, { stageId: "discovery", summary: "ok", risks: "", assetIds: [] });
  const asset = project.assets.find((item) => project.stages[0].review!.assetIds.includes(item.id))!;
  writeFileSync(asset.path, "tampered");
  assert.throws(() => h.service.confirmStage("account", project.id, { stageId: "discovery", revision: project.revision }), /文件|hash|变化/i);
  writeFileSync(asset.path, readFileSync(h.service.inspectAssetSnapshot("account", project.id, asset.id).snapshotPath));
  h.conversations.get(started.conversation.id)!.status = "running";
  assert.throws(() => h.service.confirmStage("account", project.id, { stageId: "discovery", revision: project.revision }), /进行中|busy|运行/i);
});

test("reopening an upstream stage marks completed downstream stages for review", async () => {
  const h = harness();
  let project = await h.service.createProject("account", projectInput(join(h.root, "project")));
  for (const stageId of ["discovery", "build"]) {
    ({ project } = await h.service.startStage("account", project.id, { stageId, modelProvider: "openai", modelId: "gpt" }));
    project = await h.service.submitReview("account", project.id, { stageId, summary: `${stageId} done`, risks: "", assetIds: [] });
    project = h.service.confirmStage("account", project.id, { stageId, revision: project.revision });
  }
  project = h.service.reopenStage("account", project.id, { stageId: "discovery" });
  assert.equal(project.currentStageId, "discovery");
  assert.equal(project.stages[0].status, "active");
  assert.equal(project.stages[1].status, "needs-review");
  assert.equal(project.stages[1].approvedAt, null);
});

test("conversation context is account-scoped and validates expert plus confirmed upstream assets", async () => {
  const h = harness();
  let project = await h.service.createProject("account", projectInput(join(h.root, "project")));
  ({ project } = await h.service.startStage("account", project.id, { stageId: "discovery", modelProvider: "openai", modelId: "gpt" }));
  project = await h.service.submitReview("account", project.id, { stageId: "discovery", summary: "scope", risks: "", assetIds: [] });
  project = h.service.confirmStage("account", project.id, { stageId: "discovery", revision: project.revision });
  const started = await h.service.startStage("account", project.id, { stageId: "build", modelProvider: "openai", modelId: "gpt" });
  const context = await h.service.getContextForConversation("account", started.conversation.id);
  assert.equal(context.stage.id, "build");
  assert.deepEqual(context.connectorIds, ["filesystem"]);
  assert.equal(context.upstream[0].stageId, "discovery");
  assert.equal(context.upstream[0].assets.length, 1);
  assert.notEqual(context.upstream[0].assets[0].path, project.assets[0].path);
  assert.equal(context.project.assets.find((asset) => asset.id === project.assets[0].id)!.path, context.upstream[0].assets[0].path);
  await assert.rejects(h.service.getContextForConversation("other", started.conversation.id), /not found|无权/i);
  h.conversations.get(started.conversation.id)!.expertId = "wrong";
  await assert.rejects(h.service.validateConversationExecution("account", started.conversation.id), /专家|expert/i);
});

test("editing confirmed work files invalidates downstream while immutable snapshots remain usable history", async () => {
  const h = harness();
  let project = await h.service.createProject("account", projectInput(join(h.root, "project")));
  ({ project } = await h.service.startStage("account", project.id, { stageId: "discovery", modelProvider: "openai", modelId: "gpt" }));
  project = await h.service.submitReview("account", project.id, { stageId: "discovery", summary: "scope", risks: "", assetIds: [] });
  project = h.service.confirmStage("account", project.id, { stageId: "discovery", revision: project.revision });
  const approved = project.assets.find((asset) => asset.confirmed)!;
  const snapshot = h.service.inspectAssetSnapshot("account", project.id, approved.id).snapshotPath;
  const snapshotBytes = readFileSync(snapshot);
  const started = await h.service.startStage("account", project.id, { stageId: "build", modelProvider: "openai", modelId: "gpt" });
  writeFileSync(approved.path, "changed after approval");

  project = h.service.getProject("account", project.id);
  assert.equal(project.stages[1].status, "needs-review");
  assert.deepEqual(readFileSync(snapshot), snapshotBytes);
  await assert.rejects(h.service.getContextForConversation("account", started.conversation.id), /失效|review|阶段/i);
});

test("mutations reject when any conversation in the project is busy", async () => {
  const h = harness();
  let project = await h.service.createProject("account", projectInput(join(h.root, "project")));
  const first = await h.service.startStage("account", project.id, { stageId: "discovery", modelProvider: "openai", modelId: "gpt" });
  project = await h.service.submitReview("account", project.id, { stageId: "discovery", summary: "scope", risks: "", assetIds: [] });
  project = h.service.confirmStage("account", project.id, { stageId: "discovery", revision: project.revision });
  h.conversations.get(first.conversation.id)!.status = "running";
  const source = join(h.root, "new.md"); writeFileSync(source, "new");
  await assert.rejects(h.service.addAsset("account", project.id, { path: source, stageId: "build" }), /运行|busy/i);
});

test("a new conversation turn invalidates the pending review and its confirmation revision", async () => {
  const h = harness();
  let project = await h.service.createProject("account", projectInput(join(h.root, "project")));
  const started = await h.service.startStage("account", project.id, { stageId: "discovery", modelProvider: "openai", modelId: "gpt" });
  project = await h.service.submitReview("account", project.id, { stageId: "discovery", summary: "candidate", risks: "", assetIds: [] });
  const staleReviewRevision = project.revision;
  const before = await h.service.getContextForConversation("account", started.conversation.id);

  const after = await h.service.beginConversationTurn("account", started.conversation.id, before!.executionRevision);

  assert.equal(after!.stage.status, "active");
  assert.equal(after!.stage.review, null);
  assert.notEqual(after!.executionRevision.projectRevision, before!.executionRevision.projectRevision);
  assert.throws(() => h.service.confirmStage("account", project.id, { stageId: "discovery", revision: staleReviewRevision }), /版本|交付|review/i);
});

test("settings and archive mutations are revisioned and archived projects cannot start", async () => {
  const h = harness();
  let project = await h.service.createProject("account", projectInput(join(h.root, "project")));
  const originalRevision = project.revision;
  project = h.service.updateSettings("account", project.id, { name: "新名称", connectors: ["git", "git"] });
  assert.equal(project.name, "新名称");
  assert.deepEqual(project.connectors, ["git"]);
  assert.ok(project.revision > originalRevision);
  project = h.service.setArchived("account", project.id, true);
  assert.equal(project.archived, true);
  await assert.rejects(h.service.startStage("account", project.id, { stageId: "discovery", modelProvider: "openai", modelId: "gpt" }), /归档/);
  project = h.service.setArchived("account", project.id, false);
  assert.equal(project.archived, false);
});
