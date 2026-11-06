# SkillHub 客户端动态 Token

> 2026-11-03 更新：凭据保存与部署配置以 [通用部署配置与凭据存储清理](./2026-11-03-neutral-config-and-secret-storage-design.md) 为准。安装包不再携带 SkillHub 密钥；桌面 MCP 配置整体加密保存，旧明文文件拒绝加载。

## 背景与现状

技能市场通过本地 API/IPC 调用 SkillHub，namespace 列表和内置 clawhub CLI 使用源码中的固定 API Token。用户要求进入左侧技能市场与连接器菜单时检查登录态，有效期内复用首次创建的 Token，过期重新登录或创建。

## 目标与非目标

依照 Downloads/25-email-access-token-login-api-token-publish-guide.md 的加密、Cookie、CSRF 和 Token 协议，实现用户级动态凭据。用户已明确授权共享密钥存客户端，由 Electron 主进程签发，不增加远端签发服务。不修改发布流程或安装版本选择。

## 方案

- 主进程从 SKILLHUB_AUTH_ACCESS_TOKEN_SECRET 环境变量或系统钥匙串 skillhub-access-token-secret 条目读取严格 Base64 编码的 32 字节密钥；缺失明确报错。使用当前业务登录用户的真实邮箱，不推导邮箱。
- AES-256-GCM，随机 12 字节 IV，16 字节 tag，AAD skillhub-access-token:v1；payload 仅 appId/email/可选 nickName/headimgurl/iat/exp/jti，exp-iat=300。
- POST /api/v1/auth/access-token/login 换取 SESSION、XSRF-TOKEN；POST /api/v1/tokens 附 Cookie 和 X-XSRF-TOKEN，申请 skill:read，expiresAt=null（文档支持永久 Token，不能把一次性凭据的 300 秒当成 Session 有效期）。
- 每次菜单点击通过 POST /api/skillhub/auth/ensure 检查远端 /api/v1/auth/me 和 /api/v1/whoami。有效时复用 Token；Session 失效重新登录并创建，Token 失效而 Session 有效时直接创建。同名轮换，按设备命名避免其他设备被撤销。
- 加密存储完整 Token、Cookie、邮箱和服务地址；主进程使用 Electron safeStorage，macOS/Windows 使用同一接口。系统安全存储不可用时明确阻断。前端只接收认证状态，不接收凭据。
- 同时点击/加载/安装合并获取；退出清除缓存并使在途请求失效；下载和 namespace 请求通过统一认证服务复用 Token。移除固定 Token 和生产环境 Token fallback。
- CLI 工作配置按安装独立创建并在结束时删除，不长期留下明文 Token。

## 影响范围与风险

src/domains/skillhub/node、application.electron.ts、IPC handler/preload/frontend route、Sidebar/useSkillStore/ExpertPanel。服务端需开启 access_token 登录并与客户端配置相同密钥；业务用户须提供真实邮箱。网络错误不视为凭据过期，不因此重复创建 Token。共享密钥存客户端是用户明确指定的信任边界。

## 验证

补充协议解密校验、首次登录、复用、Session/Token 失效、并发、退出竞态、错误脱敏、加密缓存和 CLI 临时配置清理测试。用户已授权本次自动测试；执行相关测试及后端/前端 TypeScript 检查、preload 语法检查和 git diff --check。Windows 使用 platformPaths/safeStorage；当前环境为 macOS，Windows 构建和实机验证单独报告实际结果。
