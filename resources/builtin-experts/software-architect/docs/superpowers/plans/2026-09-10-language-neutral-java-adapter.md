# Language-Neutral Core and Project-Grounded Java Adapter Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task, or use superpowers:subagent-driven-development when independent document tasks can be isolated.

**Goal:** Refactor the software-architect expert package so its full-stack guidance is language-neutral and its primary concrete backend adaptation is grounded in the current Java/Spring/MyBatis project.

**Architecture:** Keep cross-language rules in `fullstack-dev/SKILL.md` and `references/`; move implementation-specific guidance into `language-adapters/`. The Java adapter will describe the current four-module Maven architecture, persistence/data-source boundaries, distributed infrastructure, access-control layers, and repository-derived verification practices without turning legacy project facts into universal recommendations.

**Tech Stack:** Markdown skill packages, Java 8, Spring Boot 2.2.12, Spring Cloud Hoxton, Maven multi-module, MyBatis/MyBatis-Plus, MySQL/Oracle/Hive, Redis/Redisson, ShardingSphere, Feign/Retrofit, MQ/events/XXL-Job, Nacos, Kubernetes.

---

## File map

- Modify: `/Users/xiaozhongyuan/Documents/experts/software-architect/skills/fullstack-dev/SKILL.md` — remove Node-first triggers/workflow and route to language adapters.
- Modify: `/Users/xiaozhongyuan/Documents/experts/software-architect/skills/fullstack-dev/references/api-design.md` — retain protocol-level rules; remove framework-default assumptions and move implementation examples.
- Modify: `/Users/xiaozhongyuan/Documents/experts/software-architect/skills/fullstack-dev/references/db-schema.md` — make DB guidance engine/ORM-neutral and add evidence-based multi-data-source/sharding decisions.
- Modify: `/Users/xiaozhongyuan/Documents/experts/software-architect/skills/fullstack-dev/references/auth-flow.md` — make authentication/authorization protocol-neutral and separate gateway, service, business, and data permissions.
- Modify: `/Users/xiaozhongyuan/Documents/experts/software-architect/skills/fullstack-dev/references/testing-strategy.md` — make test guidance language-neutral and add Maven/Mapper/DDL/message/job verification mapping.
- Modify: `/Users/xiaozhongyuan/Documents/experts/software-architect/skills/fullstack-dev/references/technology-selection.md` — remove PostgreSQL/Node defaults; make repository evidence and trade-offs first.
- Create: `/Users/xiaozhongyuan/Documents/experts/software-architect/skills/fullstack-dev/language-adapters/java-spring.md` — complete project-grounded Java adapter.
- Create: `/Users/xiaozhongyuan/Documents/experts/software-architect/skills/fullstack-dev/language-adapters/nodejs.md` — preserve Node-specific implementation guidance without default status.
- Create: `/Users/xiaozhongyuan/Documents/experts/software-architect/skills/fullstack-dev/language-adapters/python.md` — isolate existing Python implementation examples.
- Create: `/Users/xiaozhongyuan/Documents/experts/software-architect/skills/fullstack-dev/language-adapters/go.md` — isolate Go implementation examples and adapter decisions.
- Modify: `/Users/xiaozhongyuan/Documents/experts/software-architect/README.md` and `/Users/xiaozhongyuan/Documents/experts/software-architect/agents/software-architect.md` — document language selection and Java adapter routing.
- Create: `/Users/xiaozhongyuan/Documents/experts/software-architect/docs/superpowers/specs/2026-09-10-language-neutral-java-adapter-design.md` — approved design (already created).

## Evidence anchors for Java adapter

Use these repository facts while writing, and label each as `PROJECT FACT` rather than universal guidance:

