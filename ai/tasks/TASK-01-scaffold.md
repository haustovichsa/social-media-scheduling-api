# TASK-01 — Project scaffold & tooling

**Depends on:** none · **Difficulty:** Low · **Order:** 1
**Requirements:** foundation for FR-7

## Prompt
Bootstrap a runnable TypeScript service skeleton for a multi-platform social-media comment
system, following `execution-plan.md`. Stack: NestJS · MongoDB · @nestjs/mongoose · Jest.

Do:
- Initialize a NestJS project (`nest new`, strict tsconfig).
- Confirm ESLint + Prettier (Nest ships these); wire Jest (unit) + `@nestjs/testing` + supertest (e2e).
- Add `@nestjs/mongoose` (`MongooseModule.forRoot`) with a Mongo connection and `@nestjs/config`
  for `.env`/`.env.example` handling.
- Establish the module structure (`AppModule` + feature modules) — Nest DI is the composition root;
  no hand-wired container needed.
- Add a `GET /health` route (controller, or `@nestjs/terminus`) returning `{ status: "ok" }`.
- Provide npm scripts: `build`, `lint`, `test`, `dev`.

## Definition of Done
- `npm run build`, `npm run lint`, `npm test` all pass.
- App boots and connects to Mongo; `GET /health` responds 200.
- No business logic yet — scaffold + module skeleton only.

**Role focus:** Senior Implementer. (Security/Performance skipped for this task.)
