# Windows x86/x64 Python Runtime 预缓存 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 预下载 Windows ia32/x64 Python runtime 到 `resources/runtimes/cache/`，并让每种 Windows 打包目标只发布对应的一份 runtime。

**Architecture:** `runtime-lock.json` 是平台资产唯一来源；`prepare-runtime.mjs` 按显式目标读取资源缓存、校验归档并生成单目标 staging。electron-builder 排除缓存目录，只从 staging 发布 runtime。

**Tech Stack:** Node.js ESM、npm scripts、electron-builder、SHA-256、Node test runner。

---

### Task 1: 固定 Windows ia32/x64 资产与缓存边界

**Files:**
- Modify: `resources/runtimes/runtime-lock.json`
- Modify: `.gitignore`
- Modify: `electron-builder.yml`
- Test: `test/src/domains/connector/node/packaging.test.ts`

- [ ] **Step 1: Write failing assertions**

在打包配置测试中断言 `files` 包含 `!resources/runtimes/cache/**`，并断言 runtime `extraResources` 仍只来自 `build/runtime-staging`。

- [ ] **Step 2: Run the focused packaging test and observe the expected failure**

Run: `npx tsx --test test/src/domains/connector/node/packaging.test.ts`

Expected: 新增的缓存排除断言失败，因为当前 builder 配置尚未排除 `resources/runtimes/cache/**`。

- [ ] **Step 3: Add the `win32-ia32` lock entry**

在 `resources/runtimes/runtime-lock.json` 的 `python.platforms` 中加入：

```json
"win32-ia32": {
  "archive": "cpython-3.13.15+20260901-i686-pc-windows-msvc-install_only.tar.gz",
  "url": "https://github.com/astral-sh/python-build-standalone/releases/download/20260901/cpython-3.13.15%2B20260901-i686-pc-windows-msvc-install_only.tar.gz",
  "archiveRoot": "python",
  "format": "tar.gz",
  "sha256": "62ab9e252bb85f4538972f99eb1824d720c3f98ae1b2f7cd6988a93cba515252",
  "size": 44735626,
  "executable": "python.exe"
}
```

- [ ] **Step 4: Exclude the preloaded cache from source and app contents**

在 `.gitignore` 加入 `resources/runtimes/cache/`，在 `electron-builder.yml` 的 `files` 加入 `!resources/runtimes/cache/**`。不要修改现有 runtime staging 的两个 `extraResources` 映射。

- [ ] **Step 5: Run the packaging test to verify the boundary**

Run: `npx tsx --test test/src/domains/connector/node/packaging.test.ts`

Expected: packaging assertions pass；缓存归档不被发布，staging 中的两个 runtime 文件映射保持不变。

### Task 2: Make runtime preparation use the resource cache

**Files:**
- Modify: `scripts/runtime/prepare-runtime.mjs`
- Test: `test/scripts/prepare-runtime.test.ts`

- [ ] **Step 1: Write failing cache-selection tests**

测试 `prepareRuntime` 的显式 `--platform win32 --arch ia32` 和 `--platform win32 --arch x64` 都生成对应 manifest key，并断言归档校验使用 `resources/runtimes/cache`。

- [ ] **Step 2: Run the tests and observe the expected failure**

Run: `npx tsx --test test/scripts/prepare-runtime.test.ts`

Expected: `win32-ia32` lock key 不存在或缓存根目录仍为 `build/runtime-cache`，测试失败。

- [ ] **Step 3: Change the canonical cache root**

把 `CACHE_ROOT` 从 `build/runtime-cache` 改为 `resources/runtimes/cache`，保留现有原子 staging、大小校验、SHA-256 校验和 manifest 生成逻辑。下载和复制都必须使用解析后的 lock entry 文件名，禁止根据用户输入拼接额外文件名。

- [ ] **Step 4: Run the runtime tests**

Run: `npx tsx --test test/scripts/prepare-runtime.test.ts test/src/platform/runtime/runtime-lock.test.ts test/src/platform/runtime/archive-verifier.test.ts test/src/platform/runtime/managed-environment.test.ts test/src/platform/runtime/python-installer.test.ts test/src/platform/runtime/wrappers.test.ts`

