# Windows MSI 构建与启动处理记忆

## Electron 主进程危险操作日志（2026-09-04）

Electron 客户端将启动、IPC/API、数据库、Windows 凭据、PowerShell、原生进程、MCP、连接器和主/渲染/子进程异常写入脱敏 JSONL：

```text
%LOCALAPPDATA%\Pi-a\logs\operations.jsonl
```

同时保留：

```text
%LOCALAPPDATA%\Pi-a\logs\startup.log
%LOCALAPPDATA%\Pi-a\logs\main.log
```

Windows 上实时打印操作日志：

```powershell
$log = "$env:LOCALAPPDATA\Pi-a\logs\operations.jsonl"
while (-not (Test-Path $log)) { Start-Sleep -Milliseconds 200 }
Get-Content $log -Wait
```

日志只记录操作名、阶段、耗时、退出码、provider ID 和错误堆栈；API Key、Token、密码、Authorization、Cookie、请求正文、标准输入和完整命令参数均不得写入。危险 native 操作在执行前同步写入 `begin`，因此 native 直接崩溃时最后一条记录仍可定位边界。重新打包使用：

```powershell
npm run build:win
```

## 2026-08-31 Electron 窗口菜单与字体适配

当前桌面入口已迁移为 Electron。Windows 主窗口使用 `titleBarStyle: "hidden"` 与 `titleBarOverlay`：左侧由前端在同一行显示 Logo、`PiCoddy-a` 和“编辑(E) / 窗口(W) / 帮助(H)”，右侧继续使用 Electron 提供的 Windows 原生最小化、最大化和关闭按钮。顶级菜单点击后通过受限 IPC 调用 `Menu.popup()` 显示原生子菜单，编辑与窗口命令继续使用 Electron 标准角色。窗口不使用 `frame: false`，仍保留系统边框、拖边缩放和贴靠能力；macOS 继续使用既有 `hiddenInset` 窗口与平台菜单。

前端不捆绑第三方字体，统一使用系统字体回退：Windows 优先 `Segoe UI Variable / Segoe UI`，中文回退到 `Microsoft YaHei UI / Microsoft YaHei`，等宽内容优先 `Cascadia Mono / Cascadia Code / Consolas`；macOS 继续使用系统 UI 字体和 SF Mono 回退。这样可跟随 Windows ClearType 和系统 DPI 缩放，不增加安装包字体资源。

当前平台差异保持如下：macOS 使用 `hiddenInset` 和 Dock 菜单，关闭主窗口时隐藏应用；Windows 使用原生标题栏并在关闭最后一个窗口时退出。macOS 的 Dock、AppleScript、Finder 和权限入口不能在 Windows 使用；Windows 的 Win32 自动化和 Windows 凭据保护不能在 macOS 使用。Windows 当前不创建托盘入口。

### 附件与脚本能力

Electron 附件选择在 macOS 和 Windows 使用同一链路：渲染进程保留标准 `<input type="file">`，preload 通过 Electron `webUtils.getPathForFile` 获取用户实际选择文件的本地路径，主进程再按统一大小、扩展名和文件名规则复制到应用附件目录。文件内容不通过 IPC 传输，完整源路径也不暴露给渲染页面。非 Electron 浏览器开发环境继续使用 HTTP `FormData`。

Windows 工作区文件读取、创建和修改由 Node 文件 API及无控制台窗口的 `cmd.exe` 工具支持。Python 不包含在安装包中；只有用户系统已安装相应解释器并加入 PATH 时才能执行。现有部分专家管理脚本使用 `python3` 命令，因此在仅提供 `python.exe` 或 `py.exe` 的 Windows 环境中不可用，本次附件修复不增加解释器安装或探测逻辑。

更新日期：2026-07-31
验证环境：Windows x64、Deno 2.9.4、Deno Desktop CEF 后端

## 已验证结论

在项目根目录执行：

```powershell
deno task build:windows:msi
```

成功产出：

```text
dist/windows/PiCoddy-a.msi
```

2026-07-30 “首次启动、切换模型和对话执行不弹控制台”修复产物：

```text
大小：231518208 bytes
SHA256：693D7FD4128E644261280BC9D360D48051021F44006F889D0622DE6DFF3921F8
```

2026-07-30 “DMG 同源 Logo、快捷方式图标和卸载不重启”修复产物：

```text
大小：231890944 bytes
SHA256：3C3C671C2651C17BA68E7F0C596E200F7F04500108ADB835F640FF743563CDCE
```