- Root `pom.xml`: Java 8, Spring Boot 2.2.12, Spring Cloud Hoxton.SR9, four Maven modules, ShardingSphere 5.1.0 dependency management.
- `jic-usercenter-market-api/pom.xml`: shared API artifact, OpenFeign, validation API, Swagger/common dependencies.
- `jic-usercenter-market-api-center/pom.xml`: MyBatis-Plus, ShardingSphere, Redis/Jedis, Druid, Retrofit/OkHttp, XXL-Job and domain-facing dependencies.
- `jic-usercenter-market-gateway/pom.xml`: Spring Cloud Gateway, Nacos discovery/config, Hystrix, Redis, Sleuth, request/response filters.
- `api-center/src/main/java/org/springcenter/marketing/modules/`: domain, repository, mapper, integration, event, listener, service, webapi, cache, job and context packages.
- `back-center/src/main/java/org/springcenter/backcenter/modules/`: `mysqlMapper`, `wxMapper`, `bojunMapper`, `hiveMapper`, service, webapi, jobs and configuration packages.
- `src/main/resources/`: DDL scripts, MyBatis configs, generator templates, bootstrap environment files and logging configs.
- Sharding/config classes: route-key mapping, ShardingSphere setup, dual-write interceptor and multi-data-source configuration.

### Task 1: Refactor the main skill routing

**Files:**
- Modify: `skills/fullstack-dev/SKILL.md`

- [ ] Rewrite frontmatter description so it triggers for full-stack/backend architecture and explicitly supports language selection; do not list Express/Next.js as the default.
- [ ] Add a routing section: inspect repository language/build files first, select one adapter, and treat `PROJECT FACT` as higher priority than generic examples.
- [ ] Move implementation workflow wording behind an explicit implementation authorization gate; design-only requests must stop at design artifacts.
- [ ] Replace Node-centric quick-start examples with protocol-neutral checklist items and link to the selected adapter.
- [ ] Add a “do not infer” section covering framework, ORM, token type, DB engine, package layout, and build commands.

### Task 2: Normalize API, DB, Auth, testing, and technology references

**Files:**
- Modify: `references/api-design.md`
- Modify: `references/db-schema.md`
- Modify: `references/auth-flow.md`
- Modify: `references/testing-strategy.md`
- Modify: `references/technology-selection.md`

- [ ] Preserve protocol/domain principles such as resource modeling, method semantics, error taxonomy, pagination, idempotency, consistency, and trade-off analysis.
- [ ] Remove or relabel Express, FastAPI, Jest, PostgreSQL, UUID, JWT, `.env`, npm, and other stack-specific content as `EXAMPLE` or move it to the corresponding adapter.
- [ ] In DB guidance, require evidence from DDL, migrations, mapper/repository code, configuration, query patterns, volume, and transaction boundaries before choosing schema/index/sharding strategies.
- [ ] Add generic rules for multiple relational engines, multiple data sources, read/write split, sharding, cache consistency, and additive migration; keep engine-specific syntax in adapters.
- [ ] In Auth guidance, distinguish authentication, service identity propagation, authorization, data permission, audit, and gateway responsibility; do not assume JWT/Spring Security/OAuth.
- [ ] In testing guidance, retain the testing pyramid but map tests to actual project boundaries: module build, API contract, persistence/DDL, multi-data-source transaction, shard routing, cache, message, job re-entry, and gateway chain.
- [ ] In technology selection, require a repository baseline scan and weighted trade-off matrix before recommending a language/framework/database.

### Task 3: Write the Java/Spring/MyBatis adapter

**Files:**
- Create: `skills/fullstack-dev/language-adapters/java-spring.md`

