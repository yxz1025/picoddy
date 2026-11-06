import assert from "node:assert/strict";
import test from "node:test";
import { useStore, type Conversation } from "./useStore.ts";

test("delete failure preserves the task; successful deletion resets only the selected task", async () => {
  const original = useStore.getState();
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  let fail = true;
  const alerts: string[] = [];
  const conversation = (id: string): Conversation => ({
    id, title: id, status: "running", category: "assistant", modelProvider: "custom",
    modelId: "model", createdAt: 1, updatedAt: 1,
  });
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    electronAPI: { call: async (channel: string) => {
      assert.equal(channel, "session.delete");
      if (fail) throw new Error("文件被占用");
      return { ok: true };
    } },
  } });
  try {
    useStore.setState({
      currentConvId: "a", busy: true, taskStatus: { phase: "running", message: "执行中" },
      conversations: [conversation("a"), conversation("b")],
      loadConversations: async () => {},
      showUiAlert: async options => { alerts.push(typeof options === "string" ? options : options.message); },
    });
    await useStore.getState().deleteConversation("a");
    assert.match(alerts[0], /文件被占用/);
    assert.equal(useStore.getState().conversations.length, 2);
    assert.equal(useStore.getState().currentConvId, "a");
    fail = false;
    await useStore.getState().deleteConversation("b");
    assert.equal(useStore.getState().currentConvId, "a");
    assert.equal(useStore.getState().busy, true);
    await useStore.getState().deleteConversation("a");
    assert.equal(useStore.getState().conversations.length, 0);
    assert.equal(useStore.getState().currentConvId, null);
    assert.equal(useStore.getState().busy, false);
    assert.equal(useStore.getState().taskStatus, null);
  } finally {
    useStore.setState(original, true);
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