2026-07-30 “统一中文 UTF-8 应用内对话框”修复产物：

```text
大小：231890944 bytes
SHA256：40E6402A1B25D7D53EEDDD62D17C884F441F9EF88F4336ED8E6CD8FEB8122939
```

2026-07-31 “产品名由 Pi-a 统一改为 PiCoddy-a”修复产物：

```text
文件：dist/windows/PiCoddy-a.msi
大小：231886848 bytes
SHA256：A5DEF9ACF0325564E40E3C6A98C891C89BD005079D2EE640005C6CC77D4612B0
```

本次生成的 MSI 已完成真实安装和启动验收。验收通过项目包括：

- `bootstrap.ready`
- 主窗口可见且存在 `MainWindowHandle`
- 主窗口持续可见至少 75 秒
- 内嵌前端首页可访问
- 后端 `/api/conv` 可访问
- Windows 技能草稿锁和原子元数据替换可用

## 产品名由 Pi-a 统一改为 PiCoddy-a

### 用户可见名称

以下位置统一使用 `PiCoddy-a`：

- 应用窗口标题、登录页、侧栏、欢迎页和设置页；
- 聊天思考文案、加载提示、托盘提示和托盘菜单；
- 智能体系统提示、导出会话中的助手名称和专家中心品牌文案；
- macOS `.app` / `.dmg` 名称；
- Windows MSI、启动器、运行库、安装目录、开始菜单和桌面快捷方式；
- README、当前架构文档和 CI 发布产物名称。

Windows 最终产物的 MSI 数据库验证结果：

```text
ProductName      | PiCoddy-a
INSTALLDIR       | PiCoddy-a
File             | PiCoddy-a.exe
AppShortcut      | PiCoddy-a      | PiCoddyAIcon
DesktopShortcut  | PiCoddy-a      | PiCoddyAIcon
REBOOT           | ReallySuppress
UpgradeCode      | {4B438502-EE3E-595F-9B66-6A6A62C7D911}
```

### 必须保留的兼容标识

品牌改名时不能直接全局替换小写 `pi-a` 或历史数据路径，否则升级后会出现
“Key、会话、技能和设置全部消失”的假象。当前有意保留：

```text
desktop.app.identifier = com.picoddy.pi-a
Windows 数据目录       = %LOCALAPPDATA%\Pi-a
macOS 数据目录         = ~/.pi-a
系统密钥服务名         = pi-a
数据库和技能标记       = pi-a.db / .pi-a-*
```

这些值仅用于升级兼容和读取旧数据，不会展示为产品名称。新安装包仍能读取旧版
Pi-a 保存的 API Key、设置、会话、技能和长期记忆。新的默认工作区名称则使用
`~/PiCoddy-a`。

Deno Desktop 会根据新的产品名重新生成 `UpgradeCode`；只保留
`desktop.app.identifier` 并不能让 Windows Installer 自动替换旧版。MSI
定制脚本因此还会：

1. 把新版 `UpgradeCode` 固定为旧版 Pi-a 的升级族 GUID；
2. 创建 `Upgrade` 表，检测版本上限为当前 `ProductVersion`；
3. 把 `PICODDY_PREVIOUSVERSIONS` 加入 `SecureCustomProperties`；
4. 在 UI/Execute 序列加入 `FindRelatedProducts` 和
   `MigrateFeatureStates`；
5. 在 Execute 序列的 `InstallValidate` 与 `InstallInitialize` 之间加入
   `RemoveExistingProducts`。

最终数据库验证：

```text
Upgrade:
{4B438502-EE3E-595F-9B66-6A6A62C7D911} | 1.0.0 | 513 | PICODDY_PREVIOUSVERSIONS

InstallExecuteSequence:
FindRelatedProducts    | 25
MigrateFeatureStates   | 1200
RemoveExistingProducts | 1450

InstallUISequence:
FindRelatedProducts    | 25
MigrateFeatureStates   | 1200
```

这样运行 `PiCoddy-a.msi` 时，Windows Installer 能识别并移除同升级族的旧版
Pi-a，再安装新的 PiCoddy-a；用户数据目录和系统密钥服务名不变。

### Windows 标题栏名称与 Logo

