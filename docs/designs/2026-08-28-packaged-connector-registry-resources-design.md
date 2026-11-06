# 打包客户端连接器注册表与受管 CLI 真实资源设计

## 背景

开发环境中的连接器中心可以从 `resources/builtin-connectors` 读取连接器目录与受管运行时锁；打包后，同样的两个 JSON 文件被 electron-builder 收入 `app.asar`。连接器注册表读取器为了防止符号链接逃逸、路径替换和 TOCTOU 攻击，会对文件执行 `lstat`、`realpath`、`O_NOFOLLOW` 文件描述符读取，以及设备号、inode、大小和时间戳的一致性校验。

ASAR 提供的是 Electron 虚拟文件系统路径，不是独立的真实文件。虽然普通读取可以获得 JSON 内容，但虚拟路径无法稳定满足注册表要求的真实文件身份校验，因此注册表按失败关闭原则抛出 `CONNECTOR_CATALOG_INVALID`，前端最终显示 `ApiError: Connector registry is invalid`。

现有打包产物已确认包含以下两个文件，且内容与源码哈希一致，因此问题不是资源缺失、内容陈旧或 JSON 配置错误：

- `connector-catalog.json`
- `connector-runtime-lock.json`

## 目标

- 让打包客户端从真实文件系统读取并校验连接器目录与运行时锁。
- 让打包客户端使用 `app.asar.unpacked` 中真实存在的受管 npm CLI，不把 ASAR 虚拟路径交给子进程。
- 让宿主运行时校验符合 electron-builder 的真实产物结构，不要求生产包包含 Electron npm 包清单。
- 保留注册表现有的路径边界、文件身份和 TOCTOU 安全校验，不为 ASAR 增加降级模式。
- 开发环境继续读取仓库内的 `resources/builtin-connectors`。
- 打包产物仍然只携带两个受信任的描述 JSON，不内置任何第三方连接器包、技能归档或供应商资源树。
- 连接器资源路径由主进程确定，不开放环境变量或用户目录覆盖入口。

## 非目标

- 不修改连接器目录 JSON、运行时锁或连接器安装协议。
- 不实现或内置钉钉、企业微信等第三方连接器包。
- 不降低 `registry.ts` 与 `catalog.ts` 的文件读取安全约束。
- 不调整连接器中心的前端交互、错误文案或安装流程。
- 不在本次修复中改造代码签名、自动更新或连接器远端下载体系。

## 现状与根因

### 开发环境

`src/domains/connector/node/assembly.ts` 根据 `import.meta.url` 计算仓库相对路径：

```text
<repository>/resources/builtin-connectors
```

该目录位于真实文件系统，注册表的文件身份校验能够成立。

### 打包环境

`electron-builder.yml` 的 `files` 当前包含 `resources/**/*`，只排除了 `resources/builtin-connectors/*/**` 下的供应商子目录。两个顶层 JSON 因而进入：

```text
<App>/Contents/Resources/app.asar/resources/builtin-connectors
```

`assembly.ts` 在打包后仍按模块相对路径定位到上述 ASAR 虚拟目录。注册表读取器要求目录和文件具有真实、稳定且相互一致的文件系统身份；ASAR 虚拟路径不满足这一契约，错误被注册表统一包装为 `Connector registry is invalid`。

### 已排除原因

- 两个 JSON 未进入产物：已确认均存在。
- 打包文件与源码不一致：已确认 SHA-256 完全一致。
- 目录与运行时锁字段不匹配：现有内容与版本绑定有效。
- 连接器供应商资源缺失：按既定按需安装架构，供应商目录本就不应内置。

### 受管 CLI 的相邻路径风险

受管 Node 使用 `process.execPath`，在打包客户端中对应应用自身的真实可执行文件；用户点击安装后下载的第三方 CLI 则位于应用数据目录的 `connectors/packages`，同样是真实文件。两者不存在 ASAR 文件身份问题。

内置 npm 已由 `asarUnpack` 复制到：

```text
process.resourcesPath/app.asar.unpacked/node_modules/npm
```

但 `resolveManagedNpmRuntime()` 当前通过 `require.resolve("npm/package.json")` 推导入口。打包环境中的模块解析结果可能保留 `app.asar/node_modules/npm/...` 逻辑路径，再由 Electron 文件系统透明映射到 unpacked 文件。该路径不是当前注册表错误的原因，但将其作为子进程脚本参数会让受管 CLI 依赖 ASAR 的隐式重定向，不符合“需要执行的资源必须使用真实路径”的边界。此次一并消除该风险。

现有打包产物还确认了另一项运行时契约偏差：`app.asar` 包含 npm，但不包含 `node_modules/electron/package.json`。这是 electron-builder 的正常生产布局——Electron 是承载应用的宿主二进制，项目中的 `electron` npm 包是构建期依赖，不作为普通应用依赖再次打入 ASAR。当前 `resolveManagedNpmRuntime()` 仍调用 `require.resolve("electron/package.json")`，注册表恢复后会因一个本就不应存在的文件而拒绝连接器运行时。

