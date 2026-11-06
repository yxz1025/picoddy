# PiCoddyClaw 内置 Node.js 与 Python 跨平台运行时设计

## 1. 背景

PiCoddyClaw 是 Electron 桌面应用。Electron 已经携带与当前 Electron 版本绑定的 Node.js 运行时，项目也已经把 npm 包含在应用资源中；但用户机器的系统 `PATH` 不一定存在 `node`、`npm`、`python3` 等命令。

专家和 Skill 可能包含 Node.js 或 Python 脚本。为保证安装后的客户端在干净的 macOS、Windows 环境中也能执行这些脚本，需要建立由客户端管理的运行时能力，并在打包时按目标操作系统与 CPU 架构装入对应资源。

本设计参考本机 WorkBuddy 的运行模式：运行时随客户端发布，安装后解压到用户数据目录，通过绝对路径和受控 `PATH` 执行，不依赖系统运行时。

## 2. 目标与非目标

### 2.1 目标

- macOS、Windows 客户端无需用户安装 Node.js 或 Python。
- Node.js 复用 Electron 内嵌运行时，不重复增加一份 Node 二进制。
- Python 使用独立、可迁移、按平台和架构构建的运行时归档。
- Skill 中的 `#!/usr/bin/env python3` 在 macOS 受控进程内解析到内置 Python。
- Windows 不依赖 shebang，由运行时执行器显式调用内置 `python.exe`。
- Agent shell、专家脚本、内置工具和受管 CLI 使用相同的运行时解析规则。
- 运行时安装具备版本锁定、哈希校验、并发互斥、原子切换和失败恢复能力。
- 应用升级后可复用未变化的运行时版本。

### 2.2 非目标

- 不修改用户系统的全局 `PATH`、注册表或 shell 配置文件。
- 不覆盖系统安装的 Node.js、npm 或 Python。
- 不允许专家从网络任意下载并替换受管运行时。
- 首期不提供任意 Python 包在线安装能力。
- 首期支持 `darwin-arm64`、`darwin-x64`、`win32-x64`；Linux 保留扩展位，但不进入首期验收。

## 3. 核心决策

### 3.1 Node.js：复用 Electron 内嵌运行时

当前项目已经通过 Electron 内置 Node.js。内部执行 Node 脚本时使用：

```text
process.execPath + ELECTRON_RUN_AS_NODE=1
```

因此不再额外携带 `node.dat` 或独立 Node 发行版。这样可以减少安装包体积，也能复用现有 `src/platform/cli/runtime.ts` 的受管执行方式。

Node.js 版本由 Electron 版本唯一决定，并在运行时锁文件中记录：

```json
{
  "node": {
    "source": "electron",
    "electronVersion": "43.2.0",
    "nodeVersionSource": "process.versions.node"
  }
}
```

内部代码禁止使用：

```ts
spawn("node", [scriptPath]);
```

必须使用受管执行器：

```ts
spawn(process.execPath, [scriptPath], {
  shell: false,
  env: {
    ...managedEnv,
    ELECTRON_RUN_AS_NODE: "1",
  },
});
```

### 3.2 Python：携带独立运行时

Python 不属于 Electron，需要为每个平台和架构分别准备完整运行时，包括解释器、标准库、动态库和首期允许的内置依赖。

当前锁定 Python `3.13.15`（python-build-standalone 发布 `20260901`）。版本必须由运行时锁文件统一管理，代码和 CI 不允许分别写死不同版本。

### 3.3 内部调用优先绝对路径

应用内部执行脚本时，必须使用解析后的绝对解释器路径。`PATH` 注入主要用于兼容 Skill 文本中的 `python3 script.py`、`node script.js` 等命令，不作为内部服务定位运行时的唯一依据。

### 3.4 运行时与应用版本解耦

运行时按照自己的版本和内容哈希存储。应用更新但运行时未变化时，不重复解压；运行时版本变化时安装新目录，确认可用后再切换活动版本。

## 4. 平台与架构矩阵

| Electron 构建目标 | 运行时键 | Python 归档 | Python 可执行文件 | Node 执行方式 |
|---|---|---|---|---|
| macOS Apple Silicon | `darwin-arm64` | `python-darwin-arm64.tar.gz` | `bin/python3` | Electron arm64 + `ELECTRON_RUN_AS_NODE=1` |
| macOS Intel | `darwin-x64` | `python-darwin-x64.tar.gz` | `bin/python3` | Electron x64 + `ELECTRON_RUN_AS_NODE=1` |
| Windows 64 位 | `win32-x64` | `python-win32-x64.tar.gz` | `python.exe` | Electron x64 + `ELECTRON_RUN_AS_NODE=1` |

不同平台和架构的 Python 不能混用。macOS arm64 包不能携带 x64 Python 作为活动运行时；Windows 包不能使用 macOS Python 归档。

## 5. 仓库与构建资源结构

运行时原始归档不直接混放在 Electron 应用源码中，建议使用以下结构：

```text
resources/
└── runtimes/
    ├── runtime-lock.json
    └── manifests/
        ├── darwin-arm64.json
        ├── darwin-x64.json
        └── win32-x64.json

vendor-runtimes/
└── python/
    └── 3.13.15/
        ├── python-darwin-arm64.tar.gz
        ├── python-darwin-x64.tar.gz
        └── python-win32-x64.tar.gz

build/runtime-staging/
├── runtime-manifest.json
└── python.dat
```

说明：

- `resources/runtimes/runtime-lock.json` 进入版本控制，记录版本、平台、SHA-256、归档大小和可执行文件相对路径。
- `vendor-runtimes` 可以来自受控制品库或 CI 缓存；大文件是否进入 Git 由仓库制品策略决定。
- `build/runtime-staging` 是构建时临时目录，只包含当前目标平台的 Python 归档。
- 打包后的文件统一命名为 `python.dat`，运行时通过随包 manifest 判断其真实格式与平台。

## 6. 运行时锁文件

`resources/runtimes/runtime-lock.json` 是运行时版本唯一事实来源。文件必须符合以下结构：

```ts
interface RuntimeLock {
  schemaVersion: 1;
  node: {
    source: "electron";
    electronVersion: "43.2.0";
    nodeVersion: string;
    npmVersion: "11.7.0";
  };
  python: {
    version: "3.13.15";
    platforms: Record<
      "darwin-arm64" | "darwin-x64" | "win32-x64",
      {
        archive: string;
        format: "tar.gz" | "zip";
        sha256: string;
        size: number;
        executable: "bin/python3" | "python.exe";
      }
    >;
  };
}
```

