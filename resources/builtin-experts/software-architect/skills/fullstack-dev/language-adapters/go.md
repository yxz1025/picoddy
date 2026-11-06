---
name: fullstack-dev-go
description: Use when the repository is a Go service and framework, persistence, configuration, or testing guidance is needed.
license: MIT
metadata:
  category: language-adapter
  version: "1.1.0"
---

# Go Adapter

This is an **ADAPT** layer. Inspect `go.mod`, package layout, transport, persistence, configuration, and `go test`/build entry points.

- Keep handlers, application services, domain logic, repositories, and generated/SQL models distinct when required by the domain.
- Map context cancellation, error wrapping, retries, graceful shutdown, and observability to the existing libraries.
- Treat Gin, Echo, Fiber, Chi, GORM, PostgreSQL, and JWT as **EXAMPLE** choices only.
- Derive commands and infrastructure requirements from the repository, not this adapter.

## Evidence and package boundaries

- Inspect module/workspace files, supported toolchain, build tags, generated code and command entry points before choosing build scope.
- Trace a handler through application logic and storage. Add interfaces where they isolate actual consumer dependencies, not for every type.
- Identify ownership of shared state and process resources; document initialization and cleanup rather than adding global infrastructure state.

## Concurrency and downstream calls

- Trace context deadlines and cancellation through handlers, storage and clients. Define ownership and termination for work intentionally outliving a request.
- For goroutines and worker pools, explain lifetime, concurrency bounds, error propagation and shutdown. Inspect channel ownership and cancellation for leaks or blocked sends.
- Identify synchronization for shared mutable data; successful sequential tests do not establish concurrent safety.
- Map domain errors to existing transport contracts and retain internal causes without exposing sensitive details.

## Persistence and operations

- Follow SQL/ORM, connection-pool and migration conventions. Verify related writes use the intended transaction handle and define partial-failure recovery.
- Check timeout/retry budgets, consumer duplicate handling and resource cleanup during shutdown.
- Derive readiness, configuration loading, metrics and termination from the deployed service. Framework and database names above remain examples.

## Verification and output

- Derive build/test commands from scripts and CI, including tags, CGO and platform requirements where applicable.
- Use focused integration tests for SQL, transactions and downstream contracts. For shared-state changes, consider the race detector where supported; report unsupported checks.
- Deliver package/call-flow evidence, concurrency ownership, affected tests and actual commands. Do not replace the router or create an interface hierarchy merely to fit this adapter.
