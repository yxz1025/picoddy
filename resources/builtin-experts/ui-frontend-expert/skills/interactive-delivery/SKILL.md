---
name: interactive-delivery
description: Verify actual frontend changes, register repository-based preview deliveries and report evidence, simulation scope and outstanding review items without auto-launching design previews.
---

# 验证与交付

仅在本轮确实实现或修改代码后登记代码交付。普通咨询、纯评审、连接检查不创建占位文件。

## 验证

根据修改选择现有类型检查、构建、测试及实际 UI 验证。布局修改重点检查目标视口、溢出和弹层；业务行为修改验证关键成功路径及相关失败分支。记录运行命令、结果、环境和限制，不凭代码阅读断言运行通过。

设计阶段默认不自动启动预览窗口。已有可用运行环境且用户授权验证时按权限使用；若 UI 检查依赖尚未启动的预览，先完成可执行的静态验证并登记“待预览验证”，由用户点击预览后继续检查。

## 当前宿主的交付路径

1. `requirement_preview list` 查看本轮允许的仓库和目标，复用正确目标。
2. 必要时 `configure`：从真实仓库确定 repositoryId、kind、projectPath、入口、build/start 命令和场景。Web 与微信目标分开配置；参数遵循本轮 schema，不补造 appid、端口或 CLI 路径。
3. Figma 绑定目标通过 `designTools`、`readDesign` 在当前轮与当前目标版本下真实读取后再实现。如果重新配置导致目标版本变化，重新读取。
4. 场景模块遵守宿主接口：`.cjs` 导出 setup，可选 ready／cleanup；Web 接收 page、context、baseURL；微信接收 miniProgram。Mock 限定在场景生命周期中，并清理注入状态。不要编写访问生产数据的模拟场景。
5. `deliver` 的 targetId 必须真实存在；files 是相对该仓库的实际代码文件，summary 说明实现，pending 说明待验证内容。宿主验证成功才说“已登记交付”。文档不能冒充代码交付。
6. 告知用户点击交付卡片或交互预览面板启动，选择场景进行评审。不自动发布、合并、提交 TAPD 或把预览状态标为测试通过。

宿主没有交付工具时提供真实修改路径、仓库分支、现有运行方法和验证结果，明确没有自动登记预览卡片。只有用户要求可下载报告时才保存报告并通过可用文件交付工具提供。

## 按需评审报告

使用 `references/review-template.md`。报告路径遵循用户指定或仓库已有约定，不向仓库根目录散落多余文档。证据截图不包含令牌、真实隐私或无关窗口。
