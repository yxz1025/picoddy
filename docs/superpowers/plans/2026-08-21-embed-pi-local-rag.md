# 内置 pi-local-rag 完整替换 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 将当前项目的 TF-IDF 文档检索完整替换为本地 BM25 + 向量混合检索，并采用 `rag_index`、`rag_query`、`rag_status` 及 `/rag` 命令能力。

**Architecture:** 保留当前项目的文档读取器和 Agent 工具装配层，重写 RAG 存储与检索核心。索引使用现有 `node:sqlite`，关键词检索使用 SQLite FTS5，向量检索使用跨平台可加载的 `sqlite-vec`；embedding 模型采用懒加载的 Transformers.js，并在模型不可用时降级为关键词检索。路径、缓存和数据库位置统一走 `platformPaths`。

**Tech Stack:** TypeScript, Node.js `node:sqlite`, SQLite FTS5, `sqlite-vec`, `@xenova/transformers`, current `readDoc`, Pi Extension API.

**Interaction:** Skills and plugins expose one user-facing `文档处理` capability. Selecting the built-in skill or the installed `pi-local-rag` plugin inserts `/document-processing` into the composer as a removable skill tag; the underlying parser, RAG, generation, and preview tools remain internal implementation details.

---

### Task 1: 引入跨平台 RAG 依赖并确认运行时能力

**Files:**
- Modify: `package.json`
- Modify: `package-lock.json`
- Test: `test/src/domains/rag/node/store.test.ts`

- [ ] 添加 `@xenova/transformers`、`sqlite-vec` 和 `ignore` 依赖；不添加 `better-sqlite3`。
- [ ] 锁定依赖版本并执行 `npm install`，验证 macOS 当前 Node 版本可加载依赖。
- [ ] 编写运行时探测测试，确认 `node:sqlite` 的数据库连接和 `sqlite-vec` 加载失败时可被识别，而不是让应用启动失败。

### Task 2: 扩展 SQLite schema，保留旧数据并增加 FTS/向量表

**Files:**
- Modify: `src/infra/db.ts`
- Test: `test/src/infra/db.test.ts`

- [ ] 保留 `doc_chunks` 表用于旧索引迁移读取。
- [ ] 增加文档元数据、FTS5 虚拟表、向量表和必要索引；schema 初始化必须幂等。
- [ ] 为 SQLite 不支持 `sqlite-vec` 的平台保留纯 FTS5 路径。
- [ ] 测试重复初始化、旧表存在、数据库目录不存在和 WAL 模式。

### Task 3: 实现跨平台 embedding 与降级策略

**Files:**
- Create: `src/domains/rag/node/embedding.ts`
- Test: `test/src/domains/rag/node/embedding.test.ts`

- [ ] 实现模型懒加载，模型缓存路径使用 `platformPaths.appDataDir`，禁止写入项目源码目录。
- [ ] 将文本批量转换为 384 维向量，并复用模型实例。
- [ ] 捕获模型下载、加载和推理异常，返回明确状态并允许调用方切换到关键词检索。
- [ ] 测试无网络/模型不可用时的降级、重复调用复用实例和固定维度校验。

### Task 4: 重写索引、刷新和混合检索核心

**Files:**
- Modify: `src/domains/rag/node/store.ts`
- Create: `src/domains/rag/node/file-walker.ts`
- Test: `test/src/domains/rag/node/store.test.ts`
- Test: `test/src/domains/rag/node/file-walker.test.ts`

- [ ] 删除旧 TF-IDF-only 实现，改为按文件/目录扫描、分块、写入 FTS5 和向量索引。
- [ ] 支持 tracked paths、排除模式、文件哈希和增量刷新。
- [ ] 使用项目现有 `readDoc` 解析文本、Markdown、DOCX、XLSX、PDF 等输入。
- [ ] 实现 BM25 与 cosine score 归一化混合排序，返回文件路径、块序号、行/位置和分数。
- [ ] 处理 Windows 分隔符、大小写路径、符号链接、文件删除、空文件和超大文件。
- [ ] 在 `sqlite-vec` 不可用时只使用 FTS5，并在结果中标记检索模式。

### Task 5: 替换 Agent 工具和 Extension 生命周期

**Files:**
- Modify: `src/agent/tools/rag.ts`
- Create: `src/domains/rag/node/runtime.ts`
- Modify: `src/agent/tools/index.ts`
- Test: `test/src/agent/tools/rag.test.ts`

- [ ] 移除 `index_doc` 和 `search_docs`，注册 `rag_index`、`rag_query`、`rag_status`。
- [ ] 增加 `/rag` 命令对应的 index/search/find/status/rebuild/refresh/clear/exclude/ext/on/off 操作。
- [ ] 增加 `before_agent_start` 自动检索和上下文注入，限制 topK、分数阈值和单轮注入字节数。
- [ ] 确保插件/扩展运行时失败不会阻塞主 Agent 启动；自动注入失败只记录诊断并继续对话。
- [ ] 工具结果必须包含来源路径和块位置，避免只返回无来源文本。

### Task 5A: 统一文档处理入口和 Composer 标签

**Files:**
- Create: `resources/builtin-skills/document-processing/SKILL.md`
- Create: `frontend/src/components/documentProcessingModel.ts`
- Modify: `frontend/src/components/Composer.tsx`
- Modify: `frontend/src/components/ComposerPlusMenu.tsx`
- Modify: `frontend/src/components/PluginSection.tsx`
- Modify: `frontend/src/store/usePluginStore.ts`
- Modify: `frontend/src/components/ChatArea.tsx`
- Modify: `src/platform/extensions/plugin-catalog.ts`
- Test: `frontend/src/components/documentProcessingModel.test.ts`

- [ ] Add the unified built-in skill and regenerate the built-in skill bundle.
- [ ] Add a composer menu entry and make skill selection render `/document-processing` as the `文档处理` tag.
- [ ] Add a `使用` action for the installed `pi-local-rag` catalog card; selecting it inserts the same tag in the composer.
- [ ] Change document welcome scenarios to use the unified tag while preserving their task-specific prompt text.

### Task 6: 清理旧 RAG 代码和配置

**Files:**
- Modify: `src/infra/db.ts`
- Modify: `src/agent/prompt-runtime/tool-policy.ts`
- Modify: `src/agent/prompt-runtime/capability-catalog.ts`
- Modify: `docs/architecture/plugins.md`
- Modify: `AGENT.md`

- [ ] 删除旧 `index_doc/search_docs` 的工具描述、测试和文档引用。
- [ ] 注册新 RAG 工具的 capability 和只读权限；索引/清理操作按写入权限处理，查询/状态按只读处理。
- [ ] 更新文档，说明模型缓存、跨平台降级和数据目录位置。

### Task 7: 端到端验证

**Files:**
- Test: `test/src/domains/rag/node/store.test.ts`
- Test: `test/src/agent/tools/rag.test.ts`

- [ ] 使用 Markdown、DOCX、PDF 和中文/英文混合内容验证索引与检索。
- [ ] 验证关键词命中、语义近似命中、目录增量刷新、删除文件清理和来源定位。
- [ ] 运行 `npm run test:backend`、前端测试、`npx tsc --project tsconfig.electron.json --noEmit`、`npm run build --prefix frontend` 和 `git diff --check`。
- [ ] 在 macOS 当前环境确认默认路径；对 Windows/Linux 使用路径和 SQLite 能力的单元测试覆盖，不引入平台专属 shell 命令。
