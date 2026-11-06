# SkillHub 专家市场实施计划

**目标：** 专家页默认展示 SkillHub 专家市场，目录筛选与技能市场共用数据模型；市场专家在“召唤”时下载、注册到 `my-experts`，成功后沿用本地专家的工作台跳转流程。

## 1. 统一 SkillHub 配置与目录接口

- 新增单一 SkillHub 配置，集中保存服务地址及应用内置 token。
- 将目录客户端泛化为 `SKILL` / `EXPERT` 两类，保持 `newest` 排序、分页和 namespace 元数据不变。
- 增加本地 `/api/skillhub/experts` 路由及 Electron IPC 映射。
- 以客户端测试锁定请求参数、鉴权头和响应归一化。

## 2. 实现专家下载与安全注册

- 使用内置 SkillHub CLI 将指定 namespace/slug/version 下载到 `my-experts` 同文件系统的临时目录。
- 校验专家包清单、主 Agent 和目录结构；为兼容 SkillHub 包补齐本地扫描器要求的 schemaVersion。
- 原子移动到 `my-experts/plugins/<slug>`，原子更新 marketplace.json，并刷新已安装专家注册表。
- 任一步失败时恢复 marketplace、撤销已移动目录并清理临时目录。
- 暴露 `/api/skillhub/experts/install` 与对应 IPC；返回可直接启动的已安装专家摘要。

## 3. 专家市场界面与召唤流程

- 专家 Tab 默认显示市场；右上角提供搜索、“我的专家”和“添加专家”。
- 专家/技能市场共用 namespace 分类、查询和加载/错误状态逻辑。
- 市场专家采用现有“我的专家”卡片布局，头像显示 displayName 首字并按稳定哈希使用不同配色。
- 点击“召唤专家”后显示全页半透明加载层“正在召唤专家…”，下载完成后调用现有 `startExpertChat` 跳转任务工作台。
- “我的专家”视图和已有直接召唤、管理菜单行为保持不变。

## 4. 验证

- 运行 SkillHub 客户端、安装器、前端模型与 API 路由测试。
- 运行前端生产构建和差异检查。
- 重启 Electron 前端，实际检查专家市场、中文 namespace、切换我的专家及召唤加载态。