`nodeVersion` 由构建环境读取并与 Electron 内嵌版本校验。每个平台的 `sha256` 和 `size` 由归档生成脚本写入真实值；`sha256` 必须是 64 位小写十六进制字符串，`size` 必须是正整数。字段缺失、版本不匹配或摘要不匹配时构建必须失败，不能跳过 Python 后继续发布。

## 7. 构建阶段设计

### 7.1 构建前暂存

新增：

```text
scripts/runtime/prepare-runtime.mjs
```

输入：

```text
--platform darwin|win32
--arch arm64|x64
```

职责：

1. 读取 `runtime-lock.json`。
2. 生成 `${platform}-${arch}` 运行时键。
3. 验证该键被支持。
4. 定位对应 Python 归档。
5. 校验文件大小和 SHA-256。
6. 校验归档内必须存在解释器和标准库关键文件。
7. 清空并重建 `build/runtime-staging`。
8. 将归档复制为 `python.dat`。
9. 写入只包含当前目标平台信息的 `runtime-manifest.json`。

### 7.2 electron-builder 资源

在 `electron-builder.yml` 的 `extraResources` 中增加：

```yaml
extraResources:
  - from: build/runtime-staging/python.dat
    to: vendor/python.dat
  - from: build/runtime-staging/runtime-manifest.json
    to: vendor/runtime-manifest.json
```

最终安装包只携带一个平台的 Python：

```text
Contents/Resources/vendor/python.dat                  # macOS
resources/vendor/python.dat                           # Windows 安装目录
```

禁止把三个平台的归档同时放入一个安装包。

### 7.3 构建命令

建议拆分为明确的平台命令：

```json
{
  "scripts": {
    "prepare:runtime:mac:arm64": "node scripts/runtime/prepare-runtime.mjs --platform darwin --arch arm64",
    "prepare:runtime:mac:x64": "node scripts/runtime/prepare-runtime.mjs --platform darwin --arch x64",
    "prepare:runtime:win:x64": "node scripts/runtime/prepare-runtime.mjs --platform win32 --arch x64",
    "build:mac:arm64": "npm run prepare:runtime:mac:arm64 && npm run build:frontend && electron-builder --mac --arm64",
    "build:mac:x64": "npm run prepare:runtime:mac:x64 && npm run build:frontend && electron-builder --mac --x64",
    "build:win:x64": "npm run prepare:runtime:win:x64 && npm run build:frontend && electron-builder --win --x64"
  }
}
```

构建脚本必须验证 Electron 实际目标与 runtime manifest 一致，防止把 `darwin-arm64` Python 装入 `darwin-x64` 客户端。

### 7.4 CI 构建矩阵

```text
macOS arm64 runner
  → prepare darwin-arm64
  → 签名 Python Mach-O 文件
  → 生成归档
  → 构建、签名、notarize Electron 应用

macOS x64 runner
  → prepare darwin-x64
  → 签名 Python Mach-O 文件
  → 生成归档
  → 构建、签名、notarize Electron 应用

Windows x64 runner
  → prepare win32-x64
  → 构建并签名安装包
```

macOS 构建必须在 macOS 环境完成。Windows 可在 Windows runner 构建，避免跨平台原生模块和签名差异。

## 8. 安装后目录结构

macOS/Linux 风格：

```text
~/.pi-a/
└── binaries/
    ├── node/
    │   ├── active.json
    │   └── wrappers/
    │       ├── node
    │       ├── npm
    │       └── npx
    └── python/
        ├── active.json
        └── versions/
            └── 3.13.15/
                ├── .runtime.json
                ├── bin/python3
                ├── bin/pip3
                └── lib/
```

Windows：

```text
%LOCALAPPDATA%\Pi-a\binaries\
├── node\
│   ├── active.json
│   └── wrappers\
│       ├── node.cmd
│       ├── npm.cmd
│       └── npx.cmd
└── python\
    ├── active.json
    └── versions\
        └── 3.13.15\
            ├── .runtime.json
            ├── python.exe
            ├── python313.dll
            ├── Lib\
            └── Scripts\
```

不使用需要管理员权限的系统目录。运行时只写入当前用户的应用数据目录。

## 9. Python 首次安装与原子切换

新增模块建议：

```text
src/platform/runtime/runtime-lock.ts
src/platform/runtime/archive-verifier.ts
src/platform/runtime/python-installer.ts
src/platform/runtime/managed-environment.ts
src/platform/runtime/index.ts
```

首次调用 Python 时执行：

```text
读取 packaged runtime-manifest
  → 计算 python.dat SHA-256
  → 获取进程级安装互斥锁
  → 再次检查目标版本是否已安装
  → 解压到 versions/.staging-<随机ID>
  → 校验目录、解释器、版本和架构
  → 写入 .runtime.json
  → 原子重命名为 versions/3.13.15
  → 原子更新 active.json
  → 返回解释器绝对路径
```

要求：

- 归档条目不得包含绝对路径、`..`、驱动器前缀或符号链接逃逸。
- macOS 解压后恢复解释器和工具脚本的可执行权限。
- 解压失败只删除 staging 目录，不影响已有活动版本。
- 多个会话同时首次调用时只有一个安装任务，其余等待同一 Promise。
- 已安装目录的 `.runtime.json` 摘要与 manifest 一致才允许复用。
- 不允许在原目录覆盖升级。

## 10. 统一运行时 API

运行时模块对调用者提供最小接口：

```ts
interface ManagedRuntimeService {
  resolveNode(): Promise<{
    executable: string;
    version: string;
    env: NodeJS.ProcessEnv;
  }>;

  resolvePython(): Promise<{
    executable: string;
    version: string;
    env: NodeJS.ProcessEnv;
  }>;

  buildShellEnv(base?: NodeJS.ProcessEnv): Promise<NodeJS.ProcessEnv>;
}
```

`resolveNode()` 返回 `process.execPath`，并在 `env` 中设置 `ELECTRON_RUN_AS_NODE=1`。`resolvePython()` 返回内置 Python 的绝对路径。`buildShellEnv()` 只为交互式 Agent shell 增加受管命令包装器和 Python 目录，不设置 Node 专用变量。

所有内部调用均使用参数数组和 `shell: false`：

```ts
spawn(python.executable, [scriptPath, ...args], {
  cwd,
  env: python.env,
  shell: false,
});
```

