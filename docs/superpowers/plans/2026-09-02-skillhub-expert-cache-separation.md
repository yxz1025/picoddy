# SkillHub Expert Cache Separation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将 SkillHub 市场专家缓存与用户自建 `my-experts` 完全隔离，同时把两类卡片操作移动到右上角。

**Architecture:** 新增独立 `skillhub-experts` 缓存索引和包目录；缓存包经现有专家包解析规则加载为运行时 `catalog`，但不进入 installed 列表。召唤接口先命中版本缓存，否则在同文件系统暂存、校验并原子替换，前端继续复用现有会话启动流程。

**Tech Stack:** Node.js fs/promises、TypeScript、Electron IPC、React、Zustand、Node test runner

---

### Task 1: 可替换的缓存市场注册表

**Files:**
- Modify: `src/agent/experts/registry.ts`
- Test: `test/src/agent/experts/registry.test.ts`

- [x] 写回归测试：`replaceCachedCatalog([manifest])` 后 `list("catalog")` 包含缓存专家，`list("installed")` 不包含它，且 installed 同 ID 优先。
- [ ] 运行 `npx tsx --test test/src/agent/experts/registry.test.ts`。
- [x] 增加 `cachedCatalog` 集合和 `replaceCachedCatalog`，重建顺序为 builtin、installed、cached catalog、原 catalog。
- [ ] 重跑测试，确认通过。

### Task 2: 独立缓存扫描和刷新

**Files:**
- Create: `src/agent/experts/skillhub_cache.ts`
- Modify: `src/agent/experts/installed_catalog.ts`
- Modify: `src/agent/experts.ts`
- Test: `test/src/agent/experts/skillhub_cache.test.ts`

- [x] 写回归测试：临时缓存中的有效 index/package 被解析为 `catalogSource: "catalog"`，缺失包产生诊断且不进入结果。
- [x] 导出通用 `readExpertPackageManifest`，允许调用方指定 `catalogSource` 和 badge；installed 扫描继续传 `installed`/“我的专家”。
- [x] 实现缓存路径、索引解析、包目录约束与 `refreshSkillHubExpertCache()`；应用启动时在 installed refresh 后调用。
- [ ] 重跑缓存与 installed catalog 测试。

### Task 3: 缓存命中与原子覆盖安装

**Files:**
- Rewrite: `src/domains/skillhub/node/expert_installer.ts`
- Modify: `application.electron.ts`
- Test: `test/src/domains/skillhub/node/expert_installer.test.ts`

- [x] 写回归测试：同版本有效缓存不调用 CLI；新版本调用 CLI 并替换；下载失败保留旧包和 index。
- [x] 将安装目标从 `my-experts` 改为 `<appData>/skillhub-experts/packages`，索引记录 namespace/slug/version/path。
- [x] 下载到缓存根内临时目录，补 schemaVersion 并校验；使用 backup rename 实现包和 index 回滚。
- [x] 下载完成或命中缓存后刷新缓存 catalog，并返回专家摘要。
- [ ] 重跑安装器测试及 SkillHub 客户端测试。

### Task 4: 两类专家卡片操作

**Files:**
- Modify: `frontend/src/components/ExpertPanel.tsx`
- Modify: `frontend/src/components/ExpertPanel.css`
- Modify: `test/src/components/skillDiscoveryLayout.test.ts`

- [x] 写回归测试：市场卡片右上角只有召唤；我的专家右上角有召唤和编辑按钮；两者底部均无召唤按钮。
- [x] 市场卡片把召唤按钮放入 `expert-card-top`；我的专家把召唤和 Pencil 编辑图标放入右上角操作组。
- [x] 保留更多菜单的查看、打开目录和卸载行为，删除菜单里的重复编辑项。
- [ ] 重跑布局测试和 `npm run build:frontend`。

### Task 5: 集成验证

**Files:**
- Verify only

- [ ] 运行相关 registry、缓存、安装器、SkillHub 与前端测试，确认零失败。
- [x] 运行 `git diff --check`。
- [ ] 重启 Electron，检查市场和“我的专家”两个独立页面及右上角操作。
