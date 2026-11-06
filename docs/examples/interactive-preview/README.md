# 交互预览配置与场景

在桌面端打开需求 → 交互预览 → 添加目标。配置一次后，设计师只需选择场景、启动、体验和保存评审记录。

## 工作区与设计

保存配置后直接绑定关联仓库当前目录与分支，保留未提交修改，后续研发继续沿用。目标进入本阶段专家上下文（需勾选对应仓库）。选择已授权的 Figma MCP，点击“在会话中读取设计并实现”，检查输入框中的请求并发送。专家实际读取设计、编写代码并登记交付后，会话显示交付卡片。点击卡片“启动预览”，无需复制终端命令。

依赖由仓库原有方式准备。应用不自动改变 lockfile、不安装 SDK、不提交代码。Figma 链接是可选的节点定位，读取走已绑定 MCP 并保存读取凭据。人工填写的设计版本不是自动获取的 Figma revision。

## Vite H5 示例

- 命令工作目录：`.`（monorepo 可填 `frontend`）
- 开发服务文件：`npm`（也可以使用仓库原有 pnpm/yarn）
- 参数：`["run","dev","--","--host","127.0.0.1","--port","5174","--strictPort"]`
- 地址：`http://127.0.0.1:5174`
- 入口：`/orders`
- 视口：390 × 844
- 依赖：工作目录能解析 `playwright` 或 `@playwright/test`，并按仓库要求安装 Chromium。

将 `web-empty.cjs` 按真实 API 格式调整后放到**关联仓库** `preview/web-empty.cjs`；配置场景：

```json
[{"id":"empty","name":"暂无订单","entryPath":"/orders","module":"preview/web-empty.cjs"}]
```

`setup({page,context,baseURL})` 在导航前运行，用 Playwright 原生 route 注册数据。可选 `ready` 在导航完成后执行演示操作。清理资源用 `cleanup`。失败会停止预览，不自动切换为实际数据。

## 微信小程序示例

- 原生仓库可不配置构建命令；跨端仓库使用已有构建命令，例如仓库实际存在的 `npm run build:weapp`。
- 命令工作目录与小程序输出目录分开配置。例如根目录执行构建，输出目录为 `dist/dev/mp-weixin`。
- 输出目录必须包含 `project.config.json`；其中 appid/projectname/miniprogramRoot 沿用原配置。
- macOS：`/Applications/wechatwebdevtools.app/Contents/MacOS/cli`，Windows：安装目录下 `cli.bat`。可以点“检测本机微信工具”。
- 需安装开发者工具、登录、具备项目权限、开启 CLI/HTTP 服务，工作区内可解析 `miniprogram-automator`。
- 场景 `setup({miniProgram})` 使用官方 SDK，之后执行入口 reLaunch，再调用可选 `ready`。
- `wechat-location.cjs` 展示选址返回结果的模拟；它不代表真实定位权限或真机集成测试已通过。

微信预览通过 Automator 启动官方工具窗口。本轮没有把纯模拟器模式与 Automator 组合，也没有二维码上传按钮；无需为预览配置上传密钥。截图与 Mock 的具体可用范围取决于微信工具/基础库版本。

## 停止、记录与交付

切换场景会先停止原运行。Web 每次创建新浏览器上下文；小程序场景必须主动准备与恢复持久化存储，重启不等于自动清空 storage。

“保存截图与评审记录”生成两项待确认资产，包含目标配置、场景、需求资产 hash、启动/截图时的 Git 状态。到资产页按现有流程提交。dirty=true 时，记录无法仅凭 commit 复现；代码提交与合并仍走仓库正常流程。

没有开发服务命令时，Web 使用用户已启动的本地服务，界面会标注代码版本未核验。端口不通不会自动替换 URL 或启动猜测的命令。

## 平台注意事项

Windows 自动按 `.cmd/.bat` 调用包管理器与工具，含空格/中文的路径按整体参数传递。批处理参数包含双引号、百分号或换行会被拒绝，复杂步骤应放在仓库脚本内。停止只清理本次运行的进程树，不按名字关闭其他程序。

普通浏览器不能通过 HTTP 调用这些本地执行功能，请在桌面端使用。目标移除保留仓库文件与记录。卡片可查看差异、保存评审截图；启动失败可将修复请求填入会话，由用户发送。交付和截图均为待确认资产，预览不会自动推进阶段。
