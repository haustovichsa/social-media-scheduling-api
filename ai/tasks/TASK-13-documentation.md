# TASK-13 — Documentation & design-decisions writeup

**Depends on:** TASK-09 (polish after TASK-12) · **Difficulty:** Low · **Order:** 13
**Requirements:** FR-6, FR-8

## Prompt
Write the docs that satisfy the take-home rubric per `execution-plan.md` §2.5 / §3.5.

Do:
- `README.md`: how to install, configure Mongo, run, and test (NestJS/MongoDB/@nestjs/mongoose/Jest).
- `DESIGN.md`: major design decisions + trade-offs (adapter pattern, NestJS module/provider DI,
  cache-and-sync, single-collection referenced threading in MongoDB, idempotency, error taxonomy).
- Assumptions log (from execution-plan §2.5).
- "How to add a new platform" guide.
- A short "How AI tools were used" note (task requests this).

## Definition of Done
- A reviewer can run the project and understand every major decision + assumption.

**Role focus:** Documentation — elevated.
