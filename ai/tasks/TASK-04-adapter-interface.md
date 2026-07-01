# TASK-04 — Platform adapter interface + registry

**Depends on:** TASK-03 · **Difficulty:** Medium · **Order:** 4
**Requirements:** FR-3, NFR-1, AC-3

## Prompt
Create the platform extension point per `execution-plan.md` §3.2 — the maintainability keystone.

Do:
- Define `PlatformAdapter` interface: `getComments(externalPostId, cursor)`,
  `replyToComment(externalCommentId, body)`, plus a `capabilities`/`platform` descriptor.
- Define the typed error taxonomy adapters must throw
  (e.g. `RateLimitError`, `TokenExpiredError`, `NotFoundError`, `PlatformError`).
- Implement an `AdapterRegistry` that registers + resolves adapters by `Platform` enum,
  provided via a `PlatformsModule` using Nest DI (e.g. a provider map / multi-provider keyed by `Platform`).
  Unknown platform → typed error.
- Document "How to add a new platform" (should be: new adapter provider + one registration in the module).

## Definition of Done
- Registry resolves/registers adapters via Nest DI; unknown platform throws typed error.
- Adding a platform requires no changes to services/controllers (verify by design).

**Role focus:** Code Reviewer — elevated.
