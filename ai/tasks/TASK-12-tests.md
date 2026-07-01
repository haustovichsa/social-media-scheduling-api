# TASK-12 — Test suite

**Depends on:** TASK-09, TASK-10, TASK-11 · **Difficulty:** Medium · **Order:** 12
**Requirements:** NFR-3, all ACs

## Prompt
Prove correctness and the adapter contract per `execution-plan.md` §4.

Do (Jest):
- Unit tests: services, normalization mappers, adapter registry (via `Test.createTestingModule` for DI-based mocking).
- A reusable **adapter contract test** every platform adapter must pass (run against MockAdapter).
- API integration tests (supertest) against the Nest app with the Mock adapter; use an
  in-memory / ephemeral Mongo (e.g. `mongodb-memory-server`) for repo-touching tests.
- Cover edge cases: empty results, pagination boundaries, stale-cache refresh,
  duplicate reply (idempotency), cross-tenant access, rate-limit backoff.

## Definition of Done
- All core paths + listed edge cases covered; suite green.
- Contract test is reusable for future adapters.

**Role focus:** Test Engineer, QA — elevated.
