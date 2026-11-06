# 软件架构专家包：语言无关核心与项目化 Java 适配设计

## Status

Approved design; implementation pending.

## Context

`fullstack-dev` 当前同时承载通用架构原则、Node.js/Express 示例、数据库默认选型、认证实现和实现流程，容易把 Node.js、PostgreSQL、UUID、JWT 等示例误读为强制规范。

本项目是 Java 8、Spring Boot 2.2.12、Spring Cloud Hoxton 的 Maven 多模块系统，包含 `api`、`api-center`、`back-center`、`gateway` 四类模块，并使用 MyBatis/MyBatis-Plus、多数据源、MySQL/Oracle/Hive、Redis/Redisson、ShardingSphere、Feign/Retrofit、事件总线、MQ、XXL-Job、Nacos 和 K8s。专家包需要能以该项目为真实参照，输出可落地的 Java 设计建议，同时不把项目现状冒充成所有项目的通用规范。

## Goals

1. 将 fullstack-dev 的核心规则改为语言、框架和 ORM 无关。
2. 新增以当前项目架构为依据的 Java/Spring/MyBatis 适配规范。
3. 保留 Node.js 等语言的独立适配，取消其默认地位。
4. 明确区分跨语言规则、项目事实、语言适配和示例。
5. 把 DB 设计从 PostgreSQL 默认导向改为基于访问模式、数据源边界和迁移能力的通用方法，并以当前项目提供参考案例。

## Non-goals

- 不修改当前业务代码、Maven 配置或部署配置。
- 不把当前项目的旧版本依赖升级为“推荐方案”。
- 不为所有 Java 项目制定统一包名或强制采用 DDD。
- 不在专家包中编造当前项目未被代码或配置证实的鉴权协议。

## Proposed structure

```text
skills/fullstack-dev/
  SKILL.md
  references/
    api-design.md
    db-schema.md
    auth-flow.md
    testing-strategy.md
    technology-selection.md
  language-adapters/
    java-spring.md
    nodejs.md
    python.md
    go.md
```

`SKILL.md` 负责触发条件、语言选择、证据优先级、设计/实施边界和通用交付检查。`references/` 只保留跨技术栈的决策规则。`language-adapters/` 负责将规则映射到具体生态；其中 Java 适配为本次重点。

## Java adapter design

### Module and dependency model

- `api`：跨模块契约、DTO、Feign API、公共枚举和公共异常；不放业务实现和数据库访问。
- `api-center`：面向用户端/业务 API 的实现，承载 `modules` 下的业务、领域、仓储、集成、缓存、事件和任务。
- `back-center`：管理后台与运营侧服务，沿用自身 `api`、`modules`、多数据源 Mapper、后台任务和配置边界。
- `gateway`：路由、前置鉴权、请求/响应处理、降级和流量治理；不承载业务规则。

依赖方向默认是契约向内、实现依赖契约、网关依赖基础设施与路由能力；如现有仓库存在例外，先记录事实与风险，不自动改造。

### Business and persistence layers

推荐表达为 `webapi/controller → service → domain/repository → mapper`，但只在领域复杂度足够时引入领域对象与仓储抽象。DTO、领域对象、数据库 Entity 分离，使用现有 `convert`/MapStruct 方式转换；Mapper 只负责持久化查询和映射，不承载业务决策。

按真实数据源边界组织 Mapper，例如 `mysqlMapper`、`wxMapper`、`bojunMapper`、`hiveMapper`。数据源选择、事务范围、跨库一致性和读写策略必须在设计中显式说明。

### Database and sharding

以 DDL、Mapper、配置类和已有迁移脚本为证据。关系模型优先，但表结构、主键、命名、软删除、审计字段、索引和外键不做无证据的强制统一。分表必须说明路由键、查询条件、范围查询行为、历史数据迁移、双写/回滚和验证方案；ShardingSphere 配置不能代替领域数据访问设计。

Redis/Redisson 只在明确缓存、锁、幂等、派生状态或协调职责时使用，并记录一致性、失效、重建、降级和锁超时策略。

### Integration and asynchronous work

Feign/Retrofit 等外部调用放在 API 或 `integration` 边界，不让业务域直接依赖传输细节。每个调用必须设计超时、重试边界、熔断/降级、幂等和可观测性。

事件总线、MQ、事务消息和 XXL-Job 分开描述投递时机、重复消费、失败补偿、任务并发、幂等和告警，不用“异步化”作为一致性方案的替代品。

### Auth and access control

Java 适配规范只定义职责分层：Gateway 前置认证、服务内身份传递、业务授权、数据权限和审计。Token 类型、Header 名称、用户上下文载体、签名方式等必须从目标仓库代码/配置确认；未确认时标为待核实，不默认 JWT、Spring Security 或 OAuth。

### Verification

验证建议按 Maven 模块和真实入口执行：编译/打包、单元测试、Controller/API 契约、Mapper 与 DDL 兼容性、多数据源事务边界、分表路由、缓存一致性、消息重复消费、任务重入和 Gateway 鉴权链路。未执行的检查不能标记为通过。

## Rule labeling

- `MUST`：跨语言且由架构目标支持的约束。
- `ADAPT`：需由目标语言/框架实现的映射。
- `PROJECT FACT`：当前仓库已由代码、配置或构建文件确认的事实。
- `EXAMPLE`：解释性示例，不构成默认选型。
- `LEGACY COMPAT`：为了兼容现状而保留，不建议新代码复制。

## Compatibility and migration

已有 Node 示例迁移到 Node.js 适配文件；已有 Python/Go 内容迁移或压缩到对应适配文件。通用文档删除默认 PostgreSQL、Express、`.env`、npm 命令和 JWT 实现等暗示。Java 适配写明当前项目的 Java 8/Spring Boot 2.2/Hoxton 等版本只代表兼容基线，不代表新项目推荐版本。

## Acceptance criteria

- `SKILL.md` 不再把 Node.js/Express 作为默认后端栈。
- API、DB、Auth、测试和技术选型参考文件不依赖单一语言实现才能理解。
- 存在完整的 `java-spring.md`，覆盖当前四模块、分层、Mapper/数据源、Redis/分表、集成、异步、鉴权和验证。
- Java 文档中每条项目事实都能回指当前项目的 POM、目录、配置或代码类别。
- Node/Python/Go 适配仍可独立使用，不覆盖 Java 规则。
- 无真实业务代码、依赖或部署文件被修改。

