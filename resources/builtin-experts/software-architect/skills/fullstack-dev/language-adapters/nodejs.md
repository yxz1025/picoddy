---
name: fullstack-dev-nodejs
description: Use when the repository is a Node.js or TypeScript backend and framework-specific API, persistence, configuration, or testing guidance is needed.
license: MIT
metadata:
  category: language-adapter
  version: "1.1.0"
---

# Node.js/TypeScript Adapter

This is an **ADAPT** layer, not the default backend choice. Inspect `package.json`, runtime version, framework, existing middleware, ORM, migrations, and test scripts first.

- Map transport validation, error handling, request context, and OpenAPI through the repository framework.
- Keep DTOs, domain services, repositories, and ORM models separate when the domain warrants it.
- Treat `.env`, JWT, Express, Fastify, NestJS, Prisma, and PostgreSQL as **EXAMPLE** choices only.
- Derive npm/pnpm/yarn commands and ports from package scripts and project docs.
- Test API, persistence, auth/authorization, external calls, retries, queues, and graceful shutdown at the actual boundaries.

## Evidence and runtime boundaries

- Locate backend entry points, workspace boundaries, runtime constraints, lockfile, module format and build output. A frontend package does not establish a Node.js service.
- Trace a real route through middleware/hooks, validation, application logic and persistence. Preserve the project's dependency injection and error mapping conventions.
- Identify CPU-heavy and blocking operations in request paths; measure their effect before choosing workers, background jobs or a separate service.

## Persistence and asynchronous work

- Locate transaction ownership and connection-pool lifecycle. Check that related writes share the intended transaction and external calls have an explicit failure policy.
- Follow the existing migration runner and deployment order. Describe old/new code compatibility, bounded backfill and recovery for affected schema changes.
- Trace promise rejection handling, cancellation and deadlines through downstream calls. Define ownership and error handling for work that outlives a response.
- For queues and scheduled jobs, identify acknowledgment timing, duplicate handling, concurrency limits and shutdown behavior from actual code and library configuration.

## Identity, configuration and operations

- Verify middleware order, trusted proxy/header assumptions, request-context isolation and permission checks. TypeScript types alone do not validate incoming data.
- Read configuration precedence and startup validation. Map secret rotation, readiness, connection cleanup and in-flight request draining to the deployed process model.
- Reuse logging/tracing context without exposing credentials or sensitive payloads in errors.

## Verification and output

- Use existing build, type-check and test scripts; select affected workspaces and required dependency builds.
- Exercise rejected input, denied access, concurrent requests, transaction rollback, downstream timeout and duplicate jobs when those boundaries change.
- Deliver an evidence map: entry point → middleware → application/persistence → test → runtime configuration. Record gaps instead of introducing tools to fill this checklist.
