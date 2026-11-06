---
name: fullstack-dev-db-schema
description: Use when designing relational or non-relational persistence, tables, indexes, migrations, data-source boundaries, caching, or sharding.
license: MIT
metadata:
  version: "2.0.0"
---

# Database and Persistence Design (Language-Neutral)

## Evidence first

Read DDL/migrations, mapper/repository code, configuration, query patterns, data volume/growth, transaction requirements, retention, and recovery objectives. Never turn an ORM convention or one database engine into a universal rule.

## MUST rules

- Model business invariants and access patterns before choosing tables, documents, indexes, or caches.
- Define ownership, primary/unique keys, nullability, lifecycle, retention, and deletion behavior.
- Add indexes for measured access paths; validate selectivity and write cost with the target engine’s explain tool.
- Make migrations additive and reversible where possible. For destructive changes use expand → migrate/backfill → switch → contract.
- State transaction boundaries and consistency when more than one database, cache, queue, or service participates.
- Denormalize only with measured need and a maintenance/rebuild strategy.

## Multiple data sources and sharding

When multiple relational engines or schemas exist, document source ownership, routing, read/write behavior, transaction limits, failure handling, and data movement. Sharding requires a stable route key, query restrictions, range-query behavior, hot-key analysis, migration/backfill, dual-write or cutover plan, rollback, and verification. A sharding middleware configuration does not replace domain access design.

## Cache and coordination

For every cache/lock/idempotency key record owner, key format, TTL, invalidation, rebuild, stale-read policy, lock timeout, failure fallback, and observability. A cache is not the source of truth unless the design explicitly makes it one.

## ADAPT

Map schema types, migration tooling, transaction APIs, ORM/mapper conventions, partitioning, and explain commands through the language adapter. SQL examples are **EXAMPLE** unless tied to the target engine.

## Review checklist

- [ ] DDL and query evidence is cited.
- [ ] Constraints protect business invariants at the right layer.
- [ ] Indexes match real queries and ordering.
- [ ] Migration handles old/new application compatibility and rollback.
- [ ] Multi-source, shard, cache, and recovery behavior is testable.
