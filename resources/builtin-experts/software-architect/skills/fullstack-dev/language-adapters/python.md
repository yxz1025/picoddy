---
name: fullstack-dev-python
description: Use when the repository is a Python backend and framework, persistence, configuration, or testing guidance is needed.
license: MIT
metadata:
  category: language-adapter
  version: "1.1.0"
---

# Python Adapter

This is an **ADAPT** layer. Inspect `pyproject.toml`, `requirements.txt`, framework, settings, migration tooling, dependency-injection pattern, and test commands before applying it.

- Map validation, error handling, request context, and API schema through the existing framework.
- Keep domain, application, persistence, and transport models separate where complexity justifies it.
- Treat FastAPI, Django, Flask, Pydantic, SQLAlchemy, PostgreSQL, and JWT as **EXAMPLE** choices only.
- Derive virtual-environment, test, lint, and startup commands from repository files.
- For Django-specific repositories, also consult `python-django.md`; its framework details are not generic guidance.

## Evidence and execution model

- Inspect supported Python versions, package/lock files, import layout, application startup and deployed process model.
- Determine whether requests, jobs and clients execute synchronously or asynchronously from code. Trace blocking operations and resource lifetimes before proposing async conversion.
- Read established validation, dependency injection and exception mapping paths. Type annotations alone do not validate external input.

## Application and persistence boundaries

- Locate business rules in existing services, domain objects, framework models or handlers. Separate responsibilities for concrete complexity/testing benefits, not a prescribed directory layout.
- Identify request/job ownership of database sessions, transactions and connection pools. Verify cleanup on exceptions/cancellation and isolation of mutable request state.
- Inspect the migration graph and database engine. Design schema compatibility, bounded backfill and recovery using existing tooling.
- Confirm serialization of decimals, dates, optional fields and errors against consumer contracts rather than assuming framework defaults are the intended API.

## Jobs, identity and operations

- For background workers, identify serialization, delivery/acknowledgment, duplicate handling, retry bounds and actor/audit context.
- Trace authentication and authorization through dependencies, middleware and protected queries. Separate request data from trusted identity.
- Follow runtime configuration and secret injection. Check startup validation, worker initialization, health reporting and shutdown against the deployment model.

## Verification and output

- Derive environment, test, lint and type-check commands from the repository; do not replace unittest, pytest, fixtures or factories based on this adapter alone.
- Verify changed validation, denied access, rollback, session cleanup and asynchronous failures using the established test lifecycle.
- Deliver entry-to-storage evidence, process/resource ownership, relevant configuration and actual verification results. State unsupported environments and unexecuted checks.
