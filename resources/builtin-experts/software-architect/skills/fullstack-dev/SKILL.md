---
name: fullstack-dev
description: Use when designing or implementing a full-stack or backend system and the target repository has API, persistence, integration, authentication, testing, or operational concerns.
description_zh: "全栈与后端架构、实现和验证指南"
description_en: "Language-neutral full-stack and backend architecture guide"
license: MIT
metadata:
  category: full-stack
  version: "2.1.0"
---

# Full-Stack Development Practices

## Scope gate

For existing-repository design, read the repository rules and `../../agents/references/engineering-design-workflow.md` first. This skill is an optional technical reference: design requests do not authorize scaffolding, implementation, dependency installation, or deployment.

## Language and repository routing

Before choosing examples or commands, inspect the repository:

| Evidence | Adapter |
|---|---|
| `pom.xml`/`build.gradle`, Spring packages, MyBatis | `language-adapters/java-spring.md` |
| `package.json`, TypeScript/JavaScript backend | `language-adapters/nodejs.md` |
| `pyproject.toml`/`requirements.txt`, Python packages | `language-adapters/python.md` |
| `go.mod`, Go packages | `language-adapters/go.md` |

Select applicable adapters per repository or module, allowing several within one requirement. Establish boundaries from code and configuration; package.json alone does not prove a JavaScript backend, and a Java build file alone does not prove Spring/MyBatis. Pure frontend work follows its own project standards. When no adapter matches, use repository evidence directly. Approved project conventions and exceptions override applicable company rules and generic references; code facts and product goals must be reconciled rather than silently overriding each other.

## Rule labels

- **MUST** — language-neutral architectural constraint.
- **ADAPT** — implementation mapping selected from the adapter.
- **PROJECT FACT** — verified from the target repository.
- **EXAMPLE** — illustrative only; never a default.
- **LEGACY COMPAT** — retained for compatibility; do not copy into new work without a reason.

## Design checklist

- Clarify consumers, domain boundaries, consistency, scale, failure modes, security, and operational constraints.
- Model APIs around domain capabilities, not database tables or framework controllers.
- Define persistence ownership, transaction boundaries, migration/rollback, and cache consistency.
- Define external-call timeouts, retry limits, idempotency, fallback, and observability.
- Separate authentication, authorization, data permission, audit, and gateway responsibilities.
- Derive build, test, smoke, and deployment commands from repository evidence.

## Implementation workflow — only with explicit authorization

For implementation from reviewed task artifacts, follow `../../agents/references/task-review-and-execution.md`. Extend the existing structure; do not recreate a scaffold or impose the examples below. Validate before claiming completion and report checks not executed.

## References

- `references/api-design.md` — protocol and domain-facing API decisions.
- `references/db-schema.md` — engine/ORM-neutral persistence and migration decisions.
- `references/auth-flow.md` — identity and access-control boundaries.
- `references/testing-strategy.md` — verification by architectural boundary.
- `references/technology-selection.md` — evidence-based technology selection.
- `references/environment-management.md` — configuration precedence, secrets, environment isolation, reload and rollback; read when runtime configuration changes.
- `references/release-checklist.md` — reproducible artifacts, rollout, recovery and operational handoff; read when preparing release or handoff.
- `language-adapters/java-spring.md` — company Java engineering conventions, with JIC as the reference implementation; only apply company-specific rules within their confirmed scope.