禁止拼接 shell 字符串执行文件路径和用户输入。

## 11. PATH、shebang 与 Windows 差异

### 11.1 子进程 PATH

`buildShellEnv()` 只修改当前子进程环境：

```text
macOS:
<python-version>/bin:<node-wrapper-dir>:<原PATH>

Windows:
<python-version>;<python-version>\Scripts;<node-wrapper-dir>;<原PATH>
```

使用 `path.delimiter` 生成分隔符，禁止手写 `:` 或 `;`。

### 11.2 Python 环境变量

默认设置：

```text
PYTHONUTF8=1
PYTHONNOUSERSITE=1
PYTHONDONTWRITEBYTECODE=1
```

默认不设置 `PYTHONHOME` 和 `PYTHONPATH`，避免破坏可迁移 Python 发行版自身的路径解析。只有所选 Python 发行版明确要求时，才由平台 manifest 提供固定相对值。

### 11.3 macOS shebang

Skill 中可以保留：

```python
#!/usr/bin/env python3
```

当脚本由 PiCoddyClaw 受控进程直接执行时，`env` 会从注入后的 `PATH` 找到内置 `python3`。

### 11.4 Windows shebang

Windows `CreateProcess` 不原生解析 Unix shebang。内部执行器必须显式执行：

```text
<managed-python>\python.exe <script.py>
```

Skill 文档应统一写：

```bash
python3 script.py
```

Windows 的受控 shell 可以通过 `python3.cmd` 包装器转发到活动版本的 `python.exe`。内部 TypeScript 代码仍禁止依赖包装器，必须使用绝对路径。

## 12. Node、npm 与 npx 包装器

为了让 Agent shell 中的 `node`、`npm`、`npx` 不依赖系统安装，应用启动时生成当前平台包装器。

macOS `node` 包装器语义：

```text
ELECTRON_RUN_AS_NODE=1 <当前应用的 process.execPath> "$@"
```

Windows `node.cmd` 语义：

```text
set ELECTRON_RUN_AS_NODE=1
"<当前应用的 process.execPath>" %*
```

包装器每次应用启动时根据当前 `process.execPath` 重建，避免应用升级或移动后保留旧路径。

npm 和 npx 不依赖系统命令，使用项目已打包在 `app.asar.unpacked/node_modules/npm` 中的 CLI，并由 Electron Node 模式执行。版本必须匹配现有 `ConnectorRuntimeLock`。

## 13. 专家与 Skill 执行规则

### 13.1 Node.js 脚本

- 内部工具通过 `resolveNode()` 执行。
- Skill shell 命令通过受控 PATH 找到 Node 包装器。
- 专家包不能假设可以访问 PiCoddyClaw 自身的 `node_modules`。
- 专家需要第三方 npm 包时，依赖必须随专家包提供，或通过受管连接器安装流程锁定版本与完整性。

### 13.2 Python 脚本

- 内部工具通过 `resolvePython()` 执行。
- Python 标准库随运行时提供。
- 首期专家脚本优先只使用标准库。
- 如需第三方包，必须在构建阶段按平台预装进运行时或制作经过哈希锁定的独立环境，不能运行时执行不受控的 `pip install`。
- 专家包内脚本允许保留 `#!/usr/bin/env python3`，但业务正确性不能依赖 Windows 解析 shebang。

### 13.3 受控环境边界

运行时 PATH 只注入到：

- Agent shell 工具子进程；
- 专家和 Skill 脚本子进程；
- 受管 Connector CLI；
- 应用内部运行时校验命令。

不得写入用户的 `.zshrc`、`.bashrc`、PowerShell Profile 或系统环境变量。

## 14. 安全设计

- 运行时归档由 CI 生成或从受信制品库下载。
- 仓库锁文件固定版本、SHA-256 和大小。
- 客户端每次首次安装前校验归档摘要。
- 解压器拒绝路径穿越、绝对路径、符号链接和特殊文件。
- 子进程使用 `shell: false`，用户输入只作为单独 argv。
- 继承环境时继续过滤 `NODE_OPTIONS`、`NODE_PATH`、`PYTHONHOME`、`PYTHONPATH` 以及密钥类变量。
- macOS Python 中所有 Mach-O 二进制和动态库在归档前完成签名，随后随应用完成 notarization。
- Windows 安装包必须签名；Python 归档内容由签名安装包和运行时 SHA-256 双重保护。
- 运行时目录不允许专家修改；文件写入策略将 `~/.pi-a/binaries` 视为应用受保护目录。

## 15. 错误模型

运行时错误使用稳定错误码，不把本地完整路径或敏感环境写入前端：

```text
RUNTIME_PLATFORM_UNSUPPORTED
RUNTIME_MANIFEST_INVALID
RUNTIME_ARCHIVE_MISSING
RUNTIME_ARCHIVE_INTEGRITY_FAILED
RUNTIME_EXTRACTION_FAILED
RUNTIME_EXECUTABLE_MISSING
RUNTIME_VERSION_MISMATCH
RUNTIME_PERMISSION_DENIED
RUNTIME_PROCESS_FAILED
```

用户可见消息示例：

```text
内置 Python 初始化失败，请重新安装或更新 PiCoddyClaw。
```

日志可以记录错误码、平台键、版本和阶段，但不得记录用户文档内容或密钥。

## 16. 应用更新与运行时升级

Electron 自动更新包中包含当前版本要求的 `python.dat` 和 manifest。

应用启动后不立即解压 Python；首次需要 Python 时才安装。更新策略：

- manifest 版本和摘要未变化：复用现有版本。
- Python 版本变化：安装到新版本目录，校验成功后更新 `active.json`。
- 新版本安装失败：继续使用旧版本，但如果新应用明确要求新版本，则返回运行时错误，不静默降级。
- 至少保留当前活动版本和上一个有效版本。
- 清理更旧版本时必须确认没有正在运行的子进程引用该目录。

## 17. 测试设计

### 17.1 单元测试

- 平台键正确映射 `process.platform/process.arch`。
- 锁文件拒绝未知 schema、缺失平台、非法摘要和非法可执行路径。
- PATH 使用 `path.delimiter` 且内置运行时优先。
- Node 解析返回 `process.execPath` 和 `ELECTRON_RUN_AS_NODE=1`。
- Windows Python 路径为 `python.exe`，macOS 为 `bin/python3`。
- 解压器拒绝 `../`、绝对路径、驱动器路径和符号链接。
- 两个并发安装请求只执行一次解压。
- staging 失败不会破坏已有活动版本。

