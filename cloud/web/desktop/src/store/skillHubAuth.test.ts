import assert from "node:assert/strict";
import test from "node:test";
import { useSkillStore } from "./useSkillStore";

function mockIPC(call: (channel: string) => Promise<unknown>) {
  Object.defineProperty(globalThis, "window", { value: { electronAPI: { call } }, configurable: true });
}

test("menu entry and simultaneous catalog loads wait for a single authentication check", async () => {
  const calls: string[] = [];
  let release!: () => void;
  const gate = new Promise<void>(resolve => { release = resolve; });
  mockIPC(async channel => {
    calls.push(channel);
    if (channel === "skillhub.ensureAuth") {
      await gate;
      return { authenticated: true };
    }
    return [];
  });
  const menu = useSkillStore.getState().ensureSkillHubAuth();
  const skills = useSkillStore.getState().loadSkillHubSkills();
  const experts = useSkillStore.getState().loadSkillHubExperts();
  assert.deepEqual(calls, ["skillhub.ensureAuth"]);
  assert.equal(useSkillStore.getState().skillHubAuthChecking, true);
  release();
  await Promise.all([menu, skills, experts]);
  assert.equal(calls.filter(c => c === "skillhub.ensureAuth").length, 1);
  assert.ok(calls.includes("skillhub.list"));
  assert.ok(calls.includes("skillhub.experts"));
  assert.equal(useSkillStore.getState().skillHubAuthError, null);
  assert.equal(useSkillStore.getState().skillHubAuthChecking, false);
  await useSkillStore.getState().ensureSkillHubAuth();
  assert.equal(calls.filter(c => c === "skillhub.ensureAuth").length, 2);
});

test("authentication errors are visible and stop dependent catalog requests; retry recovers", async () => {
  const calls: string[] = [];
  mockIPC(async channel => {
    calls.push(channel);
    return { name: "ApiError", message: "请配置 SkillHub 共享密钥", status: 503 };
  });
  await useSkillStore.getState().loadSkillHubSkills();
  assert.deepEqual(calls, ["skillhub.ensureAuth"]);
  assert.equal(useSkillStore.getState().skillHubAuthError, "请配置 SkillHub 共享密钥");
  assert.equal(useSkillStore.getState().skillHubLoading, false);
  mockIPC(async () => ({ authenticated: true }));
  assert.equal(await useSkillStore.getState().ensureSkillHubAuth(), true);
  assert.equal(useSkillStore.getState().skillHubAuthError, null);
});
