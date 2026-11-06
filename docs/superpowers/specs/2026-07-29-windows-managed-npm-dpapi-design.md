# Windows 托管 npm 与 DPAPI 设计

## 背景

Pi-a 从 macOS 交叉构建 Windows 10 x64 包时，Deno Desktop 将宿主机
`node_modules` 整体嵌入 `runtime.dll`。其中包含 Mach-O arm64 版
`keytar.node` 等非 Windows 原生文件。正式程序在 JavaScript 启动日志写入前以
`0xc06d007f` 崩溃；微软将该异常定义为延迟加载 DLL 后
`GetProcAddress` 找不到入口点。

分层探针已验证：

- 最小 WebView2 程序能正常创建窗口。
- 使用 Deno 托管 npm 依赖后，原生进程崩溃消失并进入 JavaScript。
- `keytar@7.9.0` 在 macOS 交叉构建中不提供可用的 Windows
  `keytar.node`。

## 目标

1. macOS 可以稳定交叉构建 Windows 10 x64 便携包和 MSI。
2. Windows 包只嵌入模块图可达且与 Windows 目标匹配的 npm 包。
3. Windows API Key 使用操作系统当前用户作用域加密。
4. macOS 继续使用现有 keytar，调用路径和性能不变。
5. 保留现有前端、HTTP API、Agent 和窗口流程。

## 构建设计

Windows 的 portable 和 MSI 任务增加：

```text
--node-modules-dir=none --exclude-unused-npm
```

`--node-modules-dir=none` 禁止读取 macOS 项目目录中的本地
`node_modules`；`--exclude-unused-npm` 只从 Deno 托管缓存嵌入入口模块图可达的
npm 包。macOS 构建任务不增加这些参数。

构建契约测试必须验证：

- 两个 Windows 任务都包含上述参数。
- macOS 任务仍以 `main.ts` 和原有参数构建。
- Windows 入口仍为 `windows_bootstrap.ts`。

## 密钥存储设计

`src/infra/keychain.ts` 保留现有公共接口：

```ts
getApiKey(provider): Promise<string | undefined>
setApiKey(provider, key): Promise<void>
deleteApiKey(provider): Promise<void>
```

平台路由如下：

- macOS：保持现有 keytar 行为。
- Windows：调用独立的 DPAPI 适配器。
- 其他平台：保持现有 keytar 尝试与环境变量兜底行为。

Windows 适配器通过 Windows PowerShell 5.1 调用
`System.Security.Cryptography.ProtectedData`：

- `Protect(..., DataProtectionScope.CurrentUser)` 加密 UTF-8 密钥。
- `Unprotect(..., DataProtectionScope.CurrentUser)` 解密。
- 密文存入 `%LOCALAPPDATA%\Pi-a\credentials\`。
- provider 经 SHA-256 转为固定文件名，禁止路径注入。
- 明文通过子进程 stdin 传递，不进入命令行参数、环境变量或日志。
- PowerShell 脚本使用 UTF-16LE Base64 传给 `-EncodedCommand`，避免命令转义问题。
- 删除操作直接删除对应密文文件；文件不存在视为成功。

DPAPI 文件只能由创建它的 Windows 用户解密。项目不保存额外主密钥，也不把明文
API Key 写入数据库或配置文件。

## 错误处理

- 读取密钥失败时延续现有行为：记录不含密钥内容的警告并返回 `undefined`。
- 写入失败时向 API 调用方返回错误，避免界面误报保存成功。
- PowerShell 非零退出时只包含退出码和经过截断的 stderr，不记录 stdin。
- Windows 启动日志继续记录阶段信息，但不记录密钥或密文。

## 验证

自动验证包括：

1. Windows 构建参数契约测试。
2. provider 文件名稳定且不能逃逸 credentials 目录。
3. DPAPI 子进程只从 stdin 接收明文。
4. PowerShell 失败不会在错误文本中泄露明文。
5. macOS 路由仍调用 keytar 适配器。
6. `deno check` 与现有 Windows 平台测试通过。
7. 新 Windows MSI 中不包含 Mach-O `keytar.node`。

目标 Windows 10 x64 验收包括：

1. 安装并启动后不再出现 `0xc06d007f`。
2. `%LOCALAPPDATA%\Pi-a\logs\startup.log` 到达 `desktop.ready`。
3. 保存、读取和删除 API Key 均成功。
4. 退出并重新启动后仍可读取已保存密钥。
