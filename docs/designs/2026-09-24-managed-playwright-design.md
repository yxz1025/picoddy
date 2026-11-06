# 按需安装浏览器自动化环境

## 背景与目标
用户确认在设置/电脑操控提供开关，开启时下载 Playwright Test 与 Chromium，按操作系统和架构适配，测试专家可使用，无需 MCP 或 pi-playwright。

## 非目标
不改应用启动，不预下载、不自动执行测试，不更改业务仓库依赖或市场专家包，不开放 Pi 扩展。

## 现状
客户端已有受管 Electron Node/npm 和 IPC/HTTP 双通道。测试专家目前主要依赖业务仓库 Playwright，缺少独立运行环境。

## 方案
新增独立平台安装服务。锁定 @playwright/test 1.63.0，使用 npm --ignore-scripts 安装后调用同版本官方 CLI install chromium。macOS 14+ x64/arm64 和 Windows 11+ x64 采用当前进程架构；Windows ia32/arm64、Linux 暂明确阻断，不用跨架构模拟下载。官方 Playwright CLI 决定对应 Chromium/ffmpeg/headless shell 包。
安装在应用数据目录按版本和平台隔离，临时目录下载和校验后发布。进程内合并安装、跨进程锁防止重入，失败可重试，关闭可取消安装。就绪检查版本、浏览器可执行文件；不启动浏览器测试。开关状态持久化；默认关闭。
设置只展示开关、平台、安装阶段、错误及重试。HTTP 和 IPC 对齐，不新增 preload 任意权限。
测试专家每轮得到受管环境路径：独立会话测试工程在受管依赖目录下，标准 Node 模块解析可找到 @playwright/test，报告落会话产物目录。提供检查开关的本地执行脚本，关闭后拒绝新的受管执行；已运行测试继续完成。此开关不撤销通用 shell 能力，也不限制用户独立安装的 Playwright。

## 影响与风险
涉及设置 UI、运行时安装、IPC 路由、测试专家上下文。安装需要网络；系统代理/企业网络错误明确显示。Node/npm 使用现有受管运行时，安装进程不使用 shell 拼接命令。Linux 暂不支持；32 位 Windows 客户端需换 x64。下载进度显示阶段与官方输出中的百分比，不伪造整体进度。

## 验证
仅 TypeScript、CJS 语法及 diff 检查；不运行测试、构建或实际安装。Windows/macOS 实机下载安装留待用户开启验证。

用户补充：首次入口明确显示“安装并开启”，只有点击后才联网下载对应平台文件；安装包不预置 Playwright/Chromium，启动和进入设置只读状态。
