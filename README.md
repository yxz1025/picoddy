# PiCoddy — 开源 AI 工作伙伴

<p align="center"><img src="resources/app-icon.png" width="120" height="120" alt="PiCoddy Logo" /></p>

从一个想法开始，一起把事情做成。PiCoddy 基于 Pi Agent 引擎，将对话、文件、终端、浏览器、专家技能和 MCP 工具放进同一个工作台，支持日常办公与软件开发。

[官网](https://picoddy.com/) · [GitHub 源码仓库](https://github.com/yxz1025/picoddy) · [桌面截图](#桌面软件截图) · [桌面端快速开始](#桌面端快速开始) · [Cloud 快速开始](#cloud-快速开始) · [项目文档](docs/README.md)

> 本项目采用 [MIT License](LICENSE)。欢迎访问 [GitHub 仓库](https://github.com/yxz1025/picoddy)、提交反馈或点个 Star；第三方组件保留各自许可。

## 能做什么

- **处理文件**：生成和解析 Word、Excel、PowerPoint、PDF；桌面端支持内嵌 Office 预览、编辑与保存，具体格式兼容性取决于文档和运行环境。
- **完成日常任务**：阅读资料、整理信息、撰写报告、分析数据，在会话里查看工具执行过程和交付文件。
- **围绕仓库开发**：结合本地文件、终端和项目上下文，推进需求、设计、实现与测试。
- **扩展工作方式**：配置不同模型，使用专家与 Skills，通过 MCP 和连接器接入外部工具。外部服务需要自己的账户、凭据和授权。

## 桌面软件截图

以下配图根据 PiCoddy 桌面端现有界面重制，用示例内容展示新菜单和典型操作；它们是操作示意，不是本轮完整任务的实测截图。左侧“专家”“技能”“连接器”分别为独立入口，其他菜单仍保留。Office 文件效果以实际文档和运行环境为准，云端能力以 Cloud 文档为准。

### PPT 编辑

在会话中查看交付物，右侧继续编辑演示文稿。

![PiCoddy 桌面端：PPT 编辑示意](website/assets/readme-ppt-edit.png)

### Excel 时间表

打开表格检查 `SUM` 公式和合计值。

![PiCoddy 桌面端：Excel 时间表示意](website/assets/readme-excel-schedule.png)

### Markdown 技术说明

预览技术说明和 Mermaid 流程图；修改源文件后可重新查看。

![PiCoddy 桌面端：Markdown 预览示意](website/assets/readme-markdown-preview.png)

### Word 讲稿

在桌面工作台检查、修改并保存讲稿。

![PiCoddy 桌面端：Word 编辑示意](website/assets/readme-word-edit.png)

### 项目开发

从“已有代码迭代”开始，关联仓库并按阶段推进改动。

![PiCoddy 桌面端：项目工作台示意](website/assets/readme-project-workspace.png)

## 选择运行方式

| | 桌面端 | 云端 / 网页版 |
| --- | --- | --- |
| 入口 | 根目录 + `frontend/`，Electron | `cloud/`，独立 Web 服务 |
| 适用场景 | 本地文件、个人工作区、代码仓库 | 团队服务器与浏览器访问 |
| 账户与存储 | 本地账户、SQLite，无需企业登录 | 企业 CAS、PostgreSQL、独立文件存储 |
| 工具执行 | 桌面运行环境 | OpenSandbox 与 Worker |
| 上手方式 | 按下方步骤从源码启动 | 按下方 [Cloud 快速开始](#cloud-快速开始) 准备基础服务 |

两端数据与配置独立，不自动同步。云端仍有实施与验收中的能力，不能据桌面端截图推断云端能力完全一致。

## 桌面端快速开始

### 1. 获取源码与安装依赖

准备 Git、Node.js 24+ 和 npm，推荐在 macOS 或 Windows 上开发。Node.js 版本同时覆盖当前前端工具链与云端要求。从 [GitHub 仓库](https://github.com/yxz1025/picoddy) 获取源码，在包含 `package.json` 的项目根目录执行：

```sh
npm ci
npm --prefix frontend ci
```

安装需要访问 npm 与 Electron 下载源。此阶段无需填写云端 `.env`，不要复制维护者的服务凭据。

### 2. 启动桌面开发环境

终端一（项目根目录）：

```sh
npm --prefix frontend run dev
```

确认 Vite 在 `http://localhost:5173` 启动；端口被占用时先释放该端口，Electron 开发模式固定加载此地址。

终端二（项目根目录，macOS / Linux shell）：

```sh
npm run electron:dev
```

Windows PowerShell 使用：

```powershell
$env:NODE_ENV = "development"
npm start
```

保持两个终端运行，Electron 会自动打开桌面窗口。仅启动 Vite 不等于启动完整桌面应用；本地 API 和工具由 Electron 主进程提供。结束开发时关闭窗口，并在两个终端分别按 `Ctrl+C` 停止进程。

如果希望运行本地构建后的界面，无需 Vite 开发服务器，可在项目根目录执行：

```sh
npm run build:frontend
npm start
```

此方式要求 `NODE_ENV` 不为 `development`。如果之前在同一个 PowerShell 窗口设置过它，先执行 `Remove-Item Env:NODE_ENV -ErrorAction SilentlyContinue`。

### 3. 配置模型并完成第一个任务

1. 打开桌面工作台，进入设置中的模型配置，填写自己的服务商、模型、API Key；自定义服务还需填写对应 Base URL。
2. 选择已配置的模型，先发送一条普通消息，确认模型可达。
3. 选择测试文件夹，尝试“列出这个文件夹中的文件，生成一份摘要”。按实际需要授权文件和命令操作，检查工具结果与交付文件。
4. 需要浏览器、MCP 或业务连接器时，再安装相应依赖并完成授权。

桌面端使用本地账户，不需要企业 CAS 登录。模型调用、联网工具和远程连接器会访问所配置服务；本地运行不代表所有数据都不会离开设备。模型费用由对应服务商收取。

## 检查与构建

在项目根目录执行：

```sh
# 主进程类型检查
npx tsc --project tsconfig.electron.json --noEmit
# 前端类型检查与生产构建
npm run build:frontend
# 后端测试
npm run test:backend
```

按目标系统选择打包命令，建议在对应系统上构建：

```sh
npm run build:mac          # macOS .app
npm run build:mac:release  # macOS dmg / zip
npm run build:win          # Windows x64 安装包
```

打包会下载 Python 等资源并准备仓库内的 Office 运行时，需要网络和足够磁盘空间；产物目录由 `electron-builder.yml` 配置，当前是项目上一级的 `build/picoddy/`。当前 macOS 配置未启用签名与公证，本地打包不等于完成正式发布。发布渠道与签名需由维护者自行配置。

## Cloud 快速开始

Cloud 是 `cloud/` 下的独立 Web 应用，不需要启动 Electron，也不使用根目录 `frontend/`。模型由用户登录后配置，两端账户、文件和数据库不自动同步。

### 1. 准备基础服务与依赖

需要 Node.js 24+、独立 PostgreSQL（运维文档使用 17）、OpenSandbox 管理服务和任务镜像，以及可用的企业 CAS 登录与换票服务。macOS / Windows 开发机上的沙箱需要 Docker Desktop 的 Linux VM 或远程 Linux 执行节点。存储可先使用本地目录。

在项目根目录执行：

```sh
cd cloud
npm ci --ignore-scripts
```

### 2. 创建 Cloud 配置

在 `cloud/` 新建自己的 `.env`。下面是本地开发模板，所有 `REPLACE_*` 和 `example.com` 地址都需要替换；不要覆盖已有环境配置或复制他人的密钥。

```dotenv
HOST=127.0.0.1
PORT=8080
PUBLIC_ORIGIN=http://localhost:5173
SECURE_COOKIES=false
DATABASE_URL=postgresql://picoddy:REPLACE_DB_PASSWORD@127.0.0.1:5432/picoddy_cloud
ENCRYPTION_KEY=REPLACE_WITH_64_HEX_CHARACTERS

# 已部署的 OpenSandbox 管理地址、认证密钥及执行节点可用的镜像
SANDBOX_DOMAIN=http://127.0.0.1:8090
SANDBOX_API_KEY=REPLACE_SANDBOX_API_KEY
SANDBOX_IMAGE=picoddy-cloud-sandbox:latest

STORAGE_DRIVER=local
STORAGE_LOCAL_ROOT=./data/files

# 自己的企业登录与换票服务；必须为可信 HTTPS endpoint
CAS_LOGIN_URL=https://sso.example.com/cas/login
CAS_EXCHANGE_URL=https://auth.example.com/exchange
```

生成 `ENCRYPTION_KEY`（将输出的 64 位十六进制值填入 `.env`）：

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

`STORAGE_LOCAL_ROOT` 相对 `cloud/` 解析，API 与 Worker 必须访问同一目录。现有 CAS 接入需要符合项目的换票接口，不能只填写任意 SSO 地址；具体见 [CAS 接入实现](cloud/src/cloud/auth/cas.ts)。未配置 CAS 时，登录接口返回“云端登录服务尚未配置”。模型 Key 在登录后的设置中填写，不放入这份模板。

OpenSandbox 的部署与任务镜像构建见 [部署运维](cloud/docs/04-operations.md) 和 [同机部署指南](cloud/deploy/README.md)。上面的 `.env` 不会自动创建数据库、沙箱服务或镜像。

### 3. 初始化数据库

确认 `DATABASE_URL` 指向已经创建的独立开发库，在 `cloud/` 执行：

```sh
npm run db:init
```

该命令只接受空的独立 schema 或相同结构的已初始化库，不负责迁移或清空已有业务库。

### 4. 分别启动 API、Worker 和 Web

以下命令分别在独立终端执行，**每个终端都先进入项目的 `cloud/` 目录**，并保持运行。macOS shell 和 Windows PowerShell 使用相同的 npm 命令。

终端一，启动 API（默认 `http://127.0.0.1:8080`）：

```sh
npm run dev
```

终端二，启动任务 Worker：

```sh
npm run worker
```

终端三，启动 Web 开发服务器：

```sh
npm run web
```

需要定时任务时，在第四个终端启动 Scheduler：

```sh
npm run scheduler
```

浏览器访问 **http://localhost:5173**，完成企业登录，再配置模型并发送测试任务。Web 将 `/api` 请求代理到 `http://127.0.0.1:8080`；如果修改 API 端口，还需在 `.env` 设置对应的 `CLOUD_API_TARGET`。只启动 Web 可以打开页面，但不能完成登录和任务执行。

桌面端与 Cloud 的 Vite 默认都使用 **5173** 端口。初次体验建议分别启动，切换前先停止另一端的 Vite。需要同时开发时，可用 `npm run web -- --port 5174` 启动 Cloud，并同步将 Cloud 的 `PUBLIC_ORIGIN` 改为 `http://localhost:5174`、配置对应的 CAS 回调地址，再重启 Cloud API。

### 5. 检查启动状态与服务器部署

API 的 `/api/health` 用于检查进程是否存活，`/api/ready` 检查业务依赖；它们不代表模型和 OpenSandbox 已联通，还需登录后执行一次真实任务。停止开发时，在各终端分别按 `Ctrl+C`。

服务器部署使用 [Cloud 部署指南](cloud/deploy/README.md) 的独立流程，通过构建后的 Web 与 API 提供服务，不运行 Vite。生产环境使用自己的 HTTPS 域名、`SECURE_COOKIES=true` 和对应 CAS 回调。云端当前能力与验证进度见 [Cloud README](cloud/README.md)。

## 项目结构

```text
main.mjs                  Electron 主进程与窗口入口
application.electron.ts   本地 API 与业务装配
frontend/                 React + Vite 桌面界面
src/                      Agent、业务领域、平台与存储
resources/                内置技能、专家与品牌资源
scripts/                  构建、运行时与验证脚本
cloud/                    独立云端应用与部署文档
website/                  静态官网与入门指南
docs/                     设计、架构与实施记录
```

技术栈：Electron、React、TypeScript、Pi Agent、桌面 SQLite；云端使用 PostgreSQL 与 OpenSandbox。依赖版本以各目录 `package.json` 和锁文件为准。

## 参与贡献

通过 [GitHub 仓库](https://github.com/yxz1025/picoddy) 的 Issue 报告问题、讨论需求，通过 Pull Request 提交修改。报告问题请附操作系统、Node.js 版本、复现步骤、预期与实际结果，日志应移除密钥和个人信息。

提交前保持改动聚焦，按涉及模块运行检查：桌面端使用上面的类型检查、构建与后端测试；云端在 `cloud/` 执行 `npm run typecheck` 和 `npm test`；官网按 [website/README.md](website/README.md) 预览。说明验证结果和已知限制。不要提交 `.env`、服务令牌、企业数据或本地产物。

## 发布状态与许可

项目源码已在 [GitHub](https://github.com/yxz1025/picoddy) 开放。二次开发或部署前，请按自己的环境配置企业集成与默认服务，检查凭据、内部地址和第三方资源许可。

本项目原创代码采用 [MIT License](LICENSE)，允许使用、修改、分发和商业使用；分发时须保留版权声明与许可声明，软件按原样提供，不作担保。第三方代码、内置专家与运行时遵循各自许可。品牌素材见 [品牌说明](resources/brand/README.md)。