## 方案

### 1. 将两个描述文件作为 ASAR 外真实资源发布

调整 `electron-builder.yml`：

- 从 `files` 中明确排除两个顶层连接器 JSON，避免在 `app.asar` 内重复发布。
- 继续排除 `resources/builtin-connectors/*/**`，确保任何供应商资源树都不会进入应用包。
- 使用 `extraResources` 仅复制两个 JSON 到固定目录：

```text
process.resourcesPath/builtin-connectors/connector-catalog.json
process.resourcesPath/builtin-connectors/connector-runtime-lock.json
```

允许清单采用显式文件白名单，不使用整个目录复制，防止开发者误放的第三方文件被打入安装包。

### 2. 按运行环境选择唯一资源根目录

调整 `src/domains/connector/node/assembly.ts` 的资源根目录解析：

- 模块路径位于 `app.asar` 时，使用 `process.resourcesPath/builtin-connectors`。
- 其他情况下保持现有仓库相对路径，支持开发环境和源码级静态检查。

打包环境不得在外置资源缺失或无效时回退到 ASAR、当前工作目录、用户目录或系统全局目录。资源无效时继续失败关闭，避免路径选择和信任边界变得不确定。

### 3. 将受管 npm 入口规范化为真实 unpacked 路径

调整 `src/platform/cli/runtime.ts`：

- 开发环境继续使用 `require.resolve()` 得到的 npm 包路径。
- 打包环境确认解析结果位于 `app.asar/node_modules/npm` 后，将 npm 根目录映射到 `process.resourcesPath/app.asar.unpacked/node_modules/npm`。
- 对物理 npm 根目录、`package.json` 和 `bin/npm-cli.js` 执行 canonical containment、普通文件与版本校验。
- 返回给安装驱动的 `runtime.npm.cliPath` 必须是 `app.asar.unpacked` 下的真实绝对路径。
- 外置 npm 缺失、越界或版本不一致时失败关闭，不回退系统 `npm`、PATH 或 ASAR 虚拟入口。

`electron-builder.yml` 现有 `asarUnpack: node_modules/npm/**/*` 保留，并由打包约束检查源码固定。第三方 CLI 仍安装到应用数据目录，无需迁移。

### 4. 按 Electron 宿主事实校验 Node 运行时

调整 `src/platform/cli/runtime.ts` 的宿主校验职责：

- Electron 版本继续与运行时锁的 `host.version` 精确比较，但事实来源为当前宿主提供的 `process.versions.electron`。
- Node 版本继续与 `host.nodeVersion` 精确比较，事实来源为 `process.versions.node`。
- Node 执行入口继续固定使用当前应用的 `process.execPath` 并设置 `ELECTRON_RUN_AS_NODE=1`，绝不查询系统 Node、PATH 或全局 npm。
- 删除运行时对 `require.resolve("electron/package.json")` 的依赖，因为该构建期 npm 包不属于生产资源契约。
- `host.integrity` 继续绑定根 `package-lock.json` 中的 Electron 发布摘要，用于构建配置与运行时锁的静态一致性校验；生产运行时的宿主可信边界由已打包 Electron 二进制、精确版本和应用代码签名共同保证。

npm 与 Electron 不合并处理：npm 是需要作为脚本执行的应用依赖，必须继续验证 unpacked 物理清单、精确版本和 bin 入口。

### 5. 保持注册表安全模型不变

`catalog.ts` 和 `registry.ts` 不增加 `asar` 特判，不绕过以下校验：

- canonical path containment；
- 符号链接与非普通文件拒绝；
- `O_NOFOLLOW` 安全打开；
- 打开前、文件描述符和打开后的设备号/inode/大小/时间戳一致性；
- 文件数量、深度、大小和 JSON 结构预算。

将描述文件外置为真实文件，正是为了让现有安全契约在开发包和生产包中保持一致。

### 6. 更新打包约束检查源码

更新 `test/src/domains/connector/node/packaging.test.ts`，使其静态表达以下打包契约：

- ASAR 的 `files` 明确排除两个描述 JSON；
- `extraResources` 只允许复制这两个 JSON；
- 供应商子目录继续排除；
- 仓库资源目录仍只包含这两个顶层文件。
- `node_modules/npm/**/*` 继续由 `asarUnpack` 发布为真实文件。
- 运行时不再要求生产 ASAR 包含 `node_modules/electron/package.json`。

依据当前项目约束，本次不自动运行测试套件；只维护回归测试源码。

### 7. 同步长期架构文档

在受管 CLI 连接器框架文档中补充生产资源布局：连接器目录与运行时锁是应用签名范围内的外置只读资源，固定从 `process.resourcesPath/builtin-connectors` 读取；连接器厂商包仍由用户点击安装后按目录 JSON 下载并验证。

