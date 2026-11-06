---
name: fullstack-dev-python-django
description: Use when the target repository uses Django and needs architecture, persistence, authentication, or testing guidance; apply DRF details only where DRF is present.
license: MIT
metadata:
  category: language-adapter
  version: "1.1.0"
---

# Django Adapter

This is an **ADAPT** layer extending [Python guidance](python.md). Read installed versions, settings, URL configuration, models, migrations and tests first. Django REST Framework (DRF) guidance applies only to repositories using it. Do not assume a Django version, database, identity protocol or deployment stack.

## Application boundaries and business rules

- Trace a request from URL resolution through view, form/serializer, business logic and query. Identify responsibilities before proposing apps or services.
- Preserve app boundaries unless the requirement exposes concrete coupling problems. Apps need not map one-to-one to bounded contexts; cross-app model relationships require ownership and migration analysis, not a blanket ban.
- Place transport validation in the established form/serializer path. Put reusable invariants and orchestration in the project's model, manager or service layer as appropriate. Do not simultaneously prescribe “fat models” and “all business logic in services”.
- Separate input and output serializers when field permissions or contracts differ. Existing ModelSerializer writes are acceptable when writable fields, validation and nested-update behavior are explicit and tested.

## Identity and permissions

- Inspect AUTH_USER_MODEL, authentication backends, middleware and DRF authentication/permission classes before changing identity behavior.
- For new projects, decide identity requirements before initial models and migrations. For existing projects, user-model changes require reference, data, migration-dependency and recovery analysis; do not suggest deleting databases or migration history as a routine fix.
- Choose sessions, tokens or delegated identity from trust boundaries, consumers and existing infrastructure. SPA or cross-origin access alone does not establish a JWT requirement.
- Verify list/queryset scoping, object access, writable fields and admin actions. Test actual authentication failure behavior instead of assuming every configuration returns the same status code.
- Inspect cookie, CSRF and proxy trust settings for the deployed boundary. Separate authentication from business and tenant/data permissions.

## Models, transactions and migrations

- Derive field types, keys, deletion behavior and constraints from invariants and the actual database. UUID keys, table names and timestamp base classes are choices, not defaults.
- Review migration history and deployment order. Explain old/new code compatibility, backfill, cutover and recovery; do not casually rewrite applied migrations.
- Assess data-migration reversibility explicitly. Where reversal is impossible or lossy, document the limit and recovery/forward-fix plan instead of inventing a reverse operation.
- Verify transaction scope around multi-write invariants and locking reads. Check the installed framework and database behavior before using locks as a concurrency guarantee.
- For multiple databases, identify routing and transaction boundaries. For external side effects, define durable delivery and reconciliation rather than assuming database transactions cover messages or HTTP calls.

## Queries and performance

- Measure query count, response size and execution cost. Choose select_related or prefetch_related for relationships actually accessed; do not eager-load every relation automatically.
- Review serializer traversal, pagination ordering and dataset bounds. Check indexes against the actual engine and filters/orderings.
- Before bulk writes or queryset updates, inspect business hooks, validation, signals and audit behavior that the chosen operation must preserve.
- Caching requires ownership, key scope, expiry, invalidation and stale-read policy. Include identity/tenant scope where responses depend on it.

## Configuration and deployment

- Follow the settings layout, whether one module or several. Document precedence, startup validation and secret injection instead of requiring file splitting.
- Confirm the production serving model, WSGI/ASGI entry, worker resources, trusted hosts/proxies, static/media storage and observability. Gunicorn, Nginx, WhiteNoise, Celery, Redis and PostgreSQL are possible choices, not a mandatory bundle.
- Address debug disclosure and development-server limitations in production. Derive deployment checks from the installed version and runtime; do not copy worker counts, timeouts or security settings without evaluating environment effects.

## Verification and delivery

- Reuse the Django runner or pytest setup, fixtures/factories and database configuration. Check test lifecycle and isolation before changing tools.
- Verify form/serializer validation, queryset/object permissions, admin mutations, query counts and migration compatibility when affected.
- Exercise actual transaction, commit and concurrency behavior for locking and side-effect risks; inspect what the test harness wraps or simulates.
- Derive management commands, settings module and database aliases from the project. Record actual results; static inspection cannot establish that migrations or deployment checks passed.
- Deliver file/symbol evidence, request-to-query flow, responsibility boundaries, migration risks and verification scope. Unrelated framework replacement or architecture cleanup is outside this adapter's purpose.
