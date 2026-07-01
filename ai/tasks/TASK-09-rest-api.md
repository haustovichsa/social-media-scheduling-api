# TASK-09 — REST controllers + OpenAPI

**Depends on:** TASK-07, TASK-08 (and TASK-10 guard) · **Difficulty:** Medium · **Order:** 9
**Requirements:** FR-4, FR-6, AC-5

## Prompt
Expose the REST API per `execution-plan.md` §3.3.

Do:
- Nest controllers: `GET /posts/:postId/comments` with pagination query params → canonical paginated page.
- `POST /comments/:commentId/replies` with idempotency header → canonical reply.
- Request validation via the global `ValidationPipe` + class-validator DTOs (TASK-03); auth/ownership guards (TASK-10, `@UseGuards`).
- A global exception filter mapping the typed error taxonomy to documented
  HTTP status codes (429, 401/403, 404, 502…).
- Generate OpenAPI docs with `@nestjs/swagger`.

## Definition of Done
- Endpoints return canonical shapes only; no raw platform payloads.
- OpenAPI spec generated; error mapping documented.

**Role focus:** Documentation — elevated.