### 17.2 构建测试

- `darwin-arm64` 构建只包含 arm64 Python。
- `darwin-x64` 构建只包含 x64 Python。
- `win32-x64` 构建只包含 Windows x64 Python。
- 归档摘要与 runtime manifest 一致。
- Python 可执行文件架构与 Electron 目标一致。
- macOS 包内和解压后的 Python 二进制签名有效。

### 17.3 安装包验收

在没有系统 Node.js、npm、Python 的干净机器或虚拟机中验证：

```text
1. 安装并启动 PiCoddyClaw。
2. 执行 Node Skill，确认 process.execPath 为 PiCoddyClaw/Electron。
3. 执行 Python Skill，确认 sys.executable 位于 Pi-a/binaries/python。
4. 执行带 #!/usr/bin/env python3 的脚本。
5. Windows 使用 python3 命令和内部绝对路径各执行一次。
6. 读取 xlsx，确认 read_doc 使用 Node/exceljs，不错误依赖 Python。
7. 重启客户端，确认运行时不重复解压。
8. 篡改 python.dat，确认完整性校验阻止执行。
9. 升级客户端，确认未变化的 Python 版本被复用。
```

## 18. 实施文件边界

计划新增：

```text
resources/runtimes/runtime-lock.json
resources/runtimes/manifests/*.json
scripts/runtime/prepare-runtime.mjs
scripts/runtime/verify-python-archive.mjs
scripts/runtime/verify-packaged-runtime.mjs
src/platform/runtime/runtime-lock.ts
src/platform/runtime/archive-verifier.ts
src/platform/runtime/python-installer.ts
src/platform/runtime/managed-environment.ts
src/platform/runtime/process-runner.ts
src/platform/runtime/wrappers.ts
src/platform/runtime/index.ts
test/scripts/runtime/*.test.ts
test/src/platform/runtime/*.test.ts
```

计划修改：

```text
package.json
electron-builder.yml
src/platform/cli/runtime.ts
src/agent/provider.ts
src/agent/tools/expert_draft.ts
src/agent/tools/index.ts
src/agent/tools/windows_shell.ts
src/vendor/pi_coding_agent.ts
src/domains/connector/node/process_runner.ts
src/domains/plugin/node/service.ts
src/agent/tools/sandbox.ts
```

修改原则：运行时解析集中在 `src/platform/runtime`，业务模块不得自行拼接 Python 或 Node 路径。

## 19. 实施顺序

1. 定义并验证 `runtime-lock.json`。
2. 准备三个目标平台的 Python 运行时归档及真实摘要。
3. 实现构建前暂存和归档校验脚本。
4. 将当前平台 Python 作为 `extraResources` 写入安装包。
5. 实现 Python 原子解压、版本验证和活动版本切换。
6. 扩展现有 Node/npm 受管运行时并生成 shell 包装器。
7. 将专家、Skill、Connector 和 shell 子进程统一接入受管环境。
8. 增加单元测试、构建产物测试和干净机器验收。
9. 接入客户端自动更新流程，验证运行时版本复用与升级。

## 20. 完成标准

- macOS arm64、macOS x64、Windows x64 安装包分别只携带匹配平台的 Python。
- 用户没有安装 Node.js、npm、Python 时，Node 和 Python Skill 均可运行。
- `sys.executable` 指向 `~/.pi-a` 或 `%LOCALAPPDATA%\Pi-a` 下的受管 Python。
- Node 脚本使用 Electron 内嵌 Node，不依赖系统 `node`。
- macOS shebang 解析到受管 Python；Windows 由执行器或包装器兼容。
- 运行时安装、校验或升级失败时，不破坏已有应用和用户数据。
- 所有内部运行时调用通过统一服务完成，不存在散落的 `spawn("python3")`、`spawn("node")` 或 `spawn("npm")`。

## 21. 详细实现规格

### 21.1 当前缺口与改造结果

| 调用场景 | 当前实现 | 问题 | 改造结果 |
|---|---|---|---|
| 内部 Node CLI | `process.execPath` + `ELECTRON_RUN_AS_NODE` | 已具备受管基础 | 收敛到统一 RuntimeService |
| Connector npm | 部分路径仍执行系统 `npm` | 干净机器可能找不到 npm | 使用打包 npm CLI 的绝对路径 |
| 专家草稿校验 | `spawn("python3", ...)` | 依赖系统 PATH | 使用受管 Python 绝对路径 |
| macOS Agent bash | pi-coding-agent 默认继承系统 PATH | Skill 可能调用系统 Python/Node | BashOperations 执行前注入受管 PATH |
| Windows Agent shell | `cmd.exe` + 当前进程环境 | `python3` 通常不存在 | 注入 PATH，并提供 `python3.cmd` |
| `.py` 直接执行 | 依赖 shebang | Windows 不解析 shebang | 内部统一用 `python.exe script.py` |

### 21.2 解压依赖

运行时解压必须使用项目直接声明的依赖，不能依赖 electron-builder 间接安装的包：

```json
{
  "dependencies": {
    "tar": "6.2.1",
    "unzipper": "0.10.14"
  }
}
```

- `tar` 处理 macOS `tar.gz`。
- 当前三个目标平台均使用 python-build-standalone 的 `tar.gz`；保留 `unzipper` 以支持后续 Windows zip 制品。
- `node:crypto` 计算 SHA-256。
- `node:fs/promises` 完成 staging、权限设置和原子重命名。
- 不调用系统 `tar`、`unzip` 或 PowerShell `Expand-Archive`。

依赖版本在实施时以根 lockfile 中安全扫描通过的版本为准，并作为直接依赖锁定。

### 21.3 PackagedRuntimeManifest 精确结构

打包阶段生成的 `build/runtime-staging/runtime-manifest.json` 只描述当前平台：

```ts
interface PackagedRuntimeManifest {
  schemaVersion: 1;
  platform: "darwin" | "win32";
  arch: "arm64" | "x64";
  key: "darwin-arm64" | "darwin-x64" | "win32-x64";
  python: {
    version: "3.13.15";
    archiveFile: "python.dat";
    archiveFormat: "tar.gz" | "zip";
    archiveSha256: string;
    archiveBytes: number;
    executable: "bin/python3" | "python.exe";
    binDirectories: string[];
  };
}
```

各平台 `binDirectories` 固定为：

