import assert from "node:assert/strict";
import test from "node:test";
import { useStore, type Conversation } from "./useStore.ts";

const conversation = (id: string, status: string): Conversation => ({
  id, status, title: id, category: "assistant", modelProvider: "custom",
  modelId: "model", createdAt: 1, updatedAt: 1,
});

test("conversation activity only locks the selected composer", () => {
  const original = useStore.getState();
  try {
    useStore.setState({ currentConvId: "b", busy: false,
      conversations: [conversation("a", "idle"), conversation("b", "idle")] });
    useStore.getState().updateConversationStatus("a", "running");
    assert.equal(useStore.getState().busy, false);
    assert.equal(useStore.getState().conversations[0].status, "running");
    for (const status of ["running", "pending", "initializing"]) {
      useStore.setState({ busy: false });
      useStore.getState().updateConversationStatus("b", status);
      assert.equal(useStore.getState().busy, true);
    }
    useStore.getState().updateConversationStatus("a", "done");
    assert.equal(useStore.getState().busy, true);
    // Completion of the current stream remains responsible for unlocking it.
    useStore.getState().updateConversationStatus("b", "idle");
    assert.equal(useStore.getState().busy, true);
    useStore.setState({ currentConvId: null, busy: false });
    useStore.getState().updateConversationStatus("a", "running");
    assert.equal(useStore.getState().busy, false);
  } finally { useStore.setState(original, true); }
});

test("switching conversations restores the destination busy state without stopping other tasks", async () => {
  const original = useStore.getState();
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const eventDescriptor = Object.getOwnPropertyDescriptor(globalThis, "EventSource");
  const calls: string[] = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    setTimeout: () => 0, clearTimeout: () => {},
    electronAPI: { call: async (channel: string) => {
      calls.push(channel);
      assert.equal(channel, "session.getMessages");
      return [];
    } },
  } });
  Object.defineProperty(globalThis, "EventSource", { configurable: true, value: class {
    close() {}
  } });
  try {
    useStore.setState({ currentConvId: "a", busy: true, loadConversations: async () => {},
      conversations: [conversation("a", "running"), conversation("b", "idle"),
        conversation("c", "initializing"), conversation("d", "pending")] });
    for (const [id, expected] of [["b", false], ["a", true], ["c", true], ["d", true], ["missing", false]] as const) {
      await useStore.getState().selectConversation(id);
      assert.equal(useStore.getState().busy, expected, id);
    }
    assert.equal(useStore.getState().conversations[0].status, "running");
    assert.ok(calls.length > 0);
  } finally {
    useStore.getState().resetToWelcome();
    useStore.setState(original, true);
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else Reflect.deleteProperty(globalThis, "window");
    if (eventDescriptor) Object.defineProperty(globalThis, "EventSource", eventDescriptor);
    else Reflect.deleteProperty(globalThis, "EventSource");
  }
});

test("sending a prompt marks the conversation running for later switches", async () => {
  const original = useStore.getState();
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const eventDescriptor = Object.getOwnPropertyDescriptor(globalThis, "EventSource");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    setTimeout: () => 0, clearTimeout: () => {},
    electronAPI: { call: async (channel: string) => {
      if (channel === "client-invoke") return { ok: true };
      if (channel === "session.getMessages") return [];
      throw new Error(`Unexpected channel: ${channel}`);
    } },
  } });
  Object.defineProperty(globalThis, "EventSource", { configurable: true, value: class {
    readyState = 1;
    onopen?: () => void;
    close() {}
    constructor() { queueMicrotask(() => this.onopen?.()); }
  } });
  try {
    useStore.setState({ currentConvId: "a", busy: false,
      modelProvider: "custom", modelId: "model", messages: [],
      conversations: [conversation("a", "idle")] });
    assert.equal(await useStore.getState().sendMessage("继续"), true);
    assert.equal(useStore.getState().conversations[0].status, "running");
    await useStore.getState().selectConversation("a");
    assert.equal(useStore.getState().busy, true);
  } finally {
    useStore.getState().resetToWelcome();
    useStore.setState(original, true);
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else Reflect.deleteProperty(globalThis, "window");
    if (eventDescriptor) Object.defineProperty(globalThis, "EventSource", eventDescriptor);
    else Reflect.deleteProperty(globalThis, "EventSource");
  }
});

test("failed prompt shows the error and stays idle after switching back", async () => {
  const original = useStore.getState();
  const windowDescriptor = Object.getOwnPropertyDescriptor(globalThis, "window");
  const eventDescriptor = Object.getOwnPropertyDescriptor(globalThis, "EventSource");
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    setTimeout: () => 0, clearTimeout: () => {},
    electronAPI: { call: async (channel: string) => {
      if (channel === "client-invoke") return structuredClone(Object.assign(new Error("仓库超过 32MB，请缩小分析范围"), { name: "ApiError", status: 400 }));
      if (channel === "session.getMessages") return [];
      throw new Error(`Unexpected channel: ${channel}`);
    } },
  } });
  Object.defineProperty(globalThis, "EventSource", { configurable: true, value: class {
    readyState = 1;
    onopen?: () => void;
    close() {}
    constructor() { queueMicrotask(() => this.onopen?.()); }
  } });
  try {
    useStore.setState({ currentConvId: "a", busy: false,
      modelProvider: "custom", modelId: "model", messages: [],
      conversations: [conversation("a", "idle")] });
    assert.equal(await useStore.getState().sendMessage("继续"), false);
    assert.equal(useStore.getState().busy, false);
    assert.match(useStore.getState().messages.at(-1)!.content, /超过 32MB/);
    assert.equal(useStore.getState().conversations[0].status, "idle");
    await useStore.getState().selectConversation("a");
    assert.equal(useStore.getState().busy, false);
  } finally {
    useStore.getState().resetToWelcome();
    useStore.setState(original, true);
    if (windowDescriptor) Object.defineProperty(globalThis, "window", windowDescriptor);
    else Reflect.deleteProperty(globalThis, "window");
    if (eventDescriptor) Object.defineProperty(globalThis, "EventSource", eventDescriptor);
    else Reflect.deleteProperty(globalThis, "EventSource");
  }
});
