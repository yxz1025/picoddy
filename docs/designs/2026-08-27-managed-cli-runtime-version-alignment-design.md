# 受管 CLI 运行时版本对齐与启动隔离设计

## 1. 背景

应用启动连接器子系统时抛出：

```text
managed node runtime 22.22.2 is not available (app embeds 24.18.0)
```

当前项目使用 Electron `43.2.0`，实际内置 Node 为 `24.18.0`，bundled npm 为 `11.7.0`。连接器运行时仍把 WorkBuddy 当时使用的 Node `22.22.2` 写死在多处，因此 `resolveManagedNpmRuntime()` 按设计拒绝使用不匹配的宿主 Node。

连接器初始化又处于 skills/models 的统一启动门禁内。运行时不匹配不仅禁用连接器，还导致整个 Agent 启动 Promise 被拒绝，并在 Electron 顶层形成 `UnhandledPromiseRejectionWarning`。

## 2. 根因

### 2.1 多个运行时事实来源

Node `22.22.2` 当前至少存在于：

- `resources/builtin-connectors/connector-runtime-lock.json`；
- `resources/builtin-connectors/connector-catalog.json`；
- `src/domains/connector/node/types.ts`；
- `src/domains/connector/node/catalog.ts`；
- `src/domains/connector/node/registry.ts`；
- `application.electron.ts` 的 `CONNECTOR_RUNTIME_LOCK`；
- `src/agent/tools/index.ts` 的 `MANAGED_RUNTIME_LOCK`；
- 相关测试 fixture。

资源锁、类型、应用装配和 Agent 工具各自保存一份版本，Electron 升级后没有统一更新。

### 2.2 运行时锁语义不准确

首期并没有下载 npm `node` 包。实际 Node 来自 Electron 的 `process.execPath`，通过 `ELECTRON_RUN_AS_NODE=1` 执行。现有 runtime lock 却把它描述为：

```json
{ "package": "node", "version": "22.22.2", "integrity": "..." }
```

该 integrity 不能证明当前 Electron 内嵌 Node 二进制，与真实运行时来源不一致。

### 2.3 可选连接器错误扩大为全局启动失败

`connectorsReady()` 的异常穿过 `initializeAgentRuntime()`，外层 catch 记录后再次抛出。连接器目录或运行时无效时，安全上应该禁止安装和执行连接器，但不应该让本地会话、技能、模型和普通工具全部不可用。

## 3. 目标

- 立即支持 Electron `43.2.0` 内置 Node `24.18.0` 和 bundled npm `11.7.0`。
- 运行时版本只从一个经过校验的资源锁读取。
- 应用后端和 connector child 工具复用同一 Registry/runtime 解析结果。
- Electron 或 Node 升级后，只更新 runtime lock 与发布校验，不再全仓修改字面量。
- 连接器初始化失败时对连接器 fail closed，但主应用继续启动。
- 所有异步启动错误均被捕获，不出现未处理 Promise rejection。

## 4. 非目标

- 本次不放宽为任意系统 Node/npm。
- 不使用 PATH 查找或自动下载未知版本运行时。
- 不改变官方 CLI 的安装、授权、命令或子代理协议。
- 不在本次执行真实钉钉安装或授权。
- 不保留对旧 runtime lock schema 的兼容读取。

## 5. 运行时锁新协议

将 runtime lock 从“虚构的 node npm 包”改为真实宿主来源：

```json
{
  "schemaVersion": 2,
  "host": {
    "source": "electron",
    "package": "electron",
    "version": "43.2.0",
    "integrity": "sha512-80zvrgG7ZRXD+tD0IyLvrnN9n+veSxadMRsMaC9wKKP3iUbtC7rGM8+dVuCmOb0Rrwwv8ESW4awnUZh9Hbp1fA==",
    "nodeVersion": "24.18.0"
  },
  "npm": {
    "package": "npm",
    "version": "11.7.0",
    "integrity": "sha512-wiCZpv/41bIobCoJ31NStIWKfAxxYyD1iYnWCtiyns8s5v3+l8y0HCP/sScuH6B5+GhIfda4HQKiqeGZwJWhFw=="
  }
}
```

`host.integrity` 对应 `package-lock.json` 中 Electron npm 包的发布摘要；`npm.integrity` 对应 bundled npm 包摘要。运行时再验证：

- `process.versions.electron === host.version`；
- `process.versions.node === host.nodeVersion`；
- `require("electron/package.json").version === host.version`；
- `require("npm/package.json").version === npm.version`；
- npm bin 入口存在且位于已解析的 npm 包目录内。

发布阶段校验 lock 中的 Electron/npm version 与 `package-lock.json` 的 version/integrity 完全一致。运行阶段不重新计算整个 Electron 应用包摘要，避免把 npm tarball SRI 错当成本地二进制摘要。

## 6. Catalog 运行时引用

连接器条目不再复制具体 Node 版本：

```json
{
  "runtime": {
    "type": "managed-node-npm",
    "profile": "default"
  }
}
```

`profile: "default"` 指向同目录的唯一 runtime lock。Registry 负责验证：