```text
darwin: ["bin"]
win32:  ["", "Scripts"]
```

解析 manifest 时必须：

1. 拒绝未知字段类型和未知 `schemaVersion`。
2. 要求 `key === platform + "-" + arch`。
3. 要求 `platform === process.platform` 且 `arch === process.arch`。
4. 要求所有相对路径不为空、不绝对、不包含 `..`。
5. 要求 SHA-256 匹配 `/^[a-f0-9]{64}$/`。
6. 要求归档大小为正安全整数。

### 21.4 Python 归档内容契约

归档解压后直接形成版本目录，不额外嵌套平台名称或 Python 版本顶层目录。

macOS 归档根：

```text
bin/python3
bin/python3.13
lib/python3.13/
lib/libpython3.13.dylib
.distribution.json
```

Windows 归档根：

```text
python.exe
python313.dll
python313.zip 或 Lib/
Scripts/
.distribution.json
```

`.distribution.json` 至少包含：

```ts
interface PythonDistributionMetadata {
  schemaVersion: 1;
  version: "3.13.15";
  platform: "darwin" | "win32";
  arch: "arm64" | "x64";
  sourceId: string;
  sourceSha256: string;
  builtAt: string;
}
```

运行时不信任该文件声明的摘要，只使用它与 packaged manifest 交叉校验版本、平台和架构。

### 21.5 构建暂存脚本控制流

`scripts/runtime/prepare-runtime.mjs` 的控制流固定为：

```ts
const target = parseExactArgs(process.argv.slice(2));
const key = `${target.platform}-${target.arch}`;
const lock = await readAndValidateRuntimeLock();
const entry = lock.python.platforms[key];
if (!entry) fail("RUNTIME_PLATFORM_UNSUPPORTED");

const source = resolveTrustedArchivePath(entry.archive);
await assertOrdinaryFileWithoutSymlink(source);
await assertFileSize(source, entry.size);
await assertSha256(source, entry.sha256);
await inspectArchiveEntries(source, entry);

await replaceStagingDirectoryAtomically({
  archiveSource: source,
  archiveDestinationName: "python.dat",
  manifest: toPackagedManifest(lock, key),
});
```

`parseExactArgs` 只接受一组 `--platform` 和 `--arch`，拒绝重复参数和额外位置参数。`resolveTrustedArchivePath` 必须确保归档位于配置的制品根目录内，且归档本身不是符号链接。

平台不支持、归档不存在、大小或摘要错误、归档条目不安全、解释器缺失或目标架构不匹配时，构建脚本必须返回非零退出码。

### 21.6 安全解压算法

解压不能先全部释放再检查。每个归档条目在写入前执行：

```ts
function validateArchiveEntry(name: string, kind: EntryKind): string {
  if (!name || name.includes("\0")) throw invalidEntry();
  if (isAbsolute(name) || /^[A-Za-z]:[\\/]/.test(name)) throw invalidEntry();

  if (name.includes("//") || name.includes("\\\\")) throw invalidEntry();
  const normalized = name.replaceAll("\\", "/").replace(/\/+$/u, "");
  if (!normalized) throw invalidEntry();
  const parts = normalized.split("/");
  if (parts.some((part) => part === "" || part === "." || part === "..")) {
    throw invalidEntry();
  }
  if (kind !== "file" && kind !== "directory") throw invalidEntry();
  return normalized;
}
```

额外限制：

- 最大文件数 20,000。
- 最大解压总量 512 MiB。
- 单文件最大 128 MiB。
- 拒绝符号链接、硬链接、设备文件、FIFO 和 socket。
- 文件创建使用排他写入；父目录逐级确认不是符号链接。
- staging 目录权限为当前用户可读写，其他用户无写权限。

### 21.7 PythonInstaller 状态机

```text
uninitialized
  → inspecting
  → ready                       已安装版本通过校验
  → verifying_archive
  → extracting
  → validating_runtime
  → activating
  → ready

任意阶段失败 → failed
下一次调用可从 inspecting 重新尝试
```

模块内部维护：

```ts
let installPromise: Promise<ResolvedPythonRuntime> | undefined;
```

`ensurePythonRuntime()` 首次调用创建 Promise，并发调用共享它；失败后在 `finally` 中清空 Promise，允许用户重试。

安装完成后的 `.runtime.json`：

```ts
interface InstalledRuntimeReceipt {
  schemaVersion: 1;
  version: string;
  platform: string;
  arch: string;
  archiveSha256: string;
  executableRelativePath: string;
  installedAt: string;
}
```

复用已安装版本前必须检查 receipt、解释器普通文件属性及版本探针。只存在目录但 receipt 缺失时视为残缺安装，不直接使用。

### 21.8 Python 版本和架构探针

解压完成后以绝对路径执行：

```text
python -I -c "import json,platform,sys; print(json.dumps({'version':platform.python_version(),'machine':platform.machine(),'executable':sys.executable}))"
```

验证规则：

- `version === 3.13.15`。
- `sys.executable` 的真实路径位于 staging 目录。
- `darwin-arm64` 接受 `arm64` 或 `aarch64`。
- `darwin-x64` 接受 `x86_64` 或 `amd64`。
- `win32-x64` 接受 `AMD64`、`x86_64` 或 `amd64`，比较时统一小写。
- 探针超时 10 秒、输出上限 64 KiB、退出码必须为 0。

探针通过后才能更新 `active.json`。

### 21.9 活动版本切换

不使用符号链接表示活动版本，避免 Windows junction、权限和安全边界差异。`active.json` 的精确结构为：

```ts
interface ActivePythonRuntime {
  schemaVersion: 1;
  version: string;
  archiveSha256: string;
  relativeRoot: string;
}
```

当前版本写入 `version: "3.13.15"` 和 `relativeRoot: "versions/3.13.15"`；`archiveSha256` 取 packaged manifest 中已经校验过的真实摘要。

写入流程：

1. 在 `active.json` 同目录创建排他临时文件。
2. 写入完整 JSON，执行文件 flush/fsync 后关闭句柄。
3. macOS 直接 rename 覆盖目标文件，再 fsync 父目录。
4. Windows 先把旧文件 rename 为 `.backup`，再把临时文件 rename 为目标文件；第二步失败则恢复 backup。
5. 新文件可读取且 schema 校验通过后删除 backup。

解析时再次确保 `relativeRoot` 位于 Python 根目录内；任何绝对路径或逃逸路径均拒绝。应用崩溃后启动时，优先选择校验通过的 `active.json`；若其缺失或损坏，再尝试恢复校验通过的 backup，不能仅按目录名猜测活动版本。

