---
name: fullstack-dev-technology-selection
description: Use when selecting or changing a language, framework, database, messaging system, cache, deployment model, or observability stack.
license: MIT
metadata:
  version: "2.0.0"
---

# Technology Selection (Evidence-Based)

## Order of decisions

1. Define functional boundaries and quantified quality attributes.
2. Inspect current repository, team capability, operational platform, dependencies, and migration constraints.
3. Compare viable options against weighted criteria: fit, reliability, performance, operability, ecosystem, team skill, cost, security, and reversibility.
4. Record the decision, rejected alternatives, consequences, and exit/migration signals.

## MUST rules

- Existing approved conventions beat generic defaults.
- Do not select a technology only because it is popular or familiar to the author.
- Treat framework/ORM/database defaults as hypotheses until validated against queries, traffic, failure modes, and operational capability.
- Prefer the smallest architecture that meets measured requirements; time-box uncertain PoCs.
- Mark compatibility constraints separately from new-project recommendations.

## Decision record

```text
Context → constraints → candidates → weighted comparison → decision
       → consequences → migration/exit signals → verification owner
```

## Anti-patterns

- Node.js, PostgreSQL, Java, or any other stack as a universal default.
- Microservices, sharding, event sourcing, or a second database without a forcing requirement.
- Recommending an upgrade while ignoring repository compatibility.
