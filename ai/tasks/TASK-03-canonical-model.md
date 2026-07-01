# TASK-03 — Canonical domain model & DTOs

**Depends on:** TASK-02 · **Difficulty:** Low · **Order:** 3
**Requirements:** FR-1/FR-2, NFR-1/NFR-2

## Prompt
Define the platform-agnostic domain model and API DTOs per `execution-plan.md` §3.

Do:
- Canonical types: `Comment`, `Reply`, `Author`, `PageCursor`, `Platform` enum.
- Request/response DTOs for listing comments (with pagination params) and creating a reply.
- DTOs decorated with class-validator (validated by the global `ValidationPipe`).
- Keep canonical domain types separate from the `@nestjs/mongoose` persistence models (map at the repo boundary).
- Ensure NO platform-specific fields exist in these types — this is the isolation boundary.

## Definition of Done
- Types compile; DTO validation rejects malformed input.
- No leakage of platform-native shapes into canonical types.

**Role focus:** Code Reviewer, Test Engineer.
