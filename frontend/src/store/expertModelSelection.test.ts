import assert from "node:assert/strict";
import test from "node:test";
import { useStore } from "./useStore.ts";
import { useSkillStore } from "./useSkillStore.ts";

test("summoning an expert persists the selected model before binding or navigation", async () => {
  const originalApp = useStore.getState();
  const originalSkills = useSkillStore.getState();
  const originalWindow = Object.getOwnPropertyDescriptor(globalThis, "window");
  const expert = {
    id: "architect", name: "架构专家", expertType: "agent" as const,
    categoryId: "engineering", description: "设计", icon: "", tags: [],
    quickPrompts: [], catalogSource: "builtin" as const, revision: "v1", available: true,
  };
  const calls: string[] = [];
  Object.defineProperty(globalThis, "window", { configurable: true, value: {
    electronAPI: { call: async (channel: string, payload: any) => {
      calls.push(channel);
      if (channel === "session.start") {
        assert.equal(payload.provider, "custom-provider");
        assert.equal(payload.model, "configured-model");
        return { id: "expert-chat", modelProvider: payload.provider, modelId: payload.model };
      }
      if (channel === "expert.assign") return { ok: true, expert };
      throw new Error(`Unexpected channel: ${channel}`);
    } },
  } });
  try {
    useStore.setState({
      modelProvider: "custom-provider", modelId: "configured-model",
      conversations: [], loadConversations: async () => {},
      selectConversation: async (id) => {
        const conversation = useStore.getState().conversations.find((item) => item.id === id);
        assert.equal(conversation?.modelProvider, "custom-provider");
        assert.equal(conversation?.modelId, "configured-model");
      },
    });
    useSkillStore.setState({ experts: [expert] });
    await useSkillStore.getState().startExpertChat(expert.id, expert.name);
    assert.deepEqual(calls, ["session.start", "expert.assign"]);
  } finally {
    useStore.setState(originalApp, true);
    useSkillStore.setState(originalSkills, true);
    if (originalWindow) Object.defineProperty(globalThis, "window", originalWindow);
    else Reflect.deleteProperty(globalThis, "window");
  }
});
