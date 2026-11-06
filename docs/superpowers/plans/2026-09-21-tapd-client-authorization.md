# TAPD authorization independent of PICODDY

User approved direct implementation of browser OAuth with credentials returned only to the originating client.

## Design

Each desktop installation creates a 32-byte random client secret, persisted with Electron safeStorage in a private file. Main-process requests use `Authorization: Bearer <secret>`. The server derives an owner from SHA-256 of the secret in a dedicated `tapd-client-v1` namespace; it never trusts supplied user IDs. This preserves existing database ownership checks without migrating or exposing old enterprise grants. Old grants require reauthorization. A separate per-attempt claim verifier continues protecting confirmation. Browser tickets and OAuth state remain single-use. Secrets never enter URLs, renderer snapshots, or logs.

The trusted proxy secret remains a network boundary, not user authentication. NGINX strips legacy identity headers, passes Authorization, excludes browser query strings from access logs, and rate-limits creation independent of client secret. No enterprise auth subrequest is needed. Clients keep grants across app restart and PICODDY logout/login. Distinct OS app profiles have distinct secrets. Clearing the secret requires reauthorization.

## Tasks and checks

1. Server: write failing HTTP integration tests using the real server, principal resolver and temporary SQLite, with only TAPD upstream mocked. Cover create/launch/callback/poll/confirm/credential, missing credentials, forged identity, cross-client reads/revoke/confirm, restart, cancellation/replay/expiration and reauthorization. Replace principal resolution with the client-secret protocol. Keep gateway boundary. Add resource-abuse limits. Run `node --test test/server/*.test.mjs`.
2. Desktop: extract a dependency-injected authorization client from Electron wiring. Write tests for no PICODDY requirement, stable protected client key across reload, malformed/failed storage, broker headers, redirects, bounded polling, errors, confirm and credential flow. Implement secure persistence and independent owner lifecycle; remove the TAPD-specific PICODDY message. Only trusted TAPD IPC routes bypass the general local PICODDY guard. Run focused `tsx --test` suites.
3. Integration: check the actual TAPD user identity API contract, fix relevant protocol mismatches, preserve token isolation and main-process-only credentials. Add a client-to-server integration test with local proxy adapter and simulated TAPD responses.
4. Deployment: update NGINX example, environment example and README with exact protocol, migration and validation instructions. Do not publish/deploy secrets or use real personal tokens in tests. Verify builds and relevant regressions; independently review security and spec compliance.

## Release evidence

Automated tests can prove the complete local HTTP/browser callback/client retrieval protocol. Real TAPD consent, the deployed reverse proxy and actual production app permissions require environment validation; report these separately and never claim live validation without performing it.
