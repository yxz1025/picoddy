# 架构通 - 软件架构师

## 1.5.1：参考入口与适配规则统一

补齐环境管理、发布检查的参考入口，统一历史说明中的产物目录规则。Node.js、Go、Python 适配补充运行边界、持久化、异步任务和验证要点；Django 适配改为按仓库证据选择，移除固定技术组合、绝对化分层与破坏性迁移示例。

## 1.5.0：产物自动校验

新增不依赖技能调用的 Python 3.9+ 只读校验脚本。在设计交付、修订及任务开发前，检查文档身份与命名、登记文件引用、验收编号覆盖、任务重复/缺失/循环依赖、引用版本与可选内容快照。

支持多仓库与现有目录映射；历史文档缺少结构化数据时标记未验证。输出 JSON 和明确退出码，结构通过不代表正文语义、人工审批或业务测试通过。使用方法见 [研发产物自动校验](agents/references/artifact-validation.md)，脚本位于 [scripts/validate_artifacts.py](scripts/validate_artifacts.py)。

随包回归测试：`python3 -m unittest discover -s tests -v`。此更新仅修改源包，客户端需要重新加载相应版本。

## 1.4.0：公司规范与项目约束一致性

公司 Java 项目采用以 JIC 为参考实现的公司工程规范，目标仓库已确认补充或例外优先；参考项目的具体名称、版本和可选中间件需逐仓库核实。外部项目不自动采用公司约束。

按仓库或模块选择技术参考，支持同一需求的 Java、前端等多栈组合；package.json 不直接代表 Node.js 后端。规范入口通过仓库规则、docs 索引与候选文件发现，初始化按授权登记相对链接及状态。

研发产物优先遵循已确认目录映射，例如 docs/designs 和 docs/plans；docs/requirements 仅为无约定时的默认目录。详见 [项目规范发现与路径解析](agents/references/repository-context-routing.md)。

先澄清产品需求，再依据真实代码和各仓库规范形成架构与详细设计；保留通用系统设计、技术决策和演进规划能力。

## 1.2.0：任务人工评估与授权开发

## 1.3.0：独立仓库规范初始化技能

新增 `repository-bootstrap` 独立技能，可用于任意代码仓库：自动扫描项目规则、配置、代码结构、模块、依赖、运行/构建/测试入口，并识别现有 docs 分类。若仓库已有 `docs/architecture/`、`docs/designs/`、`docs/plans/`，优先复用并在规范中登记映射；只有没有既有约定时才使用 `docs/development/` 作为默认目录。

技能默认先生成带证据的草案，负责人确认后才写入或标记生效。后续架构设计会优先读取这些文档；代码基准变化或规范状态为草案时，需重新核实。初始化不重构代码、不补齐所有历史功能、不把代码现状自动升级为团队规范。

技能可单独使用，也可由本专家在需求设计前调用。它不依赖其他专家或特定框架，不使用个人绝对路径；详见 [仓库规范初始化技能](skills/repository-bootstrap/SKILL.md)。

设计输出的 tasks 是待人工评估草案，不是执行指令。流程为：生成草案 → 人工评估 → 按意见调整（必要时同步 spec/design）→ 人工确认版本 → 明确授权开发 → 按任务实施、验证和提测交付。

评审状态与执行状态分别维护，授权另行记录。工作量、人员和排期不由专家编造；受影响的任务发生重要变化后重新评估。用户说“继续完善”不等于开始业务开发。

专家可以编写代码和测试，但必须先核实任务基线、现有实现、本地改动及依赖。未执行必要验证不能标记任务完成；提交、推送、PR 和发布需对应授权。详见 [任务评估与执行流程](agents/references/task-review-and-execution.md)。

## 1.1.0：基于需求与代码证据的研发设计

给专家提供 PRD 及版本、对应原型/评审结论、需求编号和仓库位置。可关联用户端、管理后台和服务端等多个仓库，确认其修改/依赖/参考类型及牵头仓库。

执行流程：读取资料与仓库规范 → 审查需求和代码 → 提出有证据的问题 → 产品/研发答复并回写复核 → 确认设计输入 → 分仓库设计和任务拆解 → 自检与人工评审。

关键规则：

- 需求不清晰、不合理或冲突时先澄清，不批量生成正式方案，不将 AI 假设当作产品决定。
- 各仓库需要有可定位的 `design-guidelines.md`；已有 `docs/architecture/`、`docs/designs/`、`docs/plans/` 等分类时优先复用并登记映射，没有约定时才使用 `docs/development/`；历史项目只做必要基线梳理。
- 严格引用真实代码证据、产品版本和代码基准；未核实与拟新增对象明确标记。
- 文档优先写入各修改仓库已确认的目录映射，例如 `docs/designs/`、`docs/plans/`；无既有约定时才使用 `docs/requirements/<需求编号>/`。文件使用 `<需求编号>-<repo-id>-impact/spec/design/tasks/review.md`（每种类型为单独文件）。
- 牵头仓库维护 `<需求编号>-questions.md` 和 `<需求编号>-coordination.md`，共享契约引用权威版本。
- 阻塞问题未闭环不能宣称可开发；AI 自检不等于人工审批。
- 设计请求不自动进入代码开发、依赖安装、提交、推送或外部系统写入。

随包说明与模板：

- [研发设计流程](agents/references/engineering-design-workflow.md)
- [产物与归档规范](agents/references/engineering-artifacts.md)
- [仓库设计要求模板](agents/references/repository-guidelines-template.md)

这些是专家自身的说明文件，不依赖作者电脑路径或新增技能调用。原有 `fullstack-dev` 保留为可选参考，设计模式不执行其开发流程；用户禁用技能时不调用。

当前更新的是专家源包，不会自动安装或热更新客户端。加载新版本后应使用真实 PRD 和仓库验证行为。结构检查不能证明实际业务生成效果。

## 功能特性

- 面向大型系统的整体架构设计与长期演进规划
- 设计可扩展、高可用的系统架构
- 制定架构演进和重构路线图
- 评审架构方案并输出设计文档

## 技术栈适配

专家先扫描目标仓库的构建文件、代码包和运行配置，再选择语言适配层。`fullstack-dev` 的核心规则与 API、DB、Auth、测试、技术选型参考均为语言无关；Java 项目优先使用 `skills/fullstack-dev/language-adapters/java-spring.md`。

Java 适配以 `jic-usercenter-market` 的真实架构为参照，覆盖 Maven 多模块、Gateway/API/API-Center/Back-Center、MyBatis/MyBatis-Plus、多数据源、Redis/Redisson、ShardingSphere、Feign/Retrofit、事件/MQ/XXL-Job 和 Nacos/K8s。项目事实不会被当作所有 Java 项目的强制规范。

## 致谢

本专家封装并引用了以下开源技能：

- 本专家的 agent prompt 改编自 [agency-agents](https://github.com/msitarzewski/agency-agents)（MIT License），在此致谢。
- `fullstack-dev` 技能：遵循 MIT License。

各许可证全文见 `license/` 目录。本专家在原始内容基础上进行了适配与修改。
