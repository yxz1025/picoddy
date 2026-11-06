# 主进程危险操作日志 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为 Electron 客户端增加跨平台、脱敏、可定位主进程崩溃边界的结构化操作日志。

**Architecture:** 新增独立的同步 JSONL 操作日志模块，提供 `begin/success/error` 生命周期 API 和固定大小轮换。主进程在加载 TypeScript 前使用早期日志兜底；IPC、内部 API、Windows 凭据/子进程和异常事件在危险边界记录结构化事件。所有记录只携带白名单元数据，不记录请求正文或敏感值。

**Tech Stack:** Electron 43、Node.js ESM、TypeScript、Node `fs`/`path`/`child_process`、Node test runner。

---

### Task 1: 创建可测试的脱敏操作日志模块

**Files:**
- Create: `src/infra/operation_log.ts`
- Test: `test/src/infra/operation_log.test.ts`

- [ ] **Step 1: Write the failing test**

测试以下行为：创建日志器后，`start()` 立即写入 `begin`；完成后写入 `success` 和 `durationMs`；失败后写入 `error` 和错误堆栈；`apiKey`、`token`、`password`、`authorization`、`cookie`、`body`、`stdin` 和命令参数不会出现在日志；日志文件达到阈值时轮换并保留有限历史文件。

测试调用形态固定为：

```ts
const logger = createOperationLogger({
  logPath: join(tempDir, "operations.jsonl"),
  maxBytes: 300,
  maxFiles: 2,
});
const operation = logger.start("windows.credentials.set", {
  provider: "deepseek",
  apiKey: "do-not-write",
});
operation.success({ exitCode: 0 });
```

- [ ] **Step 2: Run the focused test and verify it fails**

Run: `npx tsx --test test/src/infra/operation_log.test.ts`

Expected: FAIL because `createOperationLogger` is not defined.

- [ ] **Step 3: Implement the minimal logger**

实现 `OperationLogPhase`、`OperationLogEvent`、`OperationLogger` 和 `createOperationLogger`。每行使用 `JSON.stringify` 写入；`start()` 使用 `appendFileSync` 先写 `begin`，返回 `success()` 和 `error()`；所有写入都包在 `try/catch` 中，写日志失败只打印一次警告，不阻塞业务。

实现以下脱敏规则：敏感字段名大小写不敏感匹配 `key|token|password|secret|authorization|cookie|credential|body|stdin|args|headers` 后直接丢弃；`command` 只保留文件名；错误字符串过滤 `Bearer <value>`、常见 `sk-...`、以及 `name=value` 形式的敏感值。调用方只传白名单元数据。

实现日志轮换：当前文件超过 `maxBytes` 前先把 `.N` 依次后移，删除超出 `maxFiles` 的旧文件，再重命名当前文件为 `.1`。默认 `maxBytes` 为 10 MiB、`maxFiles` 为 3。

- [ ] **Step 4: Run the focused test and verify it passes**

Run: `npx tsx --test test/src/infra/operation_log.test.ts`

Expected: PASS，且读取出的日志文本不包含 `do-not-write`。

- [ ] **Step 5: Commit the logger unit**

```bash
git add -- src/infra/operation_log.ts test/src/infra/operation_log.test.ts
git commit -m "feat: add redacted operation logger"
```

### Task 2: 接入主进程早期启动和崩溃兜底日志

**Files:**
- Modify: `main.mjs`

- [ ] **Step 1: Write the failing test**

为主进程日志格式增加一个纯函数测试或静态断言，确认事件包含 `phase`、`operation`、`pid`、`platform` 和 `arch`，且启动参数不会被写入。若当前 ESM 入口不可直接导入，则在 `operation_log.test.ts` 覆盖同样的事件字段约束，并以手工 Windows 验证作为集成测试。

- [ ] **Step 2: Implement early operation records**

保留现有 `main.log`，并让早期 `writeMainLog()` 同步追加到 `operations.jsonl`。在加载 Electron、tsx、esbuild、窗口、数据库、应用模块、静态服务器、IPC、正式页面和 ready 处分别写入固定阶段事件。

注册 `uncaughtException`、`unhandledRejection`、`render-process-gone`、`child-process-gone`、`before-quit`、`window-all-closed` 和 `will-quit` 日志。异常记录错误名、消息、堆栈和退出码，但经过统一脱敏；native crash 至少保留此前写入的 `begin` 事件。

- [ ] **Step 3: Run syntax verification**

Run: `node --check main.mjs`

Expected: exit code 0。

- [ ] **Step 4: Commit the main-process integration**

```bash
git add -- main.mjs
git commit -m "feat: record early main process failures"
```

### Task 3: 包装 IPC 和内部 API 操作

**Files:**
- Modify: `src/electron/ipc-handlers.ts`
- Modify: `application.electron.ts`