## 资源布局

```text
PiCoddy-a.app/Contents/Resources/
├── app.asar
│   └── 不包含 resources/builtin-connectors 下的任何文件
├── app.asar.unpacked/
│   └── node_modules/npm/          # 受管 npm CLI 的真实文件
└── builtin-connectors/
    ├── connector-catalog.json
    └── connector-runtime-lock.json
```

Windows 和 Linux 使用 electron-builder 对 `extraResources` 的同一语义，运行时统一通过 `process.resourcesPath` 定位，不硬编码 macOS 的 `.app/Contents/Resources` 路径。

## 影响范围

- `electron-builder.yml`：连接器描述文件的打包位置。
- `src/domains/connector/node/assembly.ts`：开发/打包资源根目录解析。
- `src/platform/cli/runtime.ts`：打包环境受管 npm 入口的真实路径解析与校验。
- `test/src/domains/connector/node/packaging.test.ts`：打包资源契约的回归检查源码。
- `test/src/platform/cli/runtime.test.ts`：受管 npm 真实路径解析的回归检查源码。
- `docs/superpowers/specs/2026-08-25-managed-cli-connector-framework-design.md`：长期有效的生产资源边界说明。
- `docs/README.md`：新增本设计索引。

不影响前端 API、IPC、数据库、连接器安装目录、授权凭证或会话工具激活逻辑。普通前端静态文件、HTML、提示词等只需读取且不要求真实文件身份的资源继续留在 ASAR。

## 风险与控制

### 外置文件可被篡改

风险：ASAR 外文件不受 ASAR 容器保护。

控制：正式发布时它们仍位于应用签名覆盖的 `Resources` 目录；运行时继续执行严格 schema、包版本、integrity 和真实文件身份校验。连接器包本身仍必须通过目录声明的 SHA-512 完整性验证。此方案不把用户可写目录作为信任源。

### 打包配置误复制供应商资源

风险：使用目录级 `extraResources` 可能把未来误放的文件一并发布。

控制：使用两个显式文件条目或等价的精确白名单过滤器，并由打包约束检查源码固定允许集合。

### 开发与生产路径分支判断错误

风险：错误识别运行环境会导致读取错误目录。

控制：判断模块路径是否实际处于 `app.asar`，而不是依赖可变环境变量；生产分支只接受 `process.resourcesPath` 下的固定子目录，无回退链。

### npm 虚拟路径映射错误

风险：简单字符串替换可能接受伪造或越界路径。

控制：仅在模块路径明确位于 `app.asar` 的打包分支启用映射；目标固定为 `process.resourcesPath/app.asar.unpacked/node_modules/npm`，并在返回入口前执行 canonical containment、普通文件和版本校验。任何失败都拒绝启动连接器体系。

### 误把构建依赖当作生产资源

风险：继续在运行时解析 `electron/package.json` 会让正常的 electron-builder 产物被误判为缺少宿主运行时。

控制：明确区分宿主与应用依赖。宿主版本只读取 Electron 自身提供的 `process.versions`；npm 才从应用资源读取并校验。构建阶段仍保持 Electron 版本、运行时锁和根锁文件一致。

### 旧包仍然报错

风险：该问题属于打包资源布局，源码修复不会改变已经生成的旧 `.app`。

控制：修改后必须重新生成安装包；安装或替换为新产物后才会生效。

## 验证方式

遵循“禁止自动测试”的项目约束，本次实施后只执行：

1. `npx tsc --project tsconfig.electron.json --noEmit`，验证主进程与后端类型。
2. 静态解析 `electron-builder.yml`，确认 `extraResources` 精确包含两个 JSON，ASAR 明确排除它们与供应商目录。
3. 检查资源根目录分支，确认生产路径唯一指向 `process.resourcesPath/builtin-connectors` 且不存在 ASAR/用户目录回退。
4. 检查受管 npm 解析，确认打包分支返回 `app.asar.unpacked` 下的真实入口且不存在系统 npm/ASAR 回退。
5. 检查宿主校验，确认只使用 `process.versions.electron/node` 与 `process.execPath`，不再运行时解析 `electron/package.json`。
6. `git diff --check`，检查差异格式。

不自动运行测试、构建、打包或启动应用。用户后续手工重新打包时，验收标准为：

- `app.asar` 不包含 `resources/builtin-connectors` 文件；
- 应用 `Resources/builtin-connectors` 只包含两个 JSON；
- 打开连接器中心可以正常加载目录，不再出现 `Connector registry is invalid`；
- 点击安装时使用 `app.asar.unpacked/node_modules/npm/bin/npm-cli.js`，可以完成第三方 CLI 下载与版本校验；
- 点击连接器加号仍进入既有按需安装流程。
