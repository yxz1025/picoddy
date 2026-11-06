# 需求资产清单与按需读取

用户已确认：按照 Codex 的上下文管理思路改造，移除关键词优先摘录。不运行测试，不调用技能。

## 背景与目标

旧实现每轮注入资产正文，后续尝试用关键词分配片段预算。该启发式并非 Codex 实现，可能漏掉约束，也持续扩大输入。此次改为只注入资产入口，正文由 Agent 按任务读取。

## 方案与影响范围

- assets.context 校验固定版本文件 hash，按 id/hash 去重，只返回 id、name、stage、hash、完整 path、workingPath、bytes、format。文件仍完整保存；校验仍读取文件字节，不等于把字节发送给模型。
- inputs.freeze 只持久化资产清单，不再复制正文或章节索引。删除 asset_excerpt.ts 和自动关键词筛选。
- context.ts 用独立 requirement_assets JSON 块传递完整选择清单，包括空选择。显式列出允许的元数据字段，不把任意额外资产字段注入模型。需求及验收信息仍在 requirement 内。
- 复用现有 Pi read(offset/limit)、bash 检索及原生输出预算。提示模型先有界检索，再按行补读上下文；命中片段不是完整规则。二进制文件使用对应格式工具。
- requirement_asset_context.ts 在 context_with_system 中扫描本次有效历史，以需求/工作区/阶段及完整资产元数据计算指纹；重复且引用更短时保留 id/hash/完整 path 和 earlier_in_active_context。版本切换标记 previousHash。首次元数据完整保留，每轮选择列表仍存在。
- 不修改持久化消息，不维护永久 seen 标记。压缩、分支、回滚后重新扫描当前历史，缺少此前完整记录时保留本轮完整元数据。只对资产清单去重，不宣称通用工具结果语义去重。

## 参考与非目标

Codex 参考版本：openai/codex 970111f6cb62cc02fe36a82ea7d71b37a2889c97。参考 context/world_state 的状态比较、context_manager 的历史管理和 output-truncation 的预算控制；资产协议是本项目适配，未照搬其内部实现。没有关键词排序、向量检索、新的摘要模型调用或自建压缩引擎。

本地 @earendil-works/pi-coding-agent 1.0.4：read 默认上限 2000 行/50 KiB，先到者生效，支持 offset/limit 并提示继续位置；bash 超量输出保留尾部并提供完整输出文件入口。自动压缩通过上下文窗口减 reserveTokens 判断，默认 reserveTokens=16384、keepRecentTokens=20000，可被配置和模型覆盖。Pi 管理工具结果与历史，不管理本产品的资产选择、版本和授权。

## 风险及验证

按需读取依赖模型选择正确范围；提示要求实现前核对规则与验收，不能保证模型自动找全所有约束。历史中已经持久化的旧正文不会被此次修改清除。没有量化性能结论。

跨平台沿用 Node 路径和 Pi 工具，不新增平台专用实现。维护原有测试源码，使断言从固定版本 path 读取内容，但按用户要求不执行。仅执行 TypeScript 和 diff 静态检查；运行表现及 Windows 构建待授权验证。

静态检查结果：`tsc -p tsconfig.electron.json --noEmit` 通过；`git diff --check` 通过（仅现有行尾转换提示）。未运行测试、构建、打包或重启。
