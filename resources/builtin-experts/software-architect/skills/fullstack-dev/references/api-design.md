---
name: fullstack-dev-api-design
description: Use when designing, reviewing, versioning, or documenting an API and its consumers, errors, pagination, or compatibility policy.
license: MIT
metadata:
  version: "3.0.0"
---

# API Design (Language-Neutral)

## Context required

Identify consumers, domain capabilities, compatibility baseline, traffic/latency, authentication boundary, consistency, and existing endpoint/envelope conventions before choosing REST, GraphQL, RPC, or messaging.

## MUST rules

- Name endpoints after domain resources or capabilities, not tables, classes, or CRUD verbs.
- Preserve method semantics: safe reads, explicit mutations, and documented idempotency.
- Define success, validation, authentication, authorization, not-found, conflict, rate-limit, and upstream-failure behavior.
- Use one error envelope per API boundary with stable machine-readable code, human detail, request/correlation ID, and field errors where applicable.
- Paginate unbounded lists; choose cursor or offset from access patterns and state the ordering guarantee.
- Define versioning and compatibility: additive fields/endpoints are usually compatible; removals, renames, type changes, and stricter validation need a migration plan.
- Keep transport DTOs separate from domain and persistence models.

## Decision record

```text
Consumers → capability/resource model → protocol → envelope → auth → consistency
         → pagination/filtering → idempotency → observability → compatibility plan
```

## ADAPT

Map validation, serialization, routing, status codes, request context, and OpenAPI/IDL generation through the selected language adapter. Do not assume JSON, HTTP, REST, camelCase, or a particular framework when the repository uses another contract.

## Review checklist

- [ ] Existing conventions and consumers are cited.
- [ ] Invalid input, missing identity, missing permission, conflict, timeout, and retry behavior are specified.
- [ ] List bounds, sorting stability, filtering, and total-count cost are explicit.
- [ ] Duplicate requests and partial failures are safe.
- [ ] Contract tests or generated documentation have an owner.