- 只接受已注册的 `managed-node-npm/default`；
- runtime lock schema 和所有字段严格合法；
- Catalog 不允许声明任意运行时路径、版本、下载 URL 或 Driver；
- Registry 返回不可变的 `runtimeLock`，而不是验证后丢弃。

CLI 对 Node 兼容性的审核属于发布 Catalog 的职责；当前 `dingtalk-workspace-cli@1.0.59` 必须在 Node `24.18.0` 下完成语法和后续授权的端到端验收后，才能宣称正式支持。

## 7. 单一装配链

```text
connector-runtime-lock.json
          ↓ 严格解析
ConnectorRegistry.runtimeLock
          ↓
resolveManagedNpmRuntime(runtimeLock)
          ↓
ManagedNpmRuntime 单例
      ├─ ConnectorService/Lifecycle/Driver
      └─ connector_cli_execute Gateway
```

删除：

- `application.electron.ts` 中的 `CONNECTOR_RUNTIME_LOCK`；
- `src/agent/tools/index.ts` 中的 `MANAGED_RUNTIME_LOCK`；
- TypeScript 类型和解析器中的 `22.22.2` 字面量；
- Catalog 条目中的具体 Node 版本。

应用服务和 Agent 工具必须通过同一惰性运行时 Promise 获取 Registry 与 runtime，防止以后再次出现两套缓存和两套版本。

## 8. 启动失败隔离

连接器初始化遵循“子系统 fail closed、应用 fail open”：

1. Skills 和 models 按现有顺序初始化。
2. 尝试初始化 Connector Registry、runtime 和 startup recovery。
3. 成功时标记连接器可用。
4. 失败时捕获异常，保存稳定启动错误，并记录脱敏日志；不重新抛出到顶层。
5. 主 Agent、普通技能、专家、MCP 和本地会话继续启动。
6. `/api/connectors` 返回目录可用时的卡片及 `runtime_broken` 状态；目录本身也无效时返回稳定的 `CONNECTOR_CATALOG_INVALID`/`CONNECTOR_RUNTIME_UNAVAILABLE`，前端显示“运行环境异常”。
7. 连接器 delegate 工具和 `connector_cli_execute` 不注册或执行，直到连接器子系统成功初始化。

不能简单删除版本检查或捕获后继续执行 CLI。隔离的含义是“禁用连接器但保留应用”，不是“使用未经验证的运行时”。

## 9. 错误协议

新增稳定错误码：

| 错误码 | 含义 | 行为 |
|---|---|---|
| `CONNECTOR_RUNTIME_UNAVAILABLE` | Electron/Node/npm 与运行时锁不一致或入口缺失 | 禁用连接器，主应用继续启动 |
| `CONNECTOR_CATALOG_INVALID` | 目录或 runtime lock schema 无效 | 禁用连接器目录，主应用继续启动 |

错误详情可以记录期望与实际版本，但不能包含环境变量、令牌或完整文件路径。前端只展示可理解的版本不匹配提示和“重启/更新应用”建议。

## 10. 影响范围

- `resources/builtin-connectors/connector-runtime-lock.json`
- `resources/builtin-connectors/connector-catalog.json`
- `src/domains/connector/node/types.ts`
- `src/domains/connector/node/catalog.ts`
- `src/domains/connector/node/registry.ts`
- `src/platform/cli/runtime.ts`
- `application.electron.ts`
- `src/agent/tools/index.ts`
- `src/agent/startup.ts` 或连接器初始化包装层
- 相关后端测试 fixture 与发布校验源码
- 受管 CLI 总设计和执行状态文档

## 11. 风险

- Node 24 可能暴露官方 CLI 或 post-install 脚本的兼容性问题；必须保持连接器失败隔离。
- Electron npm SRI 只能证明安装依赖来源，不能替代已打包应用签名；生产完整性仍依赖代码签名和发布链。
- 如果 application 与 Agent tools 分别创建 Registry/runtime Promise，仍可能重复失败或状态不一致，必须抽成共享装配。
- 连接器初始化失败后若支持运行时热恢复，需要明确重新初始化入口；首期可要求升级或重启应用，不做隐式循环重试。

## 12. 验证方式

遵循当前用户要求，不自动运行测试套件。实施后只执行：

- `connector-catalog.json` 与 `connector-runtime-lock.json` JSON 语法解析；
- 主进程 TypeScript 类型检查；
- 前端 TypeScript 类型检查（如错误 DTO/UI 有变更）；
- 测试源码 TypeScript 语法检查，但不执行测试；
- `git diff --check`。

需要用户另行授权后才能运行的行为验证：

- Electron 43.2.0 / Node 24.18.0 启动连接器成功；
- 故意写错 runtime lock 时主应用仍启动、连接器为 runtime_broken；
- Node 24 下真实安装和授权 `dingtalk-workspace-cli@1.0.59`。

## 13. 完成定义

应用在 Electron 43.2.0 / Node 24.18.0 下不再因旧 Node 22.22.2 锁阻断启动；运行时版本只有资源锁一个事实来源，应用服务和 connector child 共用同一解析结果。任何未来运行时不匹配都只禁用受管连接器并返回稳定错误，不影响 Skills、Models、普通 Agent 和应用窗口启动，也不产生未处理 Promise rejection。