只修改前端侧栏和 MSI 快捷方式还不够。Windows 原生标题栏由
`Deno.BrowserWindow` 所属的 Win32 窗口控制；旧 MSI 运行时仍可能显示
`Pi-a` 和 Deno 默认图标。当前 Deno Desktop 的 BrowserWindow 接口支持标题，
但没有公开窗口图标参数，因此仓库增加：

```text
src/platform/windows_window_branding.ts
```

主窗口创建后，该模块通过 Deno FFI 直接调用 Win32：

1. `EnumWindows` 找出当前应用进程拥有的窗口；
2. `SetWindowTextW` 把原生标题统一设为 `PiCoddy-a`；
3. `LoadImageW` 从安装目录中的 `AppIcon.ico` 加载 32/16 像素图标；
4. `WM_SETICON` 同时设置大、小窗口图标；
5. `SetClassLongPtrW` 更新窗口类图标，覆盖标题栏和任务切换视图；
6. 创建窗口后的 0、80、250 毫秒重试，覆盖 CEF 子窗口稍后建立的情况。

`AppIcon.ico` 由 Windows 安装包携带，和 macOS DMG 使用同一品牌源图生成。
处理过程不启动 PowerShell、`cmd.exe` 或其他控制台进程，不会引入闪窗。

打包后动态启动日志已验证：

```text
[window-branding] windows=6; icon=...\PiCoddy-a\AppIcon.ico
```

如果截图中标题栏和侧栏都仍显示 `Pi-a`，说明正在运行旧版进程或旧 MSI。
应先完全退出旧版，再安装最新 `dist/windows/PiCoddy-a.msi`；不能用旧进程判断
新版品牌是否生效。

### 构建验证

```powershell
deno task build:windows:msi
deno run --allow-read scripts/verify-windows-artifacts.ts `
  dist/windows-installer/PiCoddy-a `
  dist/windows/PiCoddy-a.msi `
  resources/app-icon.ico
```

品牌迁移、标题栏品牌和 MSI 升级兼容测试共 14 项通过；最终嵌入前端验证为：

```text
PiCoddyBrand=true
LegacyVisibleBrand=false
Utf8Chinese=true
NativeConfirm=false
```

## 构建前提

1. 使用 Windows 10/11 x64。
2. 安装 Deno 2.9 或更新的兼容版本。
3. 项目根目录已有 `node_modules`；如果没有，先完成项目依赖安装。
4. 确认 `deno --version` 能正常执行。

如果 `Get-Command deno` 能找到命令，但执行时报“没有应用程序与此操作的指定文件有关联”，应检查 WinGet 符号链接：

```powershell
$command = Get-Command deno
$link = Get-Item $command.Source -Force
$link.Target
Test-Path -LiteralPath $link.Target
```

必要时临时直接调用 `$link.Target` 指向的真实 `deno.exe`，并修复或重新安装 Deno。

## 本次“能构建但打不开”的根因

`src/vendor/pi_coding_agent.ts` 为避免加载终端 UI 和原生剪贴板模块，深导入了
`@earendil-works/pi-coding-agent` 的无 UI 工具入口。

Windows 的 `node_modules/@earendil-works/pi-coding-agent` 是符号链接。Deno
Desktop 2.9.4 打包时把真实 `.deno/...` 目标嵌入 `Pi-a.dll`，运行时却仍按
`node_modules/@earendil-works/...` 逻辑路径查找，最终报错：

```text
Module not found:
.../node_modules/@earendil-works/pi-coding-agent/dist/core/tools/index.js
```

不要通过给 `deno compile/desktop` 增加整个符号链接目录的 `--include` 来修复。
Deno 2.9.4 在此场景会于 `virtual_fs.rs` 触发 panic。

仓库当前的稳定处理方式是：

1. `scripts/stage-windows-dependencies.ts` 把 npm 包复制到真实目录
   `scratch/windows-deps/pi-coding-agent`。
2. `deno.windows.json` 将两个无 UI 深入口映射到该真实目录。
3. `deno.json` 的 `build:windows:msi` 在打包前自动执行依赖暂存。
4. 普通开发配置仍通过 `node_modules` 使用同一组别名。

`scratch/` 已在 `.gitignore` 中，不会被提交，也不是应用的外部运行依赖。

## 构建后验证

### 1. 检查 MSI

```powershell
Get-Item dist\windows\PiCoddy-a.msi
Get-FileHash dist\windows\PiCoddy-a.msi -Algorithm SHA256
```

### 2. 安装到指定验收目录

该 MSI 的目录属性是 `INSTALLDIR`，不是 `TARGETDIR`。静默安装示例：

```powershell
$msi = (Resolve-Path "dist\windows\PiCoddy-a.msi").Path
$installDir = (Join-Path (Resolve-Path "dist").Path "msi-installed")
$arguments = @(
  "/i",
  $msi,
  "/qn",
  "/norestart",
  "INSTALLDIR=$installDir",
  "/l*v",
  (Join-Path (Resolve-Path "dist").Path "msi-install.log")
)
$process = Start-Process "$env:SystemRoot\System32\msiexec.exe" `
  -ArgumentList $arguments -Wait -PassThru
$process.ExitCode
```

