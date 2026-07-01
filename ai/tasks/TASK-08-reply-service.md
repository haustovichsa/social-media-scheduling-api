# TASK-08 — Reply service (write-through + idempotency)

**Depends on:** TASK-05, TASK-06 · **Difficulty:** Medium · **Order:** 8
**Requirements:** FR-2, AC-2, RK-4

## Prompt
Implement `CommentService.replyToComment` per `execution-plan.md` §3.3.

Do:
- Accept an idempotency key; check `reply_outbox` to prevent double-posting.
- Write through to the platform via the resolved adapter, then persist the created reply.
- Return the canonical `Reply`.
- Handle partial failure / retry without creating phantom rows.

## Definition of Done
- Duplicate idempotency key does NOT double-post.
- Adapter failure yields a typed error and leaves no orphaned persisted reply.

**Role focus:** Security, Test Engineer — elevated.
