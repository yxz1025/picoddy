import assert from "node:assert/strict";
import test from "node:test";

import { createLocalProjectHttpAdapter } from "./local_workflow_http.ts";

test("HTTP adapter always scopes collection and detail operations to active auth", async () => {
  const calls: Array<{ method: string; accountId: string; id?: string; body?: unknown }> = [];
  const project = { id: "project-1" } as any;
  const service = {
    listProjects(accountId: string) { calls.push({ method: "list", accountId }); return [project]; },
    createProject(accountId: string, body: unknown) { calls.push({ method: "create", accountId, body }); return project; },
    getProject(accountId: string, id: string) { calls.push({ method: "get", accountId, id }); return project; },
    updateSettings(accountId: string, id: string, body: unknown) { calls.push({ method: "settings", accountId, id, body }); return project; },
  } as any;
  const handle = createLocalProjectHttpAdapter({ service, getAccountId: () => "active-account" });

  const list = await handle(new Request("http://localhost/api/local-projects"), "/api/local-projects");
  const create = await handle(new Request("http://localhost/api/local-projects", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ accountId: "attacker", name: "x" }),
  }), "/api/local-projects");
  const settings = await handle(new Request("http://localhost/api/local-projects/project-1", {
    method: "POST", headers: { "content-type": "application/json" },
    body: JSON.stringify({ action: "settings", accountId: "attacker", name: "new" }),
  }), "/api/local-projects/project-1");

  assert.equal(list!.status, 200);
  assert.equal(create!.status, 200);
  assert.equal(settings!.status, 200);
  assert.deepEqual(calls.map((call) => call.accountId), ["active-account", "active-account", "active-account"]);
  assert.equal((calls[1].body as any).accountId, undefined);
  assert.equal((calls[2].body as any).accountId, undefined);
});

test("HTTP adapter dispatches every detail action and returns start conversation envelope", async () => {
  const actions: string[] = [];
  const project = { id: "project-1" } as any;
  const service = {
    setArchived() { actions.push("archive"); return project; },
    addRepository() { actions.push("repository"); return project; },
    addAsset() { actions.push("asset"); return project; },
    startStage() { actions.push("start"); return { project, conversation: { id: "conversation-1" } }; },
    submitReview() { actions.push("review"); return project; },
    confirmStage() { actions.push("confirm"); return project; },
    reopenStage() { actions.push("reopen"); return project; },
  } as any;
  const handle = createLocalProjectHttpAdapter({ service, getAccountId: () => "account" });
  for (const action of ["archive", "repository", "asset", "start", "review", "confirm", "reopen"]) {
    const response = await handle(new Request("http://localhost/api/local-projects/project-1", {
      method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ action }),
    }), "/api/local-projects/project-1");
    assert.equal(response!.status, 200);
    const body = await response!.json() as any;
    if (action === "start") assert.equal(body.conversation.id, "conversation-1");
    else assert.equal(body.id, "project-1");
  }
  assert.deepEqual(actions, ["archive", "repository", "asset", "start", "review", "confirm", "reopen"]);
});

test("HTTP adapter supports GET refresh and maps domain status/code", async () => {
  const service = {
    refreshPresentedAssets() { throw Object.assign(new Error("busy"), { status: 409, code: "STAGE_BUSY" }); },
  } as any;
  const handle = createLocalProjectHttpAdapter({ service, getAccountId: () => "account" });
  const response = await handle(new Request("http://localhost/api/local-projects/project-1?refresh=1"), "/api/local-projects/project-1");
  assert.equal(response!.status, 409);
  assert.deepEqual(await response!.json(), { error: "busy", code: "STAGE_BUSY" });
});

test("HTTP adapter returns null for routes outside its namespace and 401 without auth", async () => {
  const handle = createLocalProjectHttpAdapter({ service: {} as any, getAccountId: () => null });
  assert.equal(await handle(new Request("http://localhost/api/conv"), "/api/conv"), null);
  const response = await handle(new Request("http://localhost/api/local-projects"), "/api/local-projects");
  assert.equal(response!.status, 401);
});
