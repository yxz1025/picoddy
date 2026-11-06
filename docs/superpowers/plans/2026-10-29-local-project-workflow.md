# Local project workflow implementation plan

**Goal:** Implement the approved local project / staged expert design without TAPD calls.
**Architecture:** Shared DTOs/templates in `src/domains/project/shared/workflow.ts`; an account-scoped SQLite domain service and `/api/local-projects` adapter; new project UI reusing ChatArea/Composer and expert sessions. Existing TAPD records remain preserved.

## Tasks

- [x] Domain service: create/list/get/update/archive projects, validate repositories, create stage sessions idempotently, prepare real file-backed review, confirm exact revision and advance transactionally, reopen upstream with downstream invalidation. Test with temporary SQLite/files before implementation.
- [x] HTTP adapter: `/api/local-projects` GET/POST; `/api/local-projects/:id` GET/POST. POST actions are `settings`, `archive`, `repository`, `asset`, `start`, `review`, `confirm`, `reopen`. API scope comes from active auth, never client accountId. Return LocalProject for all mutations except start (`{project,conversation}`).
- [x] Desktop UI: project home/templates/filter, creation modal, workspace with stage rail, real chat and shared asset/repository inspectors, review/approval, settings/history and legacy read-only records. No model call on creation or navigation.
- [x] Integration: inject backend-owned local stage context into actual prompt path, set selected project MCP scope, guard busy/stale stages, collect real delivered files, exclude project-scoped sessions from ordinary task list while preserving explicit access.
- [ ] Validation: domain tests (scope/revision/transactions/files/idempotency/return), frontend build, browser flow with network assertion that project actions make no TAPD calls, actual desktop startup and screenshots. Verify errors/loading/reduced-motion/keyboard.

## Contract

Collection POST accepts LocalProjectCreate. Detail POST accepts `{action, ...payload}`:
`settings`: `{name?,description?,instructions?,connectors?,stages?}`; `archive`: `{archived:boolean}`;
`repository`: `{name,path,role}`; `asset`: `{path,stageId}` (explicit local file import);
`start`: `{stageId,modelProvider,modelId}`; `review`: `{stageId,summary,risks,assetIds}`;
`confirm`: `{stageId,revision}` (uses review version and validates file hashes);
`reopen`: `{stageId}`. Stage status and project revision always come from backend.

Start creates/restores a real conversation, binds selected installed expert and project directory, but does not call the model. Existing session execution APIs perform the user's subsequent prompt.

User instruction (2026-10-30): do not start automated tests. The isolated browser fixture service was stopped and removed. Frontend production build passed; full main-process typing is limited by three existing errors in context_budget.ts. Final automated UI/model execution validation remains unperformed.
