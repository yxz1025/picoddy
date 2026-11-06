# GitLab / Jenkins 内置 MCP

用户已确认并要求实现：连接器卡片点击加号下载依赖，安装成功自动弹窗输入环境参数，保存后启用。取消保留依赖，下次无需重复下载；失败可重试。

## 实现

- GitLab：`@masuratech/gitlab-mcp-server@1.0.0`，参数 `GITLAB_API_URL`、`GITLAB_PERSONAL_ACCESS_TOKEN`。
- Jenkins：`@kud/mcp-jenkins@2.3.0`，参数 `MCP_JENKINS_URL`、`MCP_JENKINS_USER`、`MCP_JENKINS_API_TOKEN`。
- 应用受管 Node/npm 将包安装到 appDataDir/mcp-packages/<id>/<version>。固定核验版本、跳过生命周期脚本，启动已安装的 dist/index.js；不在每次连接时执行 npx 下载。
- 安装任务按连接器去重；只有 npm 成功并验证入口和包版本后才写完成标记。单独安装不创建可执行配置。
- 参数经白名单和 HTTP(S) 地址校验后由现有 mcpConfigStore 原子保存，以 managedBy=builtin 管理。Token 使用密码框，不经状态/可选连接器接口返回，编辑时留空保留原 Token。
- 同名手动配置要求先重命名，不覆盖既有配置。保存后沿用现有逻辑断开旧 MCP 连接，后续在会话中选择时按需连接。
- IPC 检查主窗口/主 frame 来源；HTTP 路由拒绝非受信 IPC 请求。运行时重新解析当前 Electron/Node 路径，避免应用升级后使用旧可执行文件。

## 验证记录

- 定向回归 30 项通过（内置安装/配置、TAPD、受管 CLI、选择器、OAuth、前端 IPC 路由）。
- 前端 TypeScript 和 Vite 构建通过；preload 语法检查、改动 diff 检查通过。
- 临时目录真实下载两包并验证版本。MCP 握手/listTools 成功：GitLab 25 个工具，Jenkins 38 个工具；已额外使用应用自带 Electron 的 Node 模式完成同样握手；未调用真实业务接口。
- 临时 Playwright 验证：安装后弹窗、取消再打开不重复安装、Token 密码框、保存、编辑不回显 Token、Jenkins 安装失败后重试。实际主题下检查弹窗截图；临时前端测试入口已移除。
- 扩展运行旧 mcp_config.test.ts 时有两项原有失败：测试仍向 tapdConfig 传第二个 Token 参数并断言 TAPD_ACCESS_TOKEN；当前 HEAD 的 tapdConfig 已改为 OAuth 单参数配置，与本次改动无关，未修改这些文件。
- 尚未使用真实 GitLab/Jenkins 账号进行业务鉴权联调，未在 Windows 实机测试。