- [ ] Add frontmatter with a trigger description for Java/Spring/Maven repositories, MyBatis/MyBatis-Plus, multiple data sources, Spring Cloud modules, and related integration concerns.
- [ ] Document the four-module model and forbidden responsibility leakage: API contracts only in `api`; business implementation in centers; gateway infrastructure only.
- [ ] Document package/layer mapping using the project’s `webapi`, `service`, `modules/domain`, `repository`, `mapper`, `entity/model`, `convert`, `integration`, `event/listener`, `job`, `config`, and `common` families.
- [ ] State when to use domain/repository abstractions and when simple service-plus-mapper is sufficient; do not force DDD for CRUD.
- [ ] Document DTO/domain/entity separation and conversion through existing converter/MapStruct patterns.
- [ ] Document MyBatis/MyBatis-Plus responsibilities, XML/resource placement, generated code review, mapper naming, and query ownership.
- [ ] Document MySQL/Oracle/Hive data-source boundaries, transaction limitations across databases, and required design evidence.
- [ ] Document Redis/Redisson cache, lock, idempotency, coordination, invalidation, rebuild, timeout, and degradation considerations.
- [ ] Document ShardingSphere route-key requirements, query restrictions, range-query behavior, migration, dual-write, rollback, and verification; reference the project’s sharding mapping and dual-write configuration as evidence.
- [ ] Document Feign/Retrofit integration boundaries, timeout/retry/circuit-breaker/idempotency/fallback/observability requirements.
- [ ] Document MQ/event bus/transaction queue/XXL-Job semantics: delivery point, duplicate consumption, retry, compensation, concurrency, and alerting.
- [ ] Document Gateway/Nacos/Sleuth/K8s/bootstrap configuration as project compatibility facts and mark old dependencies as `LEGACY COMPAT` where applicable.
- [ ] Document auth routing as responsibilities only; require code/config inspection for token/header/context specifics.
- [ ] Add a Java delivery checklist with exact repository-derived commands to be discovered from Maven files rather than invented.

### Task 4: Isolate non-Java adapters

**Files:**
- Create: `language-adapters/nodejs.md`
- Create: `language-adapters/python.md`
- Create: `language-adapters/go.md`

- [ ] Move existing TypeScript/Express, FastAPI, and Go snippets into their matching adapter files.
- [ ] Label all snippets `EXAMPLE` and state that the target repository’s conventions override them.
- [ ] Keep each adapter concise: project structure mapping, error handling, persistence/integration mapping, testing commands, and common pitfalls.
- [ ] Ensure no non-Java adapter is referenced as the default when the repository is Java.

### Task 5: Update expert-level routing and README

**Files:**
- Modify: `agents/software-architect.md`
- Modify: `README.md`

- [ ] Add the language-selection rule: inspect POM/Gradle/package/go.mod/pyproject/etc. before choosing an adapter.
- [ ] State that the Java adapter is grounded in the current JIC project and must be treated as a project-specific reference when used elsewhere.
- [ ] Update optional skill descriptions so `fullstack-dev` is a neutral reference and the chosen adapter is consulted only when relevant.
- [ ] Preserve existing requirements clarification, repository evidence, human review, and explicit implementation authorization boundaries.

### Task 6: Run documentation pressure tests and static verification

**Files:**
- Inspect all modified skill files; no business repository files should change.

- [ ] Verify every new/modified skill frontmatter has valid `name` and `description`, and descriptions start with `Use when` where the skill specification requires it.
- [ ] Scan generic references for unqualified Node-first defaults: `Express`, `Next.js`, `PostgreSQL`, `UUID`, `JWT`, `.env`, `npm run`.
- [ ] Scan Java adapter claims against the evidence anchors above; remove any claim without a matching POM, directory, config, or code category.
- [ ] Run pressure scenarios manually: (a) Java Maven repository with multiple data sources, (b) Node repository, (c) unknown-language repository, (d) design-only request, (e) implementation request with unreviewed tasks. Confirm the routing and authorization behavior in the text is unambiguous.
- [ ] Check links, headings, code fences, label usage, and duplicated rules with `rg`, `sed`, and a Markdown/frontmatter parser if available.
- [ ] Confirm `git diff` is unavailable for the expert package because it has no Git repository; report changed file list and verification output instead.

## Self-review results

- Spec coverage: goals, non-goals, structure, Java module model, persistence, DB/sharding, integrations, async work, auth, verification, compatibility, and acceptance criteria are covered by Tasks 1–6.
- Placeholder scan: no `TBD`, `TODO`, or “implement later” steps are used; each task identifies exact files and an observable check.
- Type/terminology consistency: `api`, `api-center`, `back-center`, `gateway`, `MyBatis/MyBatis-Plus`, `ShardingSphere`, `Feign/Retrofit`, `XXL-Job`, and the rule labels are used consistently with the approved design.

