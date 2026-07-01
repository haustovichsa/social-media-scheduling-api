# TASK-10 — AuthN/AuthZ guard (ownership)

**Depends on:** TASK-02, TASK-03 · **Difficulty:** Medium · **Order:** 10 (land before TASK-09 ships)
**Requirements:** NFR-4, AC-4, assumption A-6

## Prompt
Enforce multi-tenant ownership per `execution-plan.md` §2.5 (A-6).

Do:
- Nest auth guard resolving the caller → org/user.
- Ownership check utility (+ guard): post/comment must belong to the caller's org.
- Apply to both comment routes via `@UseGuards`; deny cross-tenant access.

## Definition of Done
- Cross-tenant access returns 403/404 (choose + document one).
- Guards covered by tests and applied to `GET comments` and `POST reply`.

**Role focus:** Security — elevated.
