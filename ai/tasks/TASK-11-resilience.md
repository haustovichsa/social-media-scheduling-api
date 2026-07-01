# TASK-11 — Resilience: rate limiting, retry/backoff, error taxonomy

**Depends on:** TASK-04, TASK-07, TASK-08 · **Difficulty:** Medium · **Order:** 11
**Requirements:** NFR-5, AC-5, RK-2

## Prompt
Harden platform interactions per `execution-plan.md` §3.1.

Do:
- Per-platform rate limiter + exponential backoff around adapter calls (a Nest interceptor or a provider wrapping the adapter).
- Map platform failures (429, expired token, deleted comment) to the typed taxonomy (TASK-04); this feeds the exception filter (TASK-09).
- Ensure no raw platform payload escapes to the client.

## Definition of Done
- A 429 triggers backoff (test with Jest fake timers, `jest.useFakeTimers()`).
- Typed errors surfaced consistently; verified no raw payload leakage.

**Role focus:** Performance, Domain Researcher — elevated.