### 21.10 运行时环境构造

环境构造拆成三个函数，避免把 Node 专用变量泄漏给 Python：

```ts
function buildBaseManagedEnv(hostEnv: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
function buildNodeEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
function buildPythonEnv(base: NodeJS.ProcessEnv): NodeJS.ProcessEnv;
```

规则：

- `buildBaseManagedEnv` 过滤 `NODE_OPTIONS`、`NODE_PATH`、`PYTHONHOME`、`PYTHONPATH` 及密钥后缀变量。
- `buildNodeEnv` 增加 `ELECTRON_RUN_AS_NODE=1`。
- `buildPythonEnv` 明确删除 `ELECTRON_RUN_AS_NODE`，增加 `PYTHONUTF8=1`、`PYTHONNOUSERSITE=1`、`PYTHONDONTWRITEBYTECODE=1`。
- shell 环境只调整 PATH，不全局设置 `ELECTRON_RUN_AS_NODE`；Node 包装器在自身进程中设置该变量。
- 保留 `SystemRoot`、`WINDIR`、`ComSpec`、`TEMP` 等 Windows 进程启动必要变量。

### 21.11 macOS Bash 工具接入

`createCodingTools(cwd)` 当前创建默认 bash，不能向已有实例补充 `spawnHook`。实施时在 `src/vendor/pi_coding_agent.ts` 额外导出 `createBashTool` 和 `createLocalBashOperations`。

在 `src/agent/tools/index.ts` 中用受管 bash 替换默认 bash：

```ts
const codingTools = createCodingTools(cwd).filter((tool) => tool.name !== "bash");
const local = createLocalBashOperations();
const managedBash = createBashTool(cwd, {
  operations: {
    exec: async (command, commandCwd, options) => {
      const env = await managedRuntime.buildShellEnv(options.env);
      return await local.exec(command, commandCwd, { ...options, env });
    },
  },
});
```

`managedBash` 再进入现有 `protectShellTool`，保持路径保护和 mutation lock 顺序不变。

### 21.12 Windows shell 接入

`src/agent/tools/windows_shell.ts` 的 `execute` 已经是异步函数，可在调用 `runWindowsProcessNoWindow` 前解析受管环境：

```ts
const env = await managedRuntime.buildShellEnv(process.env);
const result = await runWindowsProcessNoWindow({
  ...spec,
  cwd,
  env: toDefinedStringRecord(env),
  timeoutMs,
  maxOutputBytes: MAX_OUTPUT,
});
```

`windowsEnvironmentBlock()` 已支持环境覆盖，PATH 键比较必须保持大小写不敏感。`python3.cmd`、`node.cmd`、`npm.cmd` 和 `npx.cmd` 位于最前面的 wrapper 目录。

### 21.13 内部 Python 调用点改造

`src/agent/tools/expert_draft.ts` 不再把解释器作为字符串传入：

```ts
async function runPythonScript(
  script: string,
  args: string[],
  signal?: AbortSignal,
): Promise<ProcessResult> {
  const runtime = await managedRuntime.resolvePython();
  return await runProcess(
    runtime.executable,
    [script, ...args],
    { cwd: dirname(script), env: runtime.env, signal },
  );
}
```

`validate_expert.py` 和 `register_expert.py` 两个调用统一迁移。`runProcess` 同时增加 `env`、`cwd`、超时和输出上限参数；`ENOENT` 映射为 `RUNTIME_EXECUTABLE_MISSING`，不再提示用户安装系统 Python。

### 21.14 npm 调用点改造

`src/domains/plugin/node/service.ts` 当前存在系统 `npm` 调用。改造后统一通过：

```text
resolveManagedNpmRuntime(runtimeLock)
  → process.execPath
  → app.asar.unpacked/node_modules/npm/bin/npm-cli.js
  → ELECTRON_RUN_AS_NODE=1
```

非 Windows 与 Windows 都使用参数数组调用同一 npm CLI。Windows 不再拼接 `npm ...` 交给 `cmd.exe`，从而避免依赖 `.cmd` 和系统 PATH。

### 21.15 Node wrapper 生成细节

Node wrapper 不是可信版本来源，只为 Agent shell 提供命令兼容。每次构造 shell 环境前执行 `ensureNodeWrappers()`：

1. 解析当前 `process.execPath`。
2. 写入同目录临时 wrapper。
3. macOS 设置 `0o700`。
4. 原子替换正式 wrapper。
5. wrapper 中只允许写入受控的应用路径和 npm CLI 路径。

路径发生变化时自动重建。内部服务仍直接使用 `process.execPath`，不通过 wrapper 反向解析。

### 21.16 Python wrapper 细节

macOS 的 `python3` 是版本目录中的真实可执行文件，不额外包装。Windows 在 `binaries/python/wrappers/python3.cmd` 写入：

```bat
@echo off
"%LOCALAPPDATA%\Pi-a\binaries\python\versions\3.13.15\python.exe" %*
```

活动版本变化时原子重写。该 wrapper 仅供已经进入 `cmd.exe` 的 Agent shell 使用；内部服务不能用它处理未转义的用户参数。

### 21.17 打包路径与运行时路径解析

开发环境和打包环境分别解析：

```ts
function packagedVendorRoot(): string {
  if (app.isPackaged) return join(process.resourcesPath, "vendor");
  return resolve(projectRoot, "build/runtime-staging");
}
```

运行时业务模块不允许从 `app.asar` 内执行 Python，也不允许根据当前工作目录猜测资源位置。开发环境只有执行过对应 `prepare:runtime:*` 后才能测试受管 Python；缺失时返回 `RUNTIME_ARCHIVE_MISSING`。

### 21.18 生命周期时序

```text
Electron 启动
  → 读取并校验 packaged runtime manifest（不解压）
  → 初始化 RuntimeService 单例
  → 正常显示主界面

第一次创建 shell 工具或执行 Python 内部工具
  → ensurePythonRuntime()
  → 已安装则快速探测并返回
  → 未安装则校验并解压本地 python.dat
  → 构造受管 PATH
  → 执行命令

应用退出
  → 中止未完成的新命令
  → 不删除已安装运行时
```

Python 归档已在本地，首次准备不需要网络。UI 可以把这段时间显示为工具“准备中”，不弹出安装授权窗口。

### 21.19 超时、取消和进程回收

