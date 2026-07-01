# Runnable Sub-Tasks

Each `TASK-XX-*.md` is a self-contained prompt you can run **one at a time** in Claude Code
to execute that step of `../execution-plan.md`. Run them in `Order`.

**Recommended core path (time-boxed):** 1 → 2 → 3 → 4 → 5 → 6 → 7 → 8 → 10 → 9 → 11 → 12 → 13.
**Optional/stretch:** 14.

**How to run one:** open the file and paste its "Prompt" section, or reference it, e.g.
`Run ai/tasks/TASK-02-data-model.md`.

Stack (confirmed): TypeScript · NestJS · MongoDB · @nestjs/mongoose · Jest · class-validator (see execution-plan §2.5 / §3.4).

| Order | Task | Difficulty | Depends on |
|---|---|---|---|
| 1 | TASK-01 Project scaffold & tooling | Low | — |
| 2 | TASK-02 Data model & collections | Medium | 1 |
| 3 | TASK-03 Canonical model & DTOs | Low | 2 |
| 4 | TASK-04 Adapter interface + registry | Medium | 3 |
| 5 | TASK-05 Reference adapter(s) | Medium | 4 |
| 6 | TASK-06 Token provider | Medium | 4 |
| 7 | TASK-07 Comment retrieval service | Medium | 5,6 |
| 8 | TASK-08 Reply service | Medium | 5,6 |
| 9 | TASK-09 REST controllers + OpenAPI | Medium | 7,8 |
| 10 | TASK-10 AuthZ guard | Medium | 2,3 |
| 11 | TASK-11 Resilience | Medium | 4,7,8 |
| 12 | TASK-12 Test suite | Medium | 9,10,11 |
| 13 | TASK-13 Documentation | Low | 9 |
| 14 | TASK-14 Webhook seam (stretch) | High | 5,7 |
