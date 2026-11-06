# TAPD read cache implementation

User approved the cache proposal in this conversation. Execute in this workspace without committing unrelated work.

- [x] Add bounded memory cache with TTL, in-flight coalescing, fresh reads, cloning, and generation invalidation. Test expiry, identity separation, failures, and invalidation races first.
- [x] Cache successful TAPD reads: status/transition metadata 30 minutes, story/count/context reads 30 seconds. Preserve credential checks before reuse. Key by local account, API origin, credential digest, endpoint and complete parameters.
- [x] Share identical story fields between context and workflow reads. Existing local input/asset/conversation ownership guards remain; their upstream context reads reuse the same 30-second results.
- [x] Cache TestX directory discovery reads for 5 minutes only. Explicit refresh and pre-upload directory validation bypass cache; case reconciliation and writes never use cache.
- [x] Clear results on OAuth changes, denied API access, explicit list refresh and before/after writes. Fresh workflow validation before/after transition. Never cache failures or allow stale in-flight results to repopulate invalidated entries.
- [x] Verify request counts, compile TypeScript, build frontend, and run TAPD/import regressions. Report simulated counts separately from live verification.

Cache is process-local and never persists tokens or returned business data to disk. It reduces traffic but does not establish upstream quota scope or pace arbitrary MCP tool requests. MCP tools without an explicit read-only annotation invalidate API caches before and after execution. Read pacing is 1.1 seconds per credential within this process; this is not an account-wide upstream quota guarantee.

Validation: API-adapter test with mocked TAPD responses verifies four context consumers = four network requests, plus one workflow metadata request for the default workflow fixture. TypeScript and frontend builds are checked separately; no live TAPD account load test.