- Python 探针超时 10 秒。
- 专家校验/注册上限 120 秒。
- Agent shell 使用工具传入的 timeout。
- AbortSignal 到达后先请求正常终止；5 秒未退出再强制结束。
- Windows 使用 Job Object 或现有进程树终止能力，不能只结束父 `python.exe`。
- macOS 以独立进程组启动需要回收的任务，并终止整个进程组。
- 超时和取消不修改活动运行时文件。

### 21.20 Python 第三方依赖策略

首期采用两层依赖：

```text
基础 Python 运行时
  └── 标准库 + 平台共同批准的基础包

专家包
  └── 纯 Python 源码或专家自带的锁定依赖
```

约束：

- 带原生扩展的 wheel 必须按平台/架构分别构建和签名。
- 专家 manifest 后续如声明 Python 依赖，必须包含名称、版本和哈希。
- 默认禁用运行时联网 `pip install`。
- 不允许使用用户全局 `site-packages`，由 `PYTHONNOUSERSITE=1` 保证隔离。
- 同一专家需要隔离依赖时，环境目录放在 `~/.pi-a/expert-runtimes/<expert-id>/<revision>`，不修改基础 Python。

### 21.21 构建产物自动验证

新增 `scripts/runtime/verify-packaged-runtime.mjs`，在 electron-builder 完成后检查 unpacked 目录：

```text
读取 vendor/runtime-manifest.json
  → 校验目标平台和架构
  → 校验 vendor/python.dat 大小与摘要
  → 确认安装包不含其他平台归档名称
  → 输出机器可读 JSON 结果
```

CI 只有验证通过才能继续签名发布或上传自动更新服务器。

### 21.22 可观测性

记录结构化事件：

```text
runtime.manifest.loaded
runtime.install.started
runtime.install.reused
runtime.install.completed
runtime.install.failed
runtime.process.started
runtime.process.completed
```

字段限定为 `runtime`、`version`、`platformKey`、`stage`、`durationMs`、`exitCode`、`errorCode`。不得记录完整 argv、附件路径、用户目录、环境变量或脚本内容。

### 21.23 端到端验收断言

macOS 和 Windows 均由 Agent shell 执行：

```text
node -p "process.execPath + '|' + process.version"
python3 -I -c "import sys; print(sys.executable); print(sys.version)"
```

必须断言：

- Node 输出来自当前 PiCoddyClaw/Electron 可执行文件。
- Python 输出位于 Pi-a 用户数据目录，而不是系统 Python。
- 从系统 PATH 移除 Node/Python 后结果不变。
- 新建会话和切换会话后结果一致。
- 专家包的同一份 `.py` 文件可在三个目标平台运行；只有运行时归档不同。

### 21.24 运行时来源、许可证与供应链

Python 归档不是开发者本机临时压缩的目录，必须来自固定制品流水线。每个平台制品至少保存：

- 上游发行版名称、下载地址和原始 SHA-256；
- 构建容器或构建机镜像标识；
- Python 版本、目标平台和目标架构；
- 补丁列表、预装包列表和对应许可证；
- 生成归档的脚本版本及最终归档 SHA-256；
- macOS 二进制签名身份和 Windows Authenticode 校验结果。

`runtime-lock.json` 只允许引用内部只读制品库中的版本化对象，禁止引用 `latest` 或可覆盖地址。发布仓库保存 Python License、预装依赖 NOTICE 和 SBOM，并将对应文件通过 `extraResources` 放入 `vendor/licenses/runtime/`。

制品晋级顺序为：构建、恶意软件扫描、依赖漏洞扫描、解释器探针、归档安全检查、签名验证、写入不可变制品库、人工批准摘要、更新 `runtime-lock.json`。应用构建不能自行联网下载或重建 Python。

### 21.25 RuntimeService 依赖注入与初始化

运行时模块不能在文件加载时直接读取 Electron `app`，否则测试进程和 Electron-as-Node 子进程会产生隐式依赖。入口采用显式依赖：

```ts
interface RuntimeServiceDependencies {
  platform: NodeJS.Platform;
  arch: string;
  isPackaged: boolean;
  resourcesPath: string;
  projectRoot: string;
  appDataDir: string;
  hostExecutable: string;
  hostNodeVersion: string;
  readHostEnv(): NodeJS.ProcessEnv;
  log(event: RuntimeEvent): void;
}

function createManagedRuntimeService(
  dependencies: RuntimeServiceDependencies,
): ManagedRuntimeService;
```

`src/agent/provider.ts` 在 Electron 已 ready 且 `platformPaths` 初始化后创建唯一实例，再把实例传给工具、Connector 和插件服务。单元测试传入临时目录和假进程执行器，不修改全局 `process.env`、`process.execPath` 或 `process.resourcesPath`。

禁止业务模块自行 import 单例并在模块初始化阶段安装 Python。只有 `resolvePython()` 或首次创建需要 Python PATH 的 shell 时才触发安装；Node 解析和主窗口启动不等待 Python 解压。

### 21.26 精确测试文件映射

| 测试文件 | 核心断言 |
|---|---|
| `test/scripts/runtime/prepare-runtime.test.ts` | 目标参数、摘要、大小、平台选择、staging 原子替换 |
| `test/src/platform/runtime/runtime-lock.test.ts` | schema、平台键、相对路径和未知字段拒绝 |
| `test/src/platform/runtime/archive-verifier.test.ts` | Zip Slip、驱动器路径、链接、文件数和大小限制 |
| `test/src/platform/runtime/python-installer.test.ts` | 并发去重、失败重试、崩溃恢复、旧版本保持可用 |
| `test/src/platform/runtime/managed-environment.test.ts` | PATH 顺序、Windows 键大小写、危险变量过滤 |
| `test/src/platform/runtime/wrappers.test.ts` | 路径转义、权限、应用移动后重建、Windows 参数转发 |
| `test/src/platform/runtime/process-runner.test.ts` | 超时、取消、输出上限、错误码和进程树回收 |
| `test/src/domains/plugin/node/service.test.ts` | 安装插件时不调用系统 npm |
| `test/src/agent/tools/expert_draft.test.ts` | 校验和注册都使用受管 Python 绝对路径 |

测试夹具使用最小假归档，不把完整 Python 提交进测试目录。归档检查器必须分别针对 tar.gz 和 zip 运行恶意条目用例。涉及真实解释器和签名的检查放在各平台打包 CI，不在跨平台单元测试中模拟成功。