退出码 `0` 表示安装成功。

### 3. 动态启动验收

PowerShell 7 可直接运行：

```powershell
pwsh -File scripts\windows-package-acceptance.ps1 `
  -BundleDir "dist\msi-installed"
```

Windows PowerShell 5 对 UTF-8 无 BOM 脚本可能按本地 ANSI 解析。此时要显式按
UTF-8 读取：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -Command `
  "& ([scriptblock]::Create((Get-Content -Raw -Encoding UTF8 `
  'scripts\windows-package-acceptance.ps1'))) `
  -BundleDir 'dist\msi-installed' -TimeoutSeconds 90"
```

验收脚本会启动窗口、检查前端和后端 API、观察窗口至少 75 秒，并在结束时关闭
测试实例。窗口生命周期遵循 Deno Desktop 官方模式：首个
`new Deno.BrowserWindow()` 接管启动窗口，`Deno.serve()` 就绪后由运行时自动
导航，不对 `close` 事件增加启动定时器或拦截器。

参考 Deno 官方文档：

- [Desktop Windows 与 BrowserWindow 生命周期](https://docs.deno.com/runtime/desktop/windows/)
- [Desktop HTTP serving](https://docs.deno.com/runtime/desktop/serving/)

### 4. 静态产物校验

```powershell
deno run --allow-read scripts/verify-windows-artifacts.ts `
  "dist/msi-installed" "dist/windows/PiCoddy-a.msi"
```

当前 Deno Desktop 产物名为 `PiCoddy-a.dll`；脚本同时兼容旧产物名
`runtime.dll`。当前 Windows 剪贴板实现走 PowerShell/.NET，因此静态标记是
`System.Windows.Forms.Clipboard`，不是旧的原生 clipboard Node 模块。

## 启动故障排查

优先查看：

```text
%LOCALAPPDATA%\Pi-a\logs\startup.log
```

备用位置：

```text
%TEMP%\Pi-a-startup.log
```

关键结构化阶段：

- `http.started`：本地 HTTP 服务已启动，`message` 是服务地址。
- `window.main.visible`：主窗口已请求显示。
- `bootstrap.ready`：应用启动流程完成。
- `bootstrap.failed`：启动失败，包含错误消息和堆栈。

只看到 MSI 构建成功不代表应用可运行。发布前至少应完成一次真实安装和动态启动
验收。

## Windows API Key 无法保存：DPAPI 找不到 PowerShell

### 症状与根因

设置页点击“保存 Key”后仍显示“未配置”，后端保存接口返回：

```text
HTTP 500
Windows DPAPI 加密失败：
Failed to spawn 'powershell.exe': entity not found
```

这不是 API Key 无效，也不是缺少 `--allow-run`。Windows MSI 已授予运行子进程
权限，真正原因是 Deno Desktop 后端进程的 `PATH` 不一定包含 PowerShell。
如果通过相对命令名 `powershell.exe` 启动 DPAPI 加密脚本，打包后的应用可能
无法解析该命令。

### 稳定处理方式

1. 从 `SystemRoot`（其次为 `WINDIR`）解析系统目录。
2. 使用绝对路径
   `System32\WindowsPowerShell\v1.0\powershell.exe`，不依赖 `PATH`。
3. PowerShell 读取标准输入前，将 `Console.InputEncoding` 固定为无 BOM UTF-8，
   避免非 ASCII 凭据往返后乱码。
4. Key 仍只通过标准输入传给 PowerShell，不能放进命令参数、环境变量或日志。
5. 前端保存方法不能吞掉异常；应把后端错误显示在当前 Provider 卡片中。

对应实现：

- `src/infra/windows_credentials.ts`
- `frontend/src/store/useStore.ts`
- `frontend/src/components/SettingsModal.tsx`

### 验证

运行凭据单元测试和真实 Windows DPAPI 往返测试：

```powershell
deno test --allow-all `
  src/infra/windows_credentials_test.ts `
  src/infra/keychain_test.ts `
  src/infra/keychain_windows_test.ts
```

动态产物验收脚本也会使用随机临时 Provider 执行：

```text
POST /api/settings/keys
检查加密凭据文件已落盘
DELETE /api/settings/keys/:provider
检查临时凭据文件已删除
```

验收结束不会留下临时 Key。看到以下输出说明打包后的 Windows 子进程路径和
DPAPI 写入链路均正常：

```text
PASS Windows DPAPI credential save and delete
```

“保存 Key”和“测试连接”是两条独立链路。401/403 表示远端 Provider 拒绝了
凭据；例如 DeepSeek Key 必须配置在 DeepSeek 卡片中，不能配置在 Qwen 卡片中。
Mac 可以交叉构建包含此修复的 Windows MSI，但 MSI 内的 DPAPI 验收仍必须在
Windows 上完成。

## 对话时频繁弹出 PowerShell 窗口

### 原因

Windows 版原先有多条 PowerShell 子进程链路：

- DPAPI 解密 API Key；
- 获取前台应用、选中文本和剪贴板；
- Computer Use 的截图、点击、输入和按键；
- 防止系统休眠。

其中模型鉴权解析器会在每次请求时调用 `getApiKey()`。旧实现每次都重新启动
PowerShell 解密，同一轮对话可能启动多次；这些调用没有指定隐藏窗口，因此
打包后的 GUI 应用会显示或闪过 PowerShell 控制台。

### 处理

1. 所有 Windows PowerShell 调用统一通过
   `src/platform/windows_powershell.ts` 生成。
2. 使用 `SystemRoot` 下的绝对 `powershell.exe` 路径。
3. 所有非交互调用仍统一带上：

   ```text
   -NoLogo -NoProfile -NonInteractive -WindowStyle Hidden
   ```

4. 不能只依赖 `-WindowStyle Hidden`。Windows 可能先创建控制台，再由
   PowerShell 解析参数并隐藏，仍会产生闪窗。
5. 新增 `src/platform/windows_process.ts`，通过 Deno FFI 直接调用 Win32
   `CreateProcessW`，创建标志固定包含：

   ```text
   CREATE_NO_WINDOW | CREATE_UNICODE_ENVIRONMENT
   ```

6. `STARTUPINFO` 同时设置 `SW_HIDE` 和重定向的 stdin/stdout/stderr 管道。
   因此控制台从操作系统创建阶段就不存在，而不是创建后再隐藏。
7. DPAPI 首次解密成功后把 Key 缓存在当前应用进程内；后续模型请求直接复用。
8. 保存 Key 时更新缓存，删除 Key 时清理缓存，应用退出后缓存自然消失。
9. API Key 仍由 Windows DPAPI 加密落盘，明文只通过匿名 stdin 管道传入，不写
   临时文件、命令参数、环境变量或日志。
10. 防休眠不再启动常驻 PowerShell，改为直接调用
    `kernel32!SetThreadExecutionState`。

目录选择器虽然使用隐藏 PowerShell 宿主，但它创建的
`FolderBrowserDialog` 仍会按用户操作正常显示。

验证时至少运行：

```powershell
deno test --allow-all `
  src/platform/windows_process_test.ts `
  src/platform/windows_powershell_test.ts `
  src/platform/shell_test.ts `
  src/platform/power_test.ts `
  src/agent/tools/os_windows_test.ts `
  src/infra/windows_credentials_test.ts `
  src/infra/keychain_test.ts `
  src/infra/keychain_windows_test.ts
```

静态产物校验会检查 `CreateProcessW`、`CREATE_NO_WINDOW`、
`SetThreadExecutionState` 和 `kernel32.dll` 已嵌入 Windows runtime。

### 首次打开、切换模型或执行 `dir/chcp` 时仍弹窗

这些现象来自不同触发点，但底层问题相同：

- 首次打开或首次读取某 Provider 时，DPAPI 会启动 PowerShell 解密 Key。
- 切换到尚未缓存 Key 的模型时，会再次触发对应 Provider 的 DPAPI 解密。
- 对话中的 `bash` 工具会执行 `dir`、`chcp`、`mkdir` 等 `cmd.exe` 命令。
- 剪贴板、选中文本、窗口信息和 Computer Use 也会按需启动 PowerShell。

`node:child_process` 的 `windowsHide` 和 PowerShell 自身的
`-WindowStyle Hidden` 都不够早，无法保证零闪窗。最终处理方式是让以上所有
Windows 控制台子进程统一走 `runWindowsProcessNoWindow()`：

1. DPAPI 加密/解密保留 PowerShell 与 CurrentUser DPAPI，但由
   `CreateProcessW + CREATE_NO_WINDOW` 创建。
2. `src/platform/process.ts` 在 Windows 自动切换到原生执行器，因此剪贴板、
   目录、前台窗口和选中文本调用自动覆盖。
3. Computer Use 的 PowerShell 调用直接使用原生执行器。
4. Windows `bash` 工具直接以原始 `cmd.exe /d /s /c` 命令行执行，不再经过
   Node 兼容层、WMI、VBScript 或临时 PowerShell 包装器。
5. `cmd.exe` 前置绝对路径 `chcp.com 65001`，保留中文路径和 UTF-8 输出。
6. stdout/stderr 使用匿名管道，输出上限和超时终止仍由应用控制。

- `src/platform/windows_process.ts`
- `src/agent/tools/windows_shell.ts`
- `src/infra/windows_credentials.ts`
- `src/platform/process.ts`
- `src/platform/power.ts`
- `src/agent/tools/os_windows.ts`
- `src/agent/tools/windows_shell_test.ts`

验证命令：

```powershell
deno test --allow-all `
  src/platform/windows_process_test.ts `
  src/agent/tools/windows_shell_test.ts
```

还应执行两类窗口生命周期监测：

- 让原生执行器运行至少 2 秒的 PowerShell，持续通过 Windows
  `IsWindowVisible` 检查；窗口句柄必须为 `0`，可见性必须为 `False`。
- 运行真实 `keychain_windows_test.ts` DPAPI 往返，轮询带
  `-EncodedCommand` 的 PowerShell；所有加密/解密进程必须始终不可见。

```text
PASS CreateProcessW PowerShell stayed invisible for its full lifetime
PASS DPAPI/model-key PowerShell processes stayed invisible
```

本轮最终回归结果：

```text
30 passed | 0 failed
PASS Windows x64 PE launcher/runtime
PASS Windows MSI signature
PASS Windows bootstrap, native no-window process, DPAPI and clipboard markers
PASS no keytar/node-pty/winpty payload
PASS Windows DPAPI credential save and delete
```

Windows 官方将 `CREATE_NO_WINDOW` 定义为“不为控制台应用创建控制台窗口”的
进程创建标志。这里必须把标志传给 `CreateProcessW`，仅在 PowerShell 参数中写
`-WindowStyle Hidden` 不能达到同等保证：

- [Microsoft：Process Creation Flags](https://learn.microsoft.com/windows/win32/procthread/process-creation-flags)

## MSI 安装后自动创建桌面快捷方式

Deno Desktop 2.9.4 生成的 MSI 已自带开始菜单快捷方式：

```text
AppShortcut | ProgramMenuFolder | Pi-a | [#f4] | INSTALLDIR
```

但当前 `deno desktop --help` 和 Desktop Distribution 配置没有公开桌面快捷方式
开关。为保证安装、升级、修复和卸载行为均由 Windows Installer 管理，不能在
首次启动时临时调用 PowerShell 创建 `.lnk`。

仓库新增 `scripts/add-windows-msi-shortcuts.ts`。它在 `deno desktop` 生成 MSI
之后、`stage-windows-msi.ts` 复制最终产物之前，使用 `msi.dll` 的数据库 API
以事务方式写入：

```text
Directory:
DesktopFolder | TARGETDIR | .

Shortcut:
DesktopShortcut | DesktopFolder | Pi-a | c0 | [#f4] | PiAIcon | 0 | INSTALLDIR
```

脚本不会固定假设 `f4/c0`：它会读取 MSI 的 `File` 表，根据 `Pi-a.exe` 自动
找到文件键和所属组件，再生成快捷方式记录。这样即使 Deno 后续改变文件编号，
仍会指向正确的启动器。

由于当前 MSI 设置 `ALLUSERS=1`，Windows Installer 会把 `DesktopFolder`
解析为公共桌面。因此安装完成后所有本机用户都能看到 `Pi-a` 快捷方式；卸载时
该快捷方式会随所属组件一并删除。

构建流程已自动集成：

```powershell
deno task build:windows:msi
```

`build:windows:msi` 会先重新构建前端并刷新 `src/ui/frontend-assets.ts`，然后
生成并定制 MSI。不能跳过这一步复用旧 `frontend/dist`，否则新后端鉴权逻辑
可能与旧前端不匹配，设置页会因 `/api/settings` 返回 401 而显示空服务商列表。

成功日志应包含：

```text
[add-windows-msi-shortcuts] Pi-a.msi: DesktopFolder/Pi-a -> Pi-a.exe; PiAIcon -> app-icon.ico; REBOOT=ReallySuppress
```

对应测试：

```powershell
deno test --allow-read --allow-env --allow-ffi `
  scripts/add-windows-msi-shortcuts_test.ts
```

`verify-windows-artifacts.ts` 也会检查最终 MSI 的 `DesktopFolder`、
`DesktopShortcut`、`PiAIcon` 和禁止重启策略标记。2026-07-30 最终产物查询
结果：

```text
AppShortcut     | ProgramMenuFolder | Pi-a | [#f4] | PiAIcon | 0 | INSTALLDIR
DesktopShortcut | DesktopFolder     | Pi-a | [#f4] | PiAIcon | 0 | INSTALLDIR
```

## Windows 快捷方式使用 DMG 同源 Logo

### 原因

`deno desktop --icon resources/app-icon.ico` 没有把 Logo 可靠地写入当前 Windows
启动器。安装后的 `Pi-a.exe` 仍是 Windows 通用程序图标；同时 Deno 生成的
`AppShortcut` 和后续注入的 `DesktopShortcut` 的 `Icon_` 都为空，所以桌面上
看到的是蓝色通用窗口图标，而不是 Logo。

原 `.ico` 还使用了 PNG 压缩帧。Pillow 可以读取，但部分 Win32 图标解码器对
128/256 像素帧解析不稳定。不能只依赖 EXE 的关联图标。

### 稳定处理方式

1. macOS DMG 和 Windows 继续共用
   `frontend/public/assistant-avatar.png` 这一份品牌源图。
2. `scripts/generate-icon.py` 为 Windows 生成 16、24、32、48、64、128、256
   像素的 DIB/BMP 帧 `.ico`，兼容 Explorer、Windows Installer 和旧 Win32
   解码器。
3. `scripts/add-windows-msi-shortcuts.ts` 创建 MSI `Icon` 表，将
   `resources/app-icon.ico` 写入名为 `PiAIcon` 的二进制记录。
4. 开始菜单和桌面两个快捷方式都显式设置：

   ```text
   Icon_ = PiAIcon
   IconIndex = 0
   ```

本轮 Windows 图标文件：

```text
resources/app-icon.ico
大小：361102 bytes
SHA256：610B7E33F0757ED18B6AC061A2986DED322CDF129C0C380D3B4116F0E24EDCD7
```

真实安装后，快捷方式的图标位置应类似：

```text
C:\Windows\Installer\{ProductCode}\PiAIcon,0
```

这表示 Explorer 正在使用 MSI 缓存中的品牌图标，不再依赖通用 EXE 图标。

## MSI 安装与卸载禁止自动重启电脑

Windows Installer 即使没有显式的 `ForceReboot` 或 `ScheduleReboot` 动作，
仍可能在文件占用或维护模式下提出重启。构建后定制脚本会向 MSI `Property`
表写入：

```text
REBOOT               | ReallySuppress
REBOOTPROMPT         | S
MSIDISABLERMRESTART  | 1
```

- `REBOOT=ReallySuppress`：禁止安装和卸载主动重启电脑。
- `REBOOTPROMPT=S`：禁止显示重启提示。
- `MSIDISABLERMRESTART=1`：禁止 Restart Manager 在安装结束后自动重启其关闭的
  应用。

命令行自动化仍建议同时传入 `/norestart`，形成双重保护：

```powershell
msiexec /i dist\windows\Pi-a.msi /qn /norestart
msiexec /x "{ProductCode}" /qn /norestart
```

2026-07-30 真实验收结果：

```text
安装退出码：0
应用主窗口：可见
卸载退出码：0
卸载后安装目录：不存在
卸载后桌面快捷方式：不存在
系统重启：未触发、未要求
```

保持 Pi-a 主窗口运行时再次执行卸载，验收结果：

```text
卸载前本轮 Pi-a 进程：2
Restart Manager：自动关闭本轮进程
卸载后本轮 Pi-a 进程：0
卸载退出码：0
系统重启：未触发、未要求
```

使用自定义 `INSTALLDIR` 测试运行中卸载时，Windows Installer 可能保留空的安装
根目录，但目录内的应用文件会全部删除；这不代表需要重启或仍有程序残留。

## Windows 原生确认框显示类似日语的乱码

### 原因

技能安装原先调用：

```ts
window.confirm(`确认安装技能「${skillName}」？安装后可在技能页查看和管理。`)
```

源码、`frontend/index.html` 的 `<meta charset="UTF-8">` 和 Vite 生产产物中的
文案都是正确的 UTF-8 中文。乱码只出现在 Deno Desktop CEF 为
`window.confirm()` 创建的 Windows 原生对话框中；原生桥接层错误转换字符串
编码后，中文会显示成类似日语的字符。这不是模型输出、技能文件或系统语言被改成
日语。

同类问题还会影响 `window.alert()`。不能通过更改技能文件编码、系统区域设置或
PowerShell 输出编码来修复。

### 稳定处理方式

仓库新增统一的 React 应用内对话框：

- `frontend/src/components/AppDialog.tsx`
- `frontend/src/components/AppDialog.css`
- `frontend/src/store/useStore.ts`

全局接口：

```ts
await requestUiConfirm({
  title: "安装技能",
  message: `确认安装技能「${skillName}」？`,
  confirmLabel: "确认安装",
})

await showUiAlert("请输入名称")
```

确认框和提示框完全在 HTML/React DOM 内渲染，始终沿用页面的 UTF-8 编码，不再
进入 CEF 原生 `alert/confirm` 通道。它还统一提供：

- 中文标题、正文和按钮；
- 删除/卸载操作的危险色；
- 成功提示色；
- `Esc` 取消和遮罩取消；
- 打开后自动聚焦主按钮，关闭后恢复原焦点；
- `role="dialog"` / `alertdialog` 与 `aria-modal`。

本轮已迁移全部原生弹窗：

```text
confirm：7 处
alert：10 处
prompt：0 处
迁移后原生 alert/confirm/prompt 调用：0
```

覆盖技能安装、技能删除/卸载、MCP 卸载、连接器卸载、自动化删除和表单提示、
长期记忆删除等入口。

### 构建验证

```powershell
deno task build:frontend
deno task gen:frontend
deno task build:windows:msi:package
```

发布前应解码 `src/ui/frontend-assets.ts` 的 JavaScript/CSS 内容并检查：

```text
utf8InstallText=true
utf8ManageText=true
appDialog=true
nativeConfirm=false
nativeAlert=false
```

只对 Base64 形式的 `frontend-assets.ts` 直接执行文本搜索会得出错误结论，必须
先解码 `FRONTEND_FILES`。

### Windows 1224 生成文件占用

旧版 Pi-a 后台进程有时会让 `src/ui/frontend-assets.ts` 保持内存映射，直接
覆盖时出现：

```text
ERROR_USER_MAPPED_FILE
os error 1224
```

`scripts/gen-frontend.ts` 现在会在检测到该 Windows 错误后：

1. 把旧生成文件安全换名到忽略提交的 `scratch/`；
2. 在标准路径创建新的 `frontend-assets.ts`；
3. 成功后删除旧副本；
4. 若新文件生成失败则尝试恢复旧文件。

因此通常不需要强制结束用户正在运行的 Pi-a。若旧副本仍被系统占用，脚本会保留
其明确路径并输出警告，应用退出后再清理即可。

注意：Deno 自身可以在 macOS 交叉生成 Windows MSI，但当前桌面快捷方式注入器
调用 Windows 系统的 `msi.dll`，所以包含桌面快捷方式的完整
`build:windows:msi` 流程需要在 Windows 上执行。应用中的 Windows
`CREATE_NO_WINDOW` 逻辑不受此限制；若必须在 macOS 完成安装器定制，应改用
WiX、NSIS 或 Inno Setup 重新封装 Windows 目录产物。

参考：

- [Deno Desktop：Distribution](https://docs.deno.com/runtime/desktop/distribution/)
- [Microsoft：Using the Directory Table](https://learn.microsoft.com/windows/win32/msi/using-the-directory-table)
- [Microsoft：DesktopFolder property](https://learn.microsoft.com/windows/win32/msi/desktopfolder)