Expected: 全部通过，且两个 Windows key 均能被解析。

### Task 3: Add explicit Windows target build commands

**Files:**
- Modify: `package.json`
- Test: `test/scripts/prepare-runtime.test.ts`

- [ ] **Step 1: Add target-specific npm scripts**

在 `package.json` 增加：

```json
"prepare:runtime:win:ia32": "node scripts/runtime/prepare-runtime.mjs --platform win32 --arch ia32",
"prepare:runtime:win:all": "npm run prepare:runtime:win:ia32 && npm run prepare:runtime:win:x64",
"build:win:x64": "node scripts/clean-electron-builder-output.mjs win && npm run build:frontend && npm run prepare:runtime:win:x64 && electron-builder --win --x64",
"build:win:ia32": "node scripts/clean-electron-builder-output.mjs win && npm run build:frontend && npm run prepare:runtime:win:ia32 && electron-builder --win --ia32"
```

将现有 `build:win` 改为 `npm run build:win:x64`，确保默认行为仍是 x64 且 staging 目标与 electron-builder 目标一致。

- [ ] **Step 2: Verify script definitions**

Run: `node -e "const p=require('./package.json'); for (const k of ['prepare:runtime:win:ia32','prepare:runtime:win:all','build:win:x64','build:win:ia32']) if(typeof p.scripts[k]!=='string') process.exit(1); console.log('win target scripts present')"`

Expected: 输出 `win target scripts present`。

### Task 4: Download and verify the preloaded archives

**Files:**
- Create: `resources/runtimes/cache/cpython-3.13.15+20260901-i686-pc-windows-msvc-install_only.tar.gz`
- Create: `resources/runtimes/cache/cpython-3.13.15+20260901-x86_64-pc-windows-msvc-install_only.tar.gz`

- [ ] **Step 1: Run the all-target preparation command**

Run: `npm run prepare:runtime:win:all`

Expected: 两次 prepare 成功，两个归档写入 `resources/runtimes/cache/`，最后 staging manifest 的 key 为 `win32-x64`。

- [ ] **Step 2: Verify both cache files**

Run: `node --input-type=module -e "import { createHash } from 'node:crypto'; import { readFile, stat } from 'node:fs/promises'; const cases=[['resources/runtimes/cache/cpython-3.13.15+20260901-i686-pc-windows-msvc-install_only.tar.gz',44735626,'62ab9e252bb85f4538972f99eb1824d720c3f98ae1b2f7cd6988a93cba515252'],['resources/runtimes/cache/cpython-3.13.15+20260901-x86_64-pc-windows-msvc-install_only.tar.gz',47042104,'9bcc038a0bf180612ed56dec93d4977d035e80b8d9320ef51a38c287baf134b7']]; for (const [file,size,digest] of cases) { const bytes=await readFile(file); if(bytes.length!==size || createHash('sha256').update(bytes).digest('hex')!==digest) throw new Error(file); } console.log('verified win32-ia32 and win32-x64 cache')"`

Expected: 输出 `verified win32-ia32 and win32-x64 cache`。

### Task 5: Final verification

**Files:**
- Verify: `CLAUDE.md`, `electron-builder.yml`, `package.json`, `resources/runtimes/runtime-lock.json`

- [ ] **Step 1: Run focused tests and checks**

Run: `npx tsx --test test/scripts/prepare-runtime.test.ts test/src/platform/runtime/runtime-lock.test.ts test/src/domains/connector/node/packaging.test.ts`

Expected: 所有 focused tests 通过。

- [ ] **Step 2: Check the target manifest**

Run: `node -e "const fs=require('fs'); const m=JSON.parse(fs.readFileSync('build/runtime-staging/runtime-manifest.json','utf8')); if(m.key!=='win32-x64') process.exit(1); console.log(m.key)"`

Expected: 输出 `win32-x64`。

- [ ] **Step 3: Check diff hygiene**

Run: `git diff --check`

Expected: 无空白错误；缓存文件保持被 `.gitignore` 排除，代码、锁文件、构建配置和测试变更可审阅。
