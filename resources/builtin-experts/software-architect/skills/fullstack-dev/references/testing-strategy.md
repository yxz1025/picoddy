---
name: fullstack-dev-testing-strategy
description: Use when defining verification for business logic, APIs, persistence, integrations, asynchronous work, deployment, or performance.
license: MIT
metadata:
  version: "2.0.0"
---

# Testing and Verification (Language-Neutral)

Use a pyramid appropriate to risk: many fast domain tests, focused integration tests at persistence/integration boundaries, a small number of end-to-end flows, and targeted contract/performance tests.

## Boundary matrix

| Boundary | Verify |
|---|---|
| Domain/service | invariants, state transitions, idempotency, failure policy |
| API | contract, validation, auth, authorization, pagination, error envelope |
| Persistence | DDL compatibility, constraints, indexes, transactions, migration/backfill |
| Multiple sources/shards | routing, read/write behavior, partial failure, rollback |
| Cache/lock | invalidation, stale data, expiry, contention, rebuild |
| Message/event/job | delivery, duplicate handling, retry, compensation, concurrency, re-entry |
| Gateway/deployment | route, filter/auth chain, config, health, graceful shutdown |

## MUST rules

- Test behavior and invariants, not only mocks or implementation branches.
- Use isolated, reproducible test data and a real compatible infrastructure layer for integration risks.
- Include denied, duplicate, timeout, retry, partial-failure, and recovery paths for critical flows.
- Derive commands, modules, ports, and services from repository files; report unexecuted checks.
- Performance thresholds must name workload, percentile, error rate, and measurement environment.

## ADAPT

Use the selected ecosystem’s runner, fixtures, containers, contract tooling, build system, and static checks. Examples from another language are not commands for the target repository.
