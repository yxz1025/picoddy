---
name: test-case-design
description: Use when turning confirmed product, design and implementation assets into traceable test cases, coverage matrices and issue lists.
description_zh: "基于需求和研发资产设计可追溯测试用例"
license: MIT
metadata:
  category: testing
  version: "1.2.0"
---

# 测试用例设计

先读取需求、验收标准、产品资产和研发交付，区分已确认事实、待确认问题与未核实实现。按 REQ/AC 建立覆盖关系，使用等价类、边界值、决策表、状态迁移和风险分析补齐主流程、异常、权限、数据一致性及回归场景。

每条用例必须有可执行前置条件、步骤和可判定预期，并保留来源资产 ID、hash、版本和实现状态到覆盖矩阵。关键业务预期未确认时交付问题清单和覆盖草案，不伪造正式用例或测试结果。

生成、修改和交付是对话任务；交付完成后不等待人工审批。只有用户明确要求发布时，宿主才执行 TAPD 附件上传。

为 TC-ID 维护验收映射。先生成用例入口在交付后询问是否执行；直接启动测试的请求已授权本轮执行，无需重复确认。用户说只要用例或先不测试时停止，不重复追问。确认启动后继续读取 [自动化测试执行技能](../automation-test-execution/SKILL.md)，复用配置并补齐缺项，生成脚本、直接执行并分析报告；Excel 校验不能代替实际测试。

用例按单端或跨端业务场景组织，不能以仓库数量决定端数。跨端保留 SC-ID→TC-ID→AC-ID 和步骤依赖、各端角色、真实业务 ID 输入输出、前置数据及清理策略到覆盖矩阵；不改变 Excel 的固定 11 列。数据未就绪允许设计用例，但不能报告已执行。参见 [业务场景编排](../automation-test-execution/references/business-scenarios.md)。
