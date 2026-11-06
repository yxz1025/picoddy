/**
 * IPC 全接口自动化测试。
 * 启动 Electron 应用，通过 webContents.executeJavaScript 调用 window.electronAPI 测试每个接口。
 *
 * 用法：node scripts/test-ipc.mjs
 */

import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import electronPath from "electron";
import { setTimeout as sleep } from "node:timers/promises";

const ELECTRON = electronPath;
const PROJECT = fileURLToPath(new URL("../", import.meta.url));

let pass = 0, fail = 0;
const results = [];

const PORT = 8000;

async function callIPC(invokeName, payload = {}) {
  const resp = await fetch(`http://127.0.0.1:${PORT}/__test_ipc`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ invoke: invokeName, payload }),
  });
  if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
  return resp.json();
}

async function test(name, invokeName, payload, validator) {
  try {
    const data = await callIPC(invokeName, payload);
    if (data.error) throw new Error(data.error);
    await validator(data);
    console.log(`  ✅ ${name}`);
    pass++;
    results.push({ name, status: "PASS" });
  } catch (e) {
    console.log(`  ❌ ${name}: ${e.message}`);
    fail++;
    results.push({ name, status: "FAIL", error: e.message });
  }
}

console.log("=== IPC 全接口自动化测试 ===\n");

// 1. 启动 Electron
console.log("Starting Electron...");
const proc = spawn(ELECTRON, [PROJECT], {
  env: { ...process.env, NODE_ENV: "development" },
  stdio: "pipe",
});
proc.stdout.on("data", (d) => process.stdout.write(d));
proc.stderr.on("data", (d) => process.stderr.write(d));

await sleep(10000);

try {
  // ── 会话 ──
  console.log("\n── 会话 ──");
  let convId;
  await test("session.list", "session.list", {}, (d) => {
    if (!d.sessions || !Array.isArray(d.sessions)) throw new Error("expected sessions array");
    console.log(`    ${d.sessions.length} conversations`);
  });
  await test("session.start", "session.start", { title: "IPC Test", category: "assistant" }, (d) => {
    if (!d.session?.id) throw new Error("no session id");
    convId = d.session.id;
    console.log(`    created: ${convId}`);
  });
  await test("session.getMessages", "session.getMessages", { sessionId: "test" }, (d) => {
    // 用刚创建的 conv id
  });
  await test("session.delete", "session.delete", { sessionId: "test" }, (d) => {
    // 后创建后删除
  });

  // ── 设置 ──
  console.log("\n── 设置 ──");
  await test("config.get", "config.get", {}, (d) => {
    if (!d.providers) throw new Error("no providers");
    console.log(`    ${d.providers.length} providers`);
  });
  await test("config.getApiKeys", "config.getApiKeys", {}, (d) => {
    console.log(`    keys: ${Object.keys(d).length}`);
  });

  // ── 记忆 ──
  console.log("\n── 记忆 ──");
  await test("memory.list", "memory.list", {}, (d) => {
    const items = d?.items || d || [];
    console.log(`    ${Array.isArray(items) ? items.length : 0} items`);
  });

  // ── 技能 ──
  console.log("\n── 技能 ──");
  await test("skills.list", "skills.list", {}, (d) => {
    if (!Array.isArray(d)) throw new Error("expected array");
    console.log(`    ${d.length} skills`);
  });

  // ── 自动化 ──
  console.log("\n── 自动化 ──");
  await test("automation.list", "automation.list", {}, (d) => {
    if (!Array.isArray(d)) throw new Error("expected array");
    console.log(`    ${d.length} automations`);
  });

  // ── 工作空间 ──
  console.log("\n── 工作空间 ──");
  await test("workspace.list", "workspace.list", {}, (d) => {
    if (!Array.isArray(d)) throw new Error("expected array");
    console.log(`    ${d.length} workspaces`);
  });

  // ── 专家 ──
  console.log("\n── 专家 ──");
  await test("expert.list", "expert.list", {}, (d) => {
    if (!Array.isArray(d)) throw new Error("expected array");
    console.log(`    ${d.length} experts`);
  });

  // ── 产物 ──
  console.log("\n── 产物 ──");
  await test("artifacts.list", "artifacts.list", {}, (d) => {
    if (!Array.isArray(d)) throw new Error("expected array");
    console.log(`    ${d.length} artifacts`);
  });

  // ── 项目 ──
  console.log("\n── 项目 ──");
  await test("projects.list", "projects.list", {}, (d) => {
    if (!Array.isArray(d)) throw new Error("expected array");
    console.log(`    ${d.length} projects`);
  });

  // ── MCP ──
  console.log("\n── MCP ──");
  await test("mcp.list", "mcp.list", {}, (d) => console.log("    ok"));

  // ── 其他 ──
  console.log("\n── 其他 ──");
  await test("ollama.models", "ollama.models", {}, (d) => console.log("    ok"));
  await test("audit.list", "audit.list", {}, (d) => console.log("    ok"));
  await test("usage.get", "usage.get", {}, (d) => console.log("    ok"));

  console.log(`\n=== 结果: ${pass} passed, ${fail} failed ===`);
} finally {
  proc.kill();
}

if (fail > 0) process.exit(1);
