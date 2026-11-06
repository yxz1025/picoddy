import assert from "node:assert/strict";
import test from "node:test";

import { presentActiveExpert } from "./expertConversationModel.ts";
import type { Conversation } from "./useStore.ts";
import type { ExpertSummary } from "../types/experts.ts";

const createdConversation: Conversation = {
  id: "conversation-1",
  title: "创建时标题",
  category: "assistant",
  status: "idle",
  modelProvider: "deepseek",
  modelId: "deepseek-v4-flash",
  createdAt: 1,
  updatedAt: 1,
};

const expert: ExpertSummary = {
  id: "architect",
  name: "架构专家",
  expertType: "agent",
  categoryId: "engineering",
  description: "负责架构设计",
  icon: "",
  tags: [],
  quickPrompts: [],
  catalogSource: "builtin",
  revision: "v1",
  available: true,
};

test("presents the bound expert immediately while preserving refreshed conversation fields", () => {
  const refreshed = {
    ...createdConversation,
    title: "服务端刷新标题",
    workspaceId: "workspace-1",
  };

  assert.deepEqual(
    presentActiveExpert([refreshed], createdConversation, expert),
    [{
      ...refreshed,
      expertId: expert.id,
      expertRevision: expert.revision,
      expertCatalogSource: expert.catalogSource,
      expert,
    }],
  );
});

test("keeps a newly created expert conversation visible when refresh omits it", () => {
  const other = { ...createdConversation, id: "conversation-2" };

  assert.deepEqual(
    presentActiveExpert([other], createdConversation, expert),
    [{
      ...createdConversation,
      expertId: expert.id,
      expertRevision: expert.revision,
      expertCatalogSource: expert.catalogSource,
      expert,
    }, other],
  );
});

test("uses the persisted binding returned by the assignment API", () => {
  const refreshed = {
    ...createdConversation,
    expertId: null,
    expertRevision: null,
    expertCatalogSource: null,
  };

  assert.deepEqual(
    presentActiveExpert([refreshed], createdConversation, expert, {
      expertId: "engineering--architect",
      revision: "skillhub-v2",
      catalogSource: "catalog",
    }),
    [{
      ...refreshed,
      expertId: "engineering--architect",
      expertRevision: "skillhub-v2",
      expertCatalogSource: "catalog",
      expert,
    }],
  );
});
