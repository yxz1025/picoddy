# 技能市场切换到公开 ClawHub

技能页使用公开 https://clawhub.ai API，与内部 PICODDY SkillHub 专家市场分离。专家目录、专家安装、专家随包技能和内部登录逻辑保留；技能页不调用内部凭据读取或自动登录。

新增 GET /api/clawhub/skills?q=&cursor= 和 POST /api/clawhub/install，覆盖 HTTP 与 Electron IPC / preload。列表按 updated 获取 48 条并使用 nextCursor 加载更多；输入框 300ms 防抖调用公开搜索，使用请求序号避免旧结果覆盖新结果。搜索仅展示原生 ClawHub 条目。沿用安全摘要 DTO，registrySource 标注 clawhub，安装缓存键加来源前缀。

安装调用已随包发布的官方 clawhub CLI，指定公开 registry、owner 和精确版本。独立配置目录不读取内部 Token，关闭安装遥测；不传 force 或绕过平台检查。下载暂存在用户技能根下，读取 SKILL.md 验证后再原子移入正式目录；拒绝覆盖同名技能，失败清理本次暂存。保留专家包中的技能。

接口依据：官方 https://docs.openclaw.ai/clawhub/http-api 与项目 node_modules/clawhub/dist 的 API schema / 官方 CLI 实现，尤其是 owner 安装目录 @owner/slug 和版本参数。没有启动客户端、开发服务器或执行自动化测试，没有真实请求技能目录或安装第三方技能。

静态验证：前端生产构建通过；主进程类型检查仍为 context_budget.ts 中原有三处 unknown 错误，无本次新增错误。运行时列表、限流和下载解压行为待用户后续允许时人工验证。
