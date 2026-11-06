# 多平台交互预览实施计划

按 `docs/designs/2026-10-08-interactive-preview-design.md` 顺序实现。只使用现有工具，不调用技能或子代理。不修改业务仓库构建策略；不自动提交、发布或推进 TAPD。

## 步骤与文件

- [x] 1. 新建 `src/domains/preview/shared/contracts.ts`：目标、命令、场景、工作区、运行快照类型。
- [x] 2. 新建 `src/domains/preview/node/store.ts`：独立表、所有权隔离、目标校验与运行记录；测试在 `test/src/domains/preview/store.test.ts`。
- [x] 3. 新建 `src/domains/preview/node/workspace.ts`：绑定关联仓库当前目录与分支、相对路径校验、重新读取 Git 状态；真实 Git 验证保留已有修改、分支变化阻止执行。
- [x] 4. 新建 `scripts/preview/runtime.mjs` 与 `worker.mjs`：跨平台进程管理、原生 SDK、场景 hook、超时与清理。通过 Node 测试隔离验证 Web/小程序协议与命令参数。
- [x] 5. 新建 `src/domains/preview/node/service.ts`：运行互斥、worker IPC、持久化状态、截图资产、登录身份检查、退出清理。
- [x] 6. 接入 `application.electron.ts`、`src/electron/ipc-handlers.ts`、`preload.cjs`、`frontend/src/api/client.ts`：可信 IPC 与 API 统一，阻止普通 HTTP 执行本地代码。
- [x] 7. 新建 `frontend/src/components/projects/InteractivePreview.tsx` 与 CSS：配置表单、目标卡片、工作区、场景与运行记录；挂载 `RequirementChat.tsx` 侧栏。
- [x] 8. 为 `requirement/node/inputs.ts` 和 `context.ts` 添加可选预览上下文；历史未配置需求不生成额外预览状态。
- [x] 9. 增加 `docs/examples/interactive-preview/` 的 Web、微信场景模块示例及配置说明。
- [x] 10. 执行针对性测试、前端构建、后端类型检查；用受控 H5 服务验证真实浏览器交互与截图，记录微信及 Windows 原生验证的可用性。
- [x] 11. 自查差异：权限、进程泄漏、无关改动、TAPD 流程、历史会话；输出 `docs/designs/2026-10-08-interactive-preview-verification.md`。

- [x] 12. 通过原生 MCP 工具读取 Figma，保存真实读取凭据；限定本轮输入、所选仓库、会话与目标修订。
- [x] 13. 登记交付文件哈希与待确认资产；会话交付卡片支持手动预览、场景、代码差异、截图与修复请求。

## 检查命令

```text
npx tsx --test test/src/domains/preview/*.test.ts
node --test test/scripts/preview/*.test.mjs
npx tsx --test test/src/domains/requirement/context.test.ts test/src/domains/requirement/assets.test.ts
npm run build:frontend
npx tsc --project tsconfig.electron.json --noEmit
git diff --check
```

Windows 使用测试运行器逐个列出测试文件，避免依赖 shell 展开 glob。执行结果保留实际通过/失败/跳过数量；现有失败与本次新增失败分别记录，不用“全部通过”掩盖环境限制。

## 执行结果

实现与本机检查已完成。新增自动化 16 项通过；真实 Figma 账号未验收，真实微信因未登录受阻，Windows 原生运行及安装包构建未验证。旧回归有 2 条基线失败，已复现并记录。详细结果见 `docs/designs/2026-10-08-interactive-preview-verification.md`，勾选实施步骤不代表这些环境验收已通过。
