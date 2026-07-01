# TASK-14 — Webhook ingestion seam (optional / stretch)

**Depends on:** TASK-05, TASK-07 · **Difficulty:** High · **Order:** 14
**Requirements:** NFR-4, supports NFR-6

## Prompt
Add push-based comment sync where platforms support it, per `execution-plan.md` §3.5.

Do:
- Signed webhook endpoint that verifies the platform signature.
- On valid payload, normalize (reuse TASK-05 mappers) and upsert comments into the
  canonical store.
- Reject invalid signatures; keep it a thin seam over existing normalization.

## Definition of Done
- Verified payload upserts canonical rows.
- Invalid signature is rejected (test).
- Only implement if core path (TASK-01–13) is complete and time remains.

**Role focus:** Security — elevated.
