# PiCoddy Cloud

独立维护的浏览器云端版本。桌面端目录与依赖不变。账号、数据库、文件、技能和配置独立，不导入或同步桌面数据；按全新项目初始化，不提供历史升级迁移。

架构：React Web → 原生 Node HTTP API → PostgreSQL 任务/事件 → Pi Worker → OpenSandbox；附件与交付物可配置原生私有 OSS，也保留 local 开发模式和 S3。完整空间自动回写与 Office 预览仍在实施。
技能、Shell、Node、Python、MCP、Chromium 和 Office 工具只在云端沙箱运行。

## 文档

- [一键部署脚本与服务器配置](deploy/README.md)
- [总体设计与桌面能力迁移矩阵](docs/00-design.md)
- [阶段计划](docs/01-stages.md)
- [API 与模块契约](docs/02-api.md)
- [实际进度和验证证据](docs/03-progress.md)
- [部署与运维](docs/04-operations.md)
- [企业扩展与桌面能力对齐规格](docs/05-desktop-parity.md)
- [桌面 UI 迁移设计](docs/06-desktop-ui-design.md)
- [桌面 UI 实施记录与待验收项](docs/07-desktop-ui-progress.md)
- [后端桌面基线对齐实施记录](docs/08-backend-alignment-progress.md)
- [全量桌面对齐扩展设计（已批准，实施中）](docs/designs/2026-10-12-full-desktop-parity-design.md)

## 开发入口

Node 24+；准备独立 PostgreSQL、OpenSandbox 和存储配置，在本地 `.env` 中按运维文档填写。用户通过与桌面端同源的企业 CAS 登录，首次认证自动建立云端普通用户；模型由用户登录后自行配置，不由部署人员预置。

```sh
npm ci --ignore-scripts
npm run db:init
npm run admin -- --help
npm run dev
# 分别在其他终端执行：
npm run worker
npm run scheduler
npm run web
```

`db:init` 仅接受空的独立云端 schema 或已安装相同定义的数据库；不会自动迁移或清空旧库。新建开发库后首次执行该命令，API/Worker/scheduler 启动时只读检查初始化标记。

企业登录接入及验收见 [企业 CAS 设计与实施记录](docs/designs/2026-10-12-enterprise-cas-login-design.md)。云端不再提供邮箱密码登录或管理员建号；运维可按企业 `subject` 禁用用户或显式设置角色。生产非本地地址必须 HTTPS，不能关闭 Secure Cookie。

当前是实施中的云端版本，**不是已验收的桌面全量替代品，也未部署上线**。企业扩展、目标环境隔离以及真实端到端验证的未完成项见进度文档。

Web 入口使用 `web/desktop/src/` 内独立迁入的桌面组件/CSS；云端接口适配也在此目录，不修改根目录 `frontend/`。仅启动 `npm run web` 可以访问登录页，但登录和任务执行还需要 API、数据库与 Worker 环境。
