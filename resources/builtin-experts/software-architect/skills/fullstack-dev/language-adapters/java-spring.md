---
name: fullstack-dev-java-spring
description: Company Java engineering conventions for repositories confirmed to follow the company Spring/MyBatis architecture, using JIC as the reference implementation. Verify target-specific versions, modules and optional infrastructure.
license: MIT
metadata:
  category: language-adapter
  version: "1.0.0"
---

# 公司 Java 工程规范 — JIC 参考实现

用户已确认公司 Java 项目采用以 `jic-usercenter-market` 为参考实现的规范。公司范围内采用以下模块职责、契约分离、分层及 Mapper 边界要求；目标仓库已确认的补充与例外优先。冲突需说明依据并由研发确认，不因历史代码偶然不同就自动改变公司规则。

区分四类信息：公司约束、参考项目事实、按需能力、目标仓库例外。表中的具体项目名是参考名称，必须映射到目标实际模块；不复制项目名前缀、不强制补建不在需求范围内的模块。Redis、分表、异步、特定数据源和工具仅在目标代码或明确需求启用时应用。参考版本需核实，不能当作所有公司仓库的现状。外部 Java 项目须先确认适用性，不自动套用公司约束。

## 公司约束：模块职责（下表名称来自参考项目）

| Module | Responsibility |
|---|---|
| `jic-usercenter-market-api` | Shared DTOs, Feign contracts, enums, common exceptions and API dependencies |
| `jic-usercenter-market-api-center` | User/business API implementation and `modules` domain, service, repository, mapper, integration, cache, event and job packages |
| `jic-usercenter-market-back-center` | Admin/operations implementation with web APIs, services, jobs and data-source-specific mappers |
| `jic-usercenter-market-gateway` | Spring Cloud Gateway routing, filters, request/response handling, discovery/config and fallback |

Keep contracts separate from implementations. The gateway must not become a business service. When an existing dependency direction differs, record it as a repository fact and risk before proposing a change.

## 公司约束：Package and layer mapping

Use `webapi`/controller for transport, `service` for application orchestration, `modules/domain` for complex invariants, `repository` for persistence ports, and `mapper` for SQL/ORM access. Use domain/repository abstractions only when they isolate meaningful business rules or infrastructure; simple CRUD may remain service-plus-mapper.

Keep request/response DTOs, domain objects, and persistence Entity/Model separate. Reuse the repository’s `convert` and MapStruct patterns. A Mapper performs persistence mapping/querying; it must not decide business policy.

## PROJECT FACT: persistence boundaries

公司使用 MyBatis/MyBatis-Plus 的项目遵循 Mapper 数据源与业务职责分离。参考项目包含 DDL、MyBatis 配置和生成模板，以及 `mysqlMapper`、`wxMapper`、`bojunMapper`、`hiveMapper` 等家族；这些具体名称和数据源须在目标仓库核实。新增查询前确认实际数据源、namespace、资源位置、事务边界及数据库方言。

Do not assume JPA, Hibernate, Flyway, Liquibase, PostgreSQL syntax, or a single database. Prefer existing DDL/migration and mapper conventions unless the design explicitly includes a migration.

## PROJECT FACT: databases and sharding

参考项目包含 MySQL/Oracle/Hive、ShardingSphere、union-id 映射及双写配置，不代表目标仓库全部具备。仅在目标存在或已确认需要分表时，设计需说明：

- stable route key and how every read obtains it;
- allowed equality/range queries and behavior when the key is absent;
- transaction boundary when data sources or shards differ;
- hot-key and fan-out risks;
- DDL rollout, historical backfill, dual-write/cutover, rollback and verification.

ShardingSphere configuration is an implementation aid, not a replacement for access-pattern and migration design.

## Redis and distributed coordination

参考项目使用 Spring Data Redis/Jedis 和 Redisson 类工具。仅在目标仓库使用或已确认引入时，说明 key/lock 的 owner、格式、TTL、失效与重建、一致性、超时及验证；不为符合模板引入 Redis。

## Integration and asynchronous work

参考项目使用 OpenFeign、Retrofit/OkHttp 类集成；目标客户端以实际依赖和代码为准。适用调用需明确边界、超时、重试预算、幂等和身份传播，不强制引入参考项目全部库。

For events, MQ, transaction queue and XXL-Job, document delivery point, transaction interaction, duplicate handling, retry/dead-letter or compensation, concurrency, re-entry, progress and alerting. “Async” alone is not a consistency strategy.

## Gateway, configuration and deployment

**PROJECT FACT:** the gateway uses Spring Cloud Gateway, Nacos discovery/config, filters, fallback, Redis and Sleuth; modules use `bootstrap*.yml`, Maven packaging and K8s deployment descriptors. Derive profile names, ports, health endpoints, packaging and smoke commands from the target repository.

**LEGACY COMPAT:** Java 8, Spring Boot 2.2.12, Spring Cloud Hoxton, Hystrix, Swagger 2, Druid, older Jedis/Retrofit versions and internal starters are current compatibility facts. Do not upgrade or copy them into new work without an explicit compatibility and rollout decision.

## Authentication and permission routing

Inspect gateway filters, headers, token utilities, context propagation, service interceptors, permission queries and audit code. Keep these responsibilities separate:

`gateway authentication → service identity propagation → business authorization → data permission → audit`

Do not infer JWT, OAuth, Spring Security, a header name, or a user-context class without repository evidence. Background jobs and message consumers require an explicit actor/audit policy.

## Java verification checklist

以下仅对目标仓库和本次改动适用项执行；缺失能力不构成必须新增的任务。

- [ ] Derive actual Maven/Gradle wrapper and affected-module build/test commands from the target repository, including supported platforms.
- [ ] Run unit tests and focused integration tests with compatible database/cache/message infrastructure.
- [ ] Verify DTO/API contract and error envelope compatibility.
- [ ] Verify Mapper SQL against DDL, data source, index and transaction behavior.
- [ ] Test shard route-key, migration/backfill and dual-write rollback paths when applicable.
- [ ] Test cache invalidation, lock expiry/contention and duplicate message/job handling.
- [ ] Test Gateway route/filter/auth chain, configuration profile and deployment health.
- [ ] Report every command not executed; never claim green from static inspection alone.