### 21.27 构建脚本与 electron-builder 的准确顺序

新增脚本入口：

```json
{
  "scripts": {
    "prepare:runtime:mac:arm64": "node scripts/runtime/prepare-runtime.mjs --platform darwin --arch arm64",
    "prepare:runtime:mac:x64": "node scripts/runtime/prepare-runtime.mjs --platform darwin --arch x64",
    "prepare:runtime:win:x64": "node scripts/runtime/prepare-runtime.mjs --platform win32 --arch x64",
    "verify:runtime:package": "node scripts/runtime/verify-packaged-runtime.mjs"
  }
}
```

发布 CI 不继续复用一个不带目标参数的通用 `build` 命令，而是显式执行：

```text
macOS arm64: clean → frontend → prepare:runtime:mac:arm64 → electron-builder --mac --arm64 → verify
macOS x64:   clean → frontend → prepare:runtime:mac:x64   → electron-builder --mac --x64   → verify
Windows x64: clean → frontend → prepare:runtime:win:x64   → electron-builder --win --x64   → verify
```

`electron-builder.yml` 只增加两个固定 `extraResources` 映射：

```yaml
extraResources:
  - from: build/runtime-staging/python.dat
    to: vendor/python.dat
  - from: build/runtime-staging/runtime-manifest.json
    to: vendor/runtime-manifest.json
```

现有 Connector 两项 `extraResources` 保留。`prepare-runtime.mjs` 每次先构造同级临时 staging，验证完成后再替换 `build/runtime-staging`，避免上一次平台归档残留进入本次安装包。CI 构建前后都打印 manifest 的平台键、版本、大小和摘要，但不打印制品库凭据。

### 21.28 分阶段落地与回滚开关

落地拆成四个可独立验收的阶段：

1. 先统一 Node/npm 解析，确保现有能力不再调用系统 npm。
2. 加入 Python 制品、安装器和内部专家脚本迁移，但暂不注入 Agent shell。
3. 接入 macOS bash 与 Windows shell PATH，验证 Skill 跨平台复用。
4. 接入自动更新构建矩阵和干净机器端到端测试。

过渡期提供仅由应用配置读取的 `managedRuntimes.shellInjection` 开关。默认在开发包关闭、内部测试包开启，三个平台验收通过后发布包强制开启。该开关只能控制 Agent shell PATH 注入，不能让内部工具回退到系统 Python/npm；内部受管调用失败时必须返回明确错误。

回滚新客户端版本时，已解压的 Python 版本目录可以保留。旧客户端只使用自身 packaged manifest 指定且 receipt 校验通过的版本，不读取更新版本的 `active.json` 作为唯一真相，因此不会误用不兼容 Python。后台清理策略至少保留当前客户端所需版本和最近一个已验证版本。

### 21.29 当前制品源与自动下载实现

当前实现固定使用 `astral-sh/python-build-standalone` 的不可变 release `20260901`，Python 版本为 `3.13.15`：

| 目标 | 归档 | SHA-256 |
|---|---|---|
| `darwin-arm64` | `aarch64-apple-darwin-install_only.tar.gz` | `b9054a9d3d54f4cb5573d44907fddb29874b08909bde73f29f2868cf872223ee` |
| `darwin-x64` | `x86_64-apple-darwin-install_only.tar.gz` | `49f0d97f506b855eed60b74a8ac138595c5b39799a6aa5e0d7ca8abe1019a4d4` |
| `win32-x64` | `x86_64-pc-windows-msvc-install_only.tar.gz` | `9bcc038a0bf180612ed56dec93d4977d035e80b8d9320ef51a38c287baf134b7` |

`npm run prepare:runtime:current` 根据构建机的 `process.platform/process.arch` 选择一项，下载到 `build/runtime-cache`，校验大小和摘要后生成 `build/runtime-staging/python.dat` 与 `runtime-manifest.json`。`--offline` 只允许复用已校验缓存，缓存缺失即失败。

该发行版归档顶层为 `python/`，manifest 的 `archiveRoot` 指定该目录，安装器解压后会安全展平到版本目录。Windows x64 使用同一发行版的 `tar.gz`，解压后可执行文件为 `python.exe`；归档内 macOS 的 `python3` 符号链接只允许指向同一版本目录内的真实解释器。

打包命令已接入准备步骤：

```text
npm run build:mac → prepare:runtime:current → electron-builder --mac
npm run build:win → prepare:runtime:current → electron-builder --win --x64
```

打包后的 `npm run verify:runtime:package` 会再次验证 vendor 目录的 manifest、大小、SHA-256 和平台归档隔离。

### 21.30 在 Agent 内验证实际运行时来源

Agent 的终端工具会在每次命令执行前构造受管 shell 环境：Python 版本目录和 wrappers 目录被放在 `PATH` 最前面。Node wrapper 设置 `ELECTRON_RUN_AS_NODE=1` 后调用客户端内置 Electron/Node；Python 不经过系统 `python3` 查找，而是直接调用已校验的绝对路径。

在 Agent 中执行以下命令（不要把完整环境变量粘贴到聊天中）：

macOS Agent shell：

```sh
command -v node
node -p 'process.execPath + "|" + process.version + "|ELECTRON_RUN_AS_NODE=" + (process.env.ELECTRON_RUN_AS_NODE || "")'
command -v python3
python3 -c 'import platform,sys; print(sys.executable); print(sys.version.split()[0]); print(platform.machine())'
printf '%s\n' "$PATH" | tr ':' '\n' | head -5
```

Windows Agent 终端：

```bat
where node
node -p "process.execPath + '|' + process.version + '|ELECTRON_RUN_AS_NODE=' + (process.env.ELECTRON_RUN_AS_NODE || '')"
where python3
python3 -c "import platform,sys; print(sys.executable); print(sys.version.split()[0]); print(platform.machine())"
echo %PATH%
```

判定标准：`node` 的第一条路径必须位于 `~/.pi-a/binaries/wrappers`（Windows 为 `%LOCALAPPDATA%\\Pi-a\\binaries\\wrappers`），Node 输出中的 `ELECTRON_RUN_AS_NODE=1` 必须存在；Python 的 `sys.executable` 必须位于 `binaries/python/versions/3.13.15`，版本和架构应分别为 `3.13.15` 与当前客户端架构。若 `command -v/where` 指向系统目录，说明当前命令绕过了 Agent 受管 shell（例如在系统终端直接执行），不代表 Agent 内部调用结果。