- [ ] **Step 1: Write the failing test**

在日志器测试中验证 `start("ipc.config.saveApiKey", { provider: "deepseek" })` 的事件不包含请求对象、Key 值或请求正文，只包含 provider 和参数数量等安全元数据。

- [ ] **Step 2: Implement IPC boundary logging**

在 `registerIpcHandlers()` 内封装 `handleLogged(channel, listener)`，所有 `ipcMain.handle` 通过该封装注册。封装只记录 channel、参数数量、开始时间、成功/失败和错误堆栈，不序列化 IPC 参数。这样可以覆盖 UI 调用的直接系统操作以及业务 API IPC 调用。

- [ ] **Step 3: Implement internal API boundary logging**

在 `_callApi()` 开始和结束处记录 `api.<method>.<route>`，只记录 HTTP 方法、脱敏后的路由模板和状态结果。对 `/api/settings/keys` 只额外记录 provider ID，不记录 body。API 异常必须先记录再重新抛出，让现有前端错误处理继续生效。

- [ ] **Step 4: Run static verification**

Run: `npx tsc --project tsconfig.electron.json --noEmit`

Expected: 不新增日志相关错误；如果仍有已有 `src/agent/tools/subagent.ts` 错误，记录为基线问题。

- [ ] **Step 5: Commit the IPC/API integration**

```bash
git add -- src/electron/ipc-handlers.ts application.electron.ts
git commit -m "feat: log IPC and API operations"
```

### Task 4: 接入 Windows 密钥、PowerShell 和原生进程危险边界

**Files:**
- Modify: `src/infra/windows_credentials.ts`
- Modify: `src/platform/windows_process.ts`

- [ ] **Step 1: Write the failing test**

扩展凭据存储测试用注入的 `runProcess` 验证 `get/set/delete` 会生成对应操作生命周期事件，provider 会保留，secret、stdin 和完整 PowerShell 参数不会出现在日志。

- [ ] **Step 2: Implement credential operation logging**

在 Windows DPAPI 的 get/set/delete 边界分别记录 `windows.credentials.get`、`windows.credentials.set`、`windows.credentials.delete`。`set` 只记录 provider 和输入长度；PowerShell 进程只记录 `powershell.exe`、退出码、耗时和错误摘要。

- [ ] **Step 3: Implement native process boundary logging**

在 `runWindowsProcessNoWindow()` 进入 `loadKernel32()` 前同步记录 `windows.process.create`，只记录命令文件名、参数数量、是否有 stdin、架构和超时设置；正常、超时、Win32 失败和异常分别写结束事件。资源初始化也必须位于可记录的 try/finally 范围内，确保 CreatePipe 或 CreateProcessW 前后都有结果。

- [ ] **Step 4: Run focused static verification**

Run: `node --check main.mjs` and `npx tsc --project tsconfig.electron.json --noEmit`

Expected: 入口语法通过；类型检查只保留已知基线错误。

- [ ] **Step 5: Commit the Windows boundary integration**

```bash
git add -- src/infra/windows_credentials.ts src/platform/windows_process.ts
git commit -m "feat: trace Windows credential and process boundaries"
```

### Task 5: 接入 MCP、连接器、数据库并完成验证说明

**Files:**
- Modify: `src/agent/mcp.ts`
- Modify: `src/domains/connector/node/service.ts`
- Modify: `src/infra/db.ts`
- Modify: `docs/10-Windows-MSI构建与启动处理记忆.md`

- [ ] **Step 1: Add boundary events**

为 MCP 单个连接、连接器外部进程/恢复操作和数据库初始化增加开始、成功、失败事件。只记录名称、类型、provider、退出码、耗时和计数，不记录 MCP headers、环境变量、命令参数或数据库内容。

- [ ] **Step 2: Verify the complete log contract**

Run: `npx tsx --test test/src/infra/operation_log.test.ts`

Expected: PASS，包含脱敏、生命周期、轮换测试。

- [ ] **Step 3: Run repository static checks**

Run: `node --check main.mjs` and `git diff --check`

Expected: 入口语法通过；diff 无空白错误。类型检查中的两个既有 `subagent.ts` 错误不归因于本功能。

- [ ] **Step 4: Document Windows verification commands**

在 Windows 文档中写明：

```powershell
$log = "$env:LOCALAPPDATA\Pi-a\logs\operations.jsonl"
Get-Content $log -Wait
```

并说明使用 `npm run build:win:x64` 重新打包后，分别验证启动、保存 Key、错误 Key 测试、PowerShell 失败和正常退出；日志中不得出现密钥正文。

- [ ] **Step 5: Commit the remaining integration and docs**

```bash
git add -- src/agent/mcp.ts src/domains/connector/node/service.ts src/infra/db.ts docs/10-Windows-MSI构建与启动处理记忆.md
git commit -m "docs: complete operation logging verification"
```
