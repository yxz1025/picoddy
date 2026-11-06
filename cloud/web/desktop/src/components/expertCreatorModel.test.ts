import assert from "node:assert/strict";
import test from "node:test";

import {
  createExpertComposerBootstrap,
  EXPERT_CREATOR_PROMPT,
  takeExpertComposerBootstrap,
} from "./expertCreatorModel.ts";

test("expert creator bootstrap contains only the 参考设计 prompt", () => {
  const bootstrap = createExpertComposerBootstrap("conv-1");
  assert.equal(bootstrap.conversationId, "conv-1");
  assert.equal(
    bootstrap.text,
    "帮我创建一个 XXX 专家，擅长 XXXXX。我的经验是：[请补充你的行业背景、相关经验]",
  );
  assert.equal(bootstrap.text, EXPERT_CREATOR_PROMPT);
});

test("bootstrap can only be consumed by its target conversation", () => {
  const bootstrap = createExpertComposerBootstrap("conv-1");
  assert.deepEqual(takeExpertComposerBootstrap(bootstrap, "conv-2"), {
    text: null,
    remaining: bootstrap,
  });
  assert.deepEqual(takeExpertComposerBootstrap(bootstrap, "conv-1"), {
    text: bootstrap.text,
    remaining: null,
  });
  assert.deepEqual(takeExpertComposerBootstrap(null, "conv-1"), {
    text: null,
    remaining: null,
  });
});
