# 内置运行时：按需初始化与修复

Node 使用 Electron 的 Node 模式，npm/npx 使用随包携带的官方 CLI。Python 压缩包继续通过 extraResources 放入 vendor，使用前验证摘要、解压内容、版本和架构。

## 命令执行

- buildShellEnv 只校验打包版本并生成命令包装脚本，不解压或探测 Python。
- node/npm/npx 直接启动 Electron 的 Node 模式；npx 使用 npx-cli.js，保留官方参数转换。
- python/python3/pip/pip3 通过 python-launcher.cjs 按需初始化 Python，然后继承标准输入输出执行目标命令，并转发退出码及中断信号。
- Python 启动器在加载 TypeScript 前设置打包后 esbuild 的真实路径，不依赖主进程入口执行过初始化。
- 包装脚本按宿主可执行文件和项目路径隔离，避免开发版、安装版互相覆盖。
- 开发模式允许使用本机 Node；打包模式必须与 runtime-lock.json 的 Electron、Node、npm 版本一致。

## Python 修复

旧环境探测失败时，在新的临时目录解压并验证。验证完成后发布到带版本、摘要和随机标识的新目录，最后切换 active.json。旧目录保留，避免覆盖仍被其他进程使用的文件。已有版本目录命名仍可通过 active.json 读取。

初始化失败会清除失败的 Promise 缓存，允许后续重试。架构探测增加解释器指针位数，以区分 64 位 Windows 上运行的 32 位 Python。

## 验证范围

Windows 进程入口根据 ia32/x64 的指针宽度选择 Win32 结构体布局，明确使用 WINAPI 的 stdcall 调用约定。命令包装脚本关闭延迟变量展开并切换 UTF-8，npx 路径使用 Windows 路径规则。终端传入完整的已清理环境时，不再重新合并宿主环境变量。

构建的 afterPack 阶段按目标架构检查 Python manifest、摘要、解包后的 esbuild 和 npm/npx 文件，防止 macOS 上交叉打包 Windows 时误带宿主平台的运行时。此步骤只检查产物，不执行目标程序。

按用户要求，本次仅进行代码审查、JavaScript 语法检查与 TypeScript 静态类型检查，不运行自动化测试或执行打包运行时。安装包需要重新构建后才包含这些修改；跨平台实际运行未验证。
