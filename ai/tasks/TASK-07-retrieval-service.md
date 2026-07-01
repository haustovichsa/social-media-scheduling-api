# TASK-07 — Comment retrieval service

**Depends on:** TASK-05, TASK-06 · **Difficulty:** Medium · **Order:** 7
**Requirements:** FR-1, NFR-5/NFR-6, AC-1

## Prompt
Implement `CommentService.getComments` with the cache-and-sync policy per
`execution-plan.md` §3.3 / assumption A-4.

Do:
- Read comments from the local canonical store for a published post.
- If empty/stale per policy, refresh via the resolved adapter, upsert results, then return.
- Cursor-based pagination end-to-end; expose `syncedAt` in the result.
- Enforce ownership via the guard from TASK-10.

## Definition of Done
- Returns normalized, paginated results regardless of platform.
- Both cache-hit and refresh paths unit-tested; pagination edge cases covered.

**Role focus:** Performance, QA — elevated.
