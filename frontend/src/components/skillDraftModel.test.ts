import assert from "node:assert/strict";
import test from "node:test";

import {
  creatorComposerContext,
  isCreatorFirstUserMessage,
  shouldShowSkillDraftPanel,
} from "./skillDraftModel.ts";

const creator = { category: "skill_creator" };
const assistant = { category: "assistant" };
const firstUser = { id: "user-1", role: "user" };
const secondUser = { id: "user-2", role: "user" };

test("creator composer context selects the removable skill-creator tag", () => {
  assert.deepEqual(creatorComposerContext({ category: "skill_creator" }), {
    command: "/skill-creator",
    label: "skill-creator",
  });
  assert.equal(creatorComposerContext({ category: "assistant" }), null);
});

test("creator composer context is pending only before the first user message", () => {
  assert.deepEqual(creatorComposerContext(creator, []), {
    command: "/skill-creator",
    label: "skill-creator",
  });
  assert.equal(creatorComposerContext(creator, [firstUser]), null);
  assert.equal(creatorComposerContext(assistant, []), null);
});

test("creator message tag belongs only to the first user message", () => {
  const messages = [
    { id: "assistant-intro", role: "assistant" },
    firstUser,
    secondUser,
  ];
  assert.equal(isCreatorFirstUserMessage(creator, messages, firstUser), true);
  assert.equal(isCreatorFirstUserMessage(creator, messages, secondUser), false);
  assert.equal(isCreatorFirstUserMessage(assistant, messages, firstUser), false);
});

test("removing a failed optimistic user message restores pending context", () => {
  assert.equal(creatorComposerContext(creator, [firstUser]), null);
  assert.deepEqual(creatorComposerContext(creator, []), {
    command: "/skill-creator",
    label: "skill-creator",
  });
});

test("initial skill draft panel appears only when install-ready", () => {
  assert.equal(shouldShowSkillDraftPanel(null), false);
  assert.equal(shouldShowSkillDraftPanel({ status: "editing" }), false);
  assert.equal(
    shouldShowSkillDraftPanel({
      status: "valid",
      validation: { valid: false },
    }),
    false,
  );
  assert.equal(
    shouldShowSkillDraftPanel({
      status: "valid",
      validation: { valid: true },
    }),
    true,
  );
  assert.equal(shouldShowSkillDraftPanel({ status: "installed" }), true);
});

test("an installed skill revision keeps its existing draft panel", () => {
  assert.equal(
    shouldShowSkillDraftPanel({
      status: "editing",
      revisionOf: "existing-skill",
    }),
    true,
  );
});
