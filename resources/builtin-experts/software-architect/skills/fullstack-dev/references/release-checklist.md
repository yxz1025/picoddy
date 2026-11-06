---
name: fullstack-dev-release-checklist
description: Use when preparing a service or multi-module system for release, rollback, deployment, or operational handoff.
license: MIT
metadata:
  version: "2.0.0"
---

# Release and Handoff Checklist

- [ ] Requirement/spec/tasks version and implementation authorization are recorded.
- [ ] Build artifact, dependency lock/baseline, configuration and migration changes are reproducible.
- [ ] API compatibility, auth/permission behavior, data migration, cache, message and scheduled-job changes are verified.
- [ ] Health/readiness, metrics, logs, tracing, alerts, dashboards and ownership are defined.
- [ ] Rollout, feature flag/cutover, rollback, backfill and recovery procedures are written.
- [ ] Secrets and environment-specific values are supplied by approved runtime configuration.
- [ ] Smoke tests cover the actual gateway/service entry points and critical business path.
- [ ] Unexecuted checks, known risks, legacy compatibility constraints and follow-up work are reported.

## ADAPT

Use the target repository’s Maven/Gradle/npm/go/python, container, CI/CD, K8s or VM entry points. Never copy commands from another adapter.
