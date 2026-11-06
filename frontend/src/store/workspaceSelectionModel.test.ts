import assert from "node:assert/strict";
import test from "node:test";

import {
  deriveWorkspaceSelection,
  resolveWorkspaceActivationTarget,
} from "./workspaceSelectionModel";

test("keeps a conversation workspace selected after the first message", () => {
  assert.equal(
    deriveWorkspaceSelection("conversation-1", "workspace-1", null),
    "workspace-1",
  );
});

test("uses the composer selection only before a conversation exists", () => {
  assert.equal(
    deriveWorkspaceSelection(null, null, "workspace-2"),
    "workspace-2",
  );
});

test("activates a workspace in the composer before a conversation exists", () => {
  assert.deepEqual(resolveWorkspaceActivationTarget(null), {
    kind: "composer",
  });
});

test("activates a workspace by binding the current conversation", () => {
  assert.deepEqual(resolveWorkspaceActivationTarget("conversation-1"), {
    kind: "conversation",
    conversationId: "conversation-1",
  });
});
