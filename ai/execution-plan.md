# Execution Plan — Multi-Platform Comment System

> Built by running the planning framework (`ai/master-prompt-to-start.md`) against the take-home task (`ai/take-home-task.md`).

---

## 1. Executive Summary

We are building a comment system for a social-media scheduling API that works with several platforms. It does two things: **read the comments on a post that is already published**, and **post a reply to a comment**. Both are exposed over a **REST API**, and it should work across platforms like Facebook, Instagram, LinkedIn, and X.

The main idea: **one adapter per platform**, so we can add a new platform later without changing the core code. All comments are stored in our own database in **one shared format**; replies are sent straight to the platform and then saved. Keep in mind the platforms own the comment data — their APIs are rate-limited, paged, and each returns a different shape.

Stack: **TypeScript / NestJS / MongoDB / @nestjs/mongoose / Jest**.

**Confidence: High** on the overall shape, the task breakdown, and the stack. **Medium** on how we pull comments in (on-demand vs webhooks) — that is a design choice, not a blocker.

**Readiness: Conditional go** — nothing is blocking. We proceed on the assumptions listed in §7.

---

## 2. Requirements Analysis (Phase 1)

### 2.1 Functional Requirements

| ID | Requirement | Source |
|---|---|---|
| FR-1 | Read comments for a **published** post | Task |
| FR-2 | Reply to a comment | Task |
| FR-3 | Support **many** social platforms through one shared interface | Task |
| FR-4 | Expose FR-1/FR-2 through a **REST API** | Task |
| FR-5 | Provide a **database schema** for comments/replies/posts | Task ("Please provide") |
| FR-6 | Provide an **API design** (endpoints, contracts) | Task |
| FR-7 | Provide **TypeScript code** (partial implementation) | Task |
| FR-8 | Explain the **main design decisions** and write down assumptions | Task |

### 2.2 Non-Functional Requirements

| ID | Requirement | Notes |
|---|---|---|
| NFR-1 | **Easy to extend** — add a platform without changing core code | Called out directly: "expected to support more in the future" |
| NFR-2 | **Simple and easy to maintain** | Goal from the planning framework |
| NFR-3 | **Easy to test** — adapters and services can be tested on their own with mocks | |
| NFR-4 | **Secure** — each account has its own credentials, check ownership on posts/comments, never leak tokens | |
| NFR-5 | **Reliable and fast** — respect platform rate limits, retry with backoff, use paging | Platform APIs are the bottleneck |
| NFR-6 | **Clear data model** — be clear about our local copy vs the platform's live data | Design decision, see §3 |

### 2.3 Acceptance Criteria

- AC-1: Reading comments for a published post returns a paged list in one shared format, no matter the platform.
- AC-2: Replying to a comment sends the reply to the platform and returns it in the shared format.
- AC-3: Adding a new platform means writing one new adapter and registering it — nothing else changes.
- AC-4: A request for a post or comment the caller does not own is rejected.
- AC-5: Platform problems (rate limit, expired token, deleted comment) come back as clear, documented API errors — never as raw platform responses or 500s.
- AC-6: The repo contains: the schema, the REST/OpenAPI design, working TypeScript for the main path plus at least one real adapter, and a design-decisions/assumptions doc.

### 2.4 Constraints

- C-1: Comments and replies **live on the external platform**; our service is a client, not the owner of the data.
- C-2: Each platform is different — **auth, data shape, paging, nesting depth, and rate limits** all vary.
- C-3: Scope is **design + partial implementation**; not every platform has to be fully built.
- C-4 *(assumed)*: There was no existing stack to match — this is a fresh project (no `STACK:` given).

### 2.5 Assumptions

| # | Assumption | Confidence | Label |
|---|---|---|---|
| A-1 | Stack = TypeScript + NestJS + MongoDB + @nestjs/mongoose + Jest + class-validator (**confirmed by user**) | High | *confirmed* |
| A-2 | A "published post" already exists in the scheduling system, with its platform and external post id stored | High | *assumed* |
| A-3 | Each account's OAuth credentials already exist and are managed elsewhere; this feature just reads them through a token provider | Medium | *assumed* |
| A-4 | Reads come from a **local copy** that we keep fresh by refreshing on demand and in the background; replies go to the platform first, then we save them | Medium | *assumed design decision* |
| A-5 | We model threads with a `parentCommentId` pointer; each adapter enforces the platform's max nesting depth | High | *assumed* |
| A-6 | Multi-tenant: posts and comments belong to an org/user, and we check ownership on every request | High | *assumed* |
| A-7 | Audience = engineers reviewing a take-home | High | *assumed* |

### 2.6 Missing Info / Clarification Questions

See §7. None are **blocking** — the task says details are left open on purpose and asks us to write down assumptions.

### 2.7 Initial Risks

| ID | Risk | First Mitigation |
|---|---|---|
| RK-1 | Platform differences leak into the core code and break NFR-1 | Strict adapter interface + one shared model; the core never sees platform types |
| RK-2 | Rate limits or expired tokens cause failures under load | Per-platform rate limiter, backoff, a token-refresh hook, typed errors |
| RK-3 | Stale cache — users see old comments | Set a clear rule (A-4): refresh on demand and show `syncedAt` |
| RK-4 | A reply gets posted twice on retry | Idempotency key + a reply outbox to catch duplicates |
| RK-5 | Building too much for a take-home (too many platforms) | Build the interface + 1 real adapter and a Mock; leave the rest as the interface only |
| RK-6 | Tokens leak into logs or responses | A token provider, never save secrets in output, hide them in logs |

### Decision Gate → **PROCEED**

Nothing is blocking. The consistency choice and the stack are assumptions, not things we need answered before we can order the work. Move on to Phase 2.

---

## 3. Architecture Proposal (Phase 2)

### 3.1 Components & Responsibilities

| Component | Responsibility |
|---|---|
| **REST API layer** (Nest controllers) | HTTP endpoints, DTO validation (`ValidationPipe`), auth/ownership guards, exception-filter error mapping, OpenAPI |
| **Comment service** (`@Injectable` provider) | Runs the read and reply flows; talks to the database and adapters; decides when to refresh |
| **Platform adapter interface** | The contract every platform implements: `getComments`, `replyToComment`, plus mapping and cursor handling |
| **Adapter registry** (Nest module + providers) | Picks the right adapter by platform via DI; this is the one place you plug in a new platform |
| **Concrete adapters** | Facebook / Instagram / … plus a Mock adapter for tests and local runs; convert platform data ⇄ shared format |
| **Shared domain model** | Platform-free types: `Comment`, `Reply`, `PageCursor`, `Author` |
| **Persistence (@nestjs/mongoose models/repositories)** | Local MongoDB store for posts, comments, sync state, and the reply outbox |
| **Token provider** (injectable provider) | Gives out and refreshes each account's platform token; backed by a secret store |
| **Cross-cutting**: rate limiter, retry/backoff (interceptors/providers), typed errors, auth guards | Applied per platform / per request |

### 3.2 Why This Shape (the extension point)

```
                  Nest Controllers
                       │
                Comment Service ──── Repositories ──── MongoDB (@nestjs/mongoose)
                       │                                  ▲
         Adapter Registry (DI provider map)       (shared-format documents)
                 │      │      │
            Facebook  Insta  Mock   ← add a new platform = new adapter provider + register in the platforms module
              │        │      │
        ┌─────┴────────┴──────┴─────┐
        │  Platform APIs (external)  │  ← the real owner of the comments
        └────────────────────────────┘
```

Adding a platform (NFR-1 / AC-3) only means **one new adapter provider and one line to register it in the platforms module**.

### 3.3 Data Flow

**Read (FR-1):** `GET /posts/:id/comments` → check ownership → Comment service → read from our database; if the data is missing or stale, call the adapter → `adapter.getComments(externalPostId, cursor)` → convert to shared format → save → return a paged result plus `syncedAt`.

**Reply (FR-2):** `POST /comments/:id/replies` → check ownership and validate → Comment service → check the outbox for duplicates → call the adapter → `adapter.replyToComment(externalCommentId, body)` → convert the new reply → save → return it in shared format.

### 3.4 Technology Choices (confirmed by user; see A-1)

| Choice | Why | Notes |
|---|---|---|
| TypeScript | Task asks for "TypeScript code" | — |
| NestJS | Built-in DI, modules, guards, pipes, filters, interceptors — the adapter registry and cross-cutting concerns map straight onto framework primitives (no manual wiring) | confirmed |
| MongoDB | Documents fit comment data that differs from platform to platform | confirmed |
| @nestjs/mongoose | Native Nest ODM: `@Schema()`/`@Prop()` classes with DI-injectable models, so schema and indexes are type-safe | confirmed |
| Jest + @nestjs/testing + supertest | Nest's default test stack; `Test.createTestingModule` for DI-based mocking, plus HTTP tests | confirmed |
| class-validator + class-transformer | Decorator-based DTO validation via the global `ValidationPipe`; also feeds `@nestjs/swagger` | confirmed |
| @nestjs/swagger | Decorator-driven OpenAPI generation | confirmed |

### 3.5 Trade-offs (where the roles disagree)

| Question | The two sides | What we do |
|---|---|---|
| **Call the platform every time vs keep a local copy** | *Senior Implementer*: calling every time is simplest (no database). *Performance/QA*: but it hits rate limits again and again, paging isn't stable, and you can't read when the platform is down. | **Keep a local copy (A-4)**: read from our database, refresh on demand and in the background. A bit more code, but much better for rate limits and reliability. |
| **Framework DI (NestJS) vs manual wiring** | *Senior Implementer*: a minimal framework (Express) stays small and explicit. *Code Reviewer/Test Engineer*: hand-wiring the registry and auth invites hidden globals and harder testing. | **Use NestJS DI**: a `PlatformsModule` provides the adapter registry, services are `@Injectable` providers, and constructor injection makes mocking trivial in `Test.createTestingModule`. No composition-root file to maintain. |
| **One `comments` collection (with a pointer) vs replies nested inside** | *Domain Researcher*: platforms nest to different depths; deeply nesting replies inside one document hits Mongo's size limit and makes paging hard. *Performance*: arrays that can grow forever are a bad idea. | **One `comments` collection with a `parentCommentId` pointer** (referenced, not nested); each adapter enforces the platform's depth (A-5); index `{ postId, platformCreatedAt }`. |
| **Webhooks vs polling for new comments** | *Domain Researcher*: Facebook/Instagram support webhooks; others need polling. | Build for **on-demand pull now**, and leave a spot to add webhooks later (optional TASK-14). |
| **Making replies safe to retry** | *Test/Security*: a retry can post the same reply twice. | Idempotency key + a **reply outbox** to catch duplicates (RK-4). |

---

## 4. Execution Plan (Phase 3)

Small tasks that can each be built and reviewed on their own. Suggested order in `Order`. Ready-to-run per-task prompts live in `ai/tasks/`.

### TASK-1: Project setup & tooling
**Objective:** Get a working TypeScript service skeleton with test tools and a Mongo connection.  
**Description:** Set up a NestJS + TypeScript app (`nest new`), strict TS config, linting, Jest, the `@nestjs/mongoose` connection (`MongooseModule.forRoot`), `@nestjs/config` for `.env` handling, the root/feature module structure, and a health route so the later tasks have a place to live.  
**Dependencies:** None.  
**Inputs:** A-1 stack (NestJS/MongoDB/@nestjs/mongoose/Jest).  
**Outputs:** `package.json`, tsconfig, the Nest bootstrap (`main.ts` + `AppModule`), the Mongoose connection module, feature-module skeleton, and `test`/`build` scripts that run in CI.  
**Definition of Done:** `build`, `lint`, `test` all pass; the app starts; the health route responds.  
**Difficulty:** Low · **Order:** 1  
**Role exceptions:** Security — Skip · Performance — Skip.  

### TASK-2: Data model & collections
**Objective:** Define the `@nestjs/mongoose` models for posts, comments, sync state, and the reply outbox.  
**Description:** `@Schema()`/`@Prop()` classes for `PlatformAccount`, `Post`, `Comment` (with a self-pointing `parentCommentId`, and a unique index on `{ platform, externalCommentId }`), `SyncState`, and `ReplyOutbox`. Add an index on `{ postId, platformCreatedAt }` and a unique index on `reply_outbox.idempotencyKey`.  
**Dependencies:** TASK-1.  
**Inputs:** §3.3, A-2, A-5.  
**Outputs:** `@nestjs/mongoose` schema classes, index definitions, and a short note on the relationships.  
**Definition of Done:** Models compile and create their indexes on connect; uniqueness and threading checked against a local or in-memory Mongo; explained in model comments.  
**Difficulty:** Medium · **Order:** 2  
**Role exceptions:** Performance — Elevated (index/paging design); Domain Researcher — Elevated (threading model).  

### TASK-3: Shared domain model & DTOs
**Objective:** Define the platform-free types and the API request/response types.  
**Description:** `Comment`, `Reply`, `Author`, `PageCursor`, and request/response DTOs decorated with `class-validator`. No platform-specific field crosses this line.  
**Dependencies:** TASK-2.  
**Inputs:** FR-1/FR-2, NFR-1.  
**Outputs:** domain types, DTOs, validation decorators.  
**Definition of Done:** Types compile; validation rejects bad input; no platform-specific field is present.  
**Difficulty:** Low · **Order:** 3  
**Role exceptions:** —  

### TASK-4: Platform adapter interface + registry
**Objective:** Build the single place where platforms plug in.  
**Description:** The `PlatformAdapter` interface (`getComments`, `replyToComment`, capabilities), plus a registry (provided via a `PlatformsModule` using Nest DI) that picks an adapter by platform. Define the set of typed errors adapters must throw.  
**Dependencies:** TASK-3.  
**Inputs:** NFR-1, AC-3, §3.2.  
**Outputs:** interface, registry, error types.  
**Definition of Done:** The registry registers and finds adapters; an unknown platform returns a typed error; "how to add a platform" is written down.  
**Difficulty:** Medium · **Order:** 4  
**Role exceptions:** Code Reviewer — Elevated (this is the most important part for keeping the code clean).  

### TASK-5: First adapter(s) with mapping
**Objective:** Build one real adapter plus a Mock adapter.  
**Description:** A Mock adapter (predictable, for tests and demos) and one real-ish adapter (for example, Facebook Graph) that maps platform comments and cursors to and from the shared format, including paging and nesting depth.  
**Dependencies:** TASK-4.  
**Inputs:** platform API docs, §3.5 threading decision.  
**Outputs:** `MockAdapter`, `FacebookAdapter` (partial), mapping functions.  
**Definition of Done:** The Mock passes the adapter contract tests; mapping handles nested replies and round-trips the cursor.  
**Difficulty:** Medium · **Order:** 5  
**Role exceptions:** Domain Researcher — Elevated (getting the external API right).  

### TASK-6: Token provider
**Objective:** Give adapters each account's platform token without leaking secrets.  
**Description:** A `TokenProvider` (get + refresh) backed by a stub secret store; helpers to hide tokens; never put them in responses or logs.  
**Dependencies:** TASK-4.  
**Inputs:** A-3, NFR-4, RK-6.  
**Outputs:** the token provider interface + a stub, a redaction helper.  
**Definition of Done:** Tokens are only read through the provider; a search shows no token in logs or responses; a test exercises the refresh path.  
**Difficulty:** Medium · **Order:** 6  
**Role exceptions:** Security — Elevated.  

### TASK-7: Read-comments service
**Objective:** Serve FR-1 using the local-copy rule.  
**Description:** Read from our database; if the data is missing or stale (per A-4), refresh through the adapter, save, and return a paged result plus `syncedAt`. Cursor paging all the way through.  
**Dependencies:** TASK-5, TASK-6.  
**Inputs:** FR-1, A-4, NFR-5/6.  
**Outputs:** `CommentService.getComments`.  
**Definition of Done:** Returns paged results in shared format; both the refresh path and the cached path have unit tests; ownership is checked (via TASK-10).  
**Difficulty:** Medium · **Order:** 7  
**Role exceptions:** Performance — Elevated; QA — Elevated (paging edge cases).  

### TASK-8: Reply service (send + safe retries)
**Objective:** Serve FR-2 safely.  
**Description:** Check the outbox for duplicates → send the reply through the adapter → save the new reply → return it in shared format. Handle partial failure and retries.  
**Dependencies:** TASK-5, TASK-6.  
**Inputs:** FR-2, RK-4.  
**Outputs:** `CommentService.replyToComment`, outbox logic.  
**Definition of Done:** The same idempotency key does not post twice; an adapter failure returns a typed error and leaves no leftover record.  
**Difficulty:** Medium · **Order:** 8  
**Role exceptions:** Security — Elevated; Test Engineer — Elevated.  

### TASK-9: REST endpoints + OpenAPI
**Objective:** Expose FR-1/FR-2 as documented REST endpoints.  
**Description:** Nest controllers for `GET /posts/:postId/comments` (paging params) and `POST /comments/:commentId/replies`; DTO validation (`ValidationPipe`), an exception filter mapping the typed taxonomy (AC-5), and `@nestjs/swagger` OpenAPI docs.  
**Dependencies:** TASK-7, TASK-8.  
**Inputs:** FR-3/FR-4, FR-6, §3.3.  
**Outputs:** Nest controllers, exception filter, OpenAPI spec.  
**Definition of Done:** Endpoints return the shared format; OpenAPI is generated; platform problems map to documented HTTP codes.  
**Difficulty:** Medium · **Order:** 9  
**Role exceptions:** Documentation — Elevated.  

### TASK-10: Auth & ownership guards
**Objective:** Make sure callers only touch their own org's posts and comments (AC-4).  
**Description:** A Nest auth guard that finds the caller's org; ownership checks on the post and comment (guard + helper); reject otherwise. Applied via `@UseGuards` on both routes.  
**Dependencies:** TASK-2, TASK-3.  
**Inputs:** A-6, NFR-4, AC-4.  
**Outputs:** auth + ownership guards, an ownership-check helper.  
**Definition of Done:** Cross-org access returns 403/404; covered by tests; applied to both endpoints.  
**Difficulty:** Medium · **Order:** 10 (can start after TASK-3; must be in before TASK-9 ships)  
**Role exceptions:** Security — Elevated.  

### TASK-11: Reliability — rate limiting, retry/backoff, typed errors
**Objective:** Keep platform limits and failures from turning into our API failures (NFR-5, AC-5).  
**Description:** A per-platform rate limiter and exponential backoff around adapter calls; turn platform problems (429, expired token, deleted comment) into our typed errors.  
**Dependencies:** TASK-4, TASK-7, TASK-8.  
**Inputs:** RK-2, §3.1.  
**Outputs:** rate limiter, retry wrapper, error mapper.  
**Definition of Done:** A 429 triggers backoff (test with fake timers); typed errors come through; no raw platform response leaks out.  
**Difficulty:** Medium · **Order:** 11  
**Role exceptions:** Performance — Elevated; Domain Researcher — Elevated.  

### TASK-12: Test suite
**Objective:** Show it works and that the adapter contract holds.  
**Description:** Unit tests (services, mapping, registry), one reusable **adapter contract test** every platform must pass, and API tests through supertest against the Mock adapter.  
**Dependencies:** TASK-9, TASK-10, TASK-11.  
**Inputs:** NFR-3, all ACs.  
**Outputs:** test suites, the contract-test harness.  
**Definition of Done:** Main paths plus edge cases (empty, paged, stale, duplicate reply, cross-org, rate limit) are covered; the suite passes.  
**Difficulty:** Medium · **Order:** 12  
**Role exceptions:** Test Engineer — Elevated; QA — Elevated.  

### TASK-13: Docs & design writeup
**Objective:** Cover FR-6/FR-8 and what the take-home asks for.  
**Description:** A README (how to run and test), a design doc (the trade-offs from §3.5), the assumptions list, a "how to add a platform" guide, and a short "how I used AI tools" note.  
**Dependencies:** TASK-9 (design settled); polish after TASK-12.  
**Inputs:** FR-8, §2.5, §3.5.  
**Outputs:** `README.md`, `DESIGN.md`, the assumptions section.  
**Definition of Done:** A reviewer can run it and understand every main decision and assumption.  
**Difficulty:** Low · **Order:** 13  
**Role exceptions:** Documentation — Elevated.  

### TASK-14 (optional/stretch): Webhook intake
**Objective:** Support getting comments by webhook (push) where the platform allows it.  
**Description:** A signed webhook endpoint that saves incoming comments into our database, reusing the same mapping. Leave it as a stub if time is short.  
**Dependencies:** TASK-5, TASK-7.  
**Inputs:** §3.5 (webhooks vs polling).  
**Outputs:** webhook controller, signature check.  
**Definition of Done:** A verified payload is saved; an invalid signature is rejected.  
**Difficulty:** High · **Order:** 14  
**Role exceptions:** Security — Elevated.  

---

## 5. Traceability Matrix

| Requirement | Covered by |
|---|---|
| FR-1 Read comments | TASK-7, TASK-9, TASK-2, TASK-5 |
| FR-2 Reply to comment | TASK-8, TASK-9, TASK-5 |
| FR-3 Many platforms | TASK-4, TASK-5 |
| FR-4 REST API | TASK-9, TASK-10 |
| FR-5 DB schema | TASK-2 |
| FR-6 API design | TASK-9, TASK-13 |
| FR-7 TypeScript code | TASK-1,3,4,5,6,7,8,9,10,11 |
| FR-8 Design decisions/assumptions | TASK-13, §3.5, §2.5 |
| NFR-1 Easy to extend | TASK-4, TASK-5, TASK-12 (contract test) |
| NFR-2 Maintainable | TASK-3, TASK-4 |
| NFR-3 Testable | TASK-12 |
| NFR-4 Secure | TASK-6, TASK-10, TASK-14 |
| NFR-5 Reliable/fast | TASK-11, TASK-7 |
| NFR-6 Clear data model | TASK-7, TASK-13 |

No leftover tasks; every requirement is covered by at least one task.

---

## 6. Risks and Mitigations (rechecked after Phase 4)

| ID | Risk | Level (change) | Mitigation / Owner task |
|---|---|---|---|
| RK-1 | Platform differences leak into the core | **Lower** ↓ (TASK-3/4 keep them out) | Shared model + adapter interface |
| RK-2 | Rate limits / expired tokens | Same | TASK-11, TASK-6 |
| RK-3 | Stale cache | **Lower** ↓ (`syncedAt` + refresh-on-demand rule) | TASK-7, TASK-13 |
| RK-4 | Reply posted twice | **Lower** ↓ (outbox) | TASK-8 |
| RK-5 | Building too much | **Higher** ↑ — 14 tasks make it tempting to over-build | Time-box: ship TASK-1–9, 12, 13 with the Mock + 1 adapter; TASK-14 optional |
| RK-6 | Secret leakage | Same | TASK-6, TASK-10 |
| RK-7 *(new)* | Adapter contract drifts as platforms are added | New (Low) | The reusable contract test in TASK-12 |

**Can run in parallel:** groundwork for TASK-3 and TASK-10 after TASK-2; TASK-5 and TASK-6 after TASK-4; TASK-13 docs alongside the build. **Critical path:** 1 → 2 → 3 → 4 → 5 → 7/8 → 9 → 12.

---

## 7. Clarification Questions

**Blocking:** None.

**Non-blocking (we proceed on assumptions; confirm to refine):**
1. Stack — **confirmed: NestJS / MongoDB / @nestjs/mongoose / Jest / class-validator** (A-1). ✔
2. Which platforms should be fully built vs interface-only? (assumed: Mock + 1 real — A-1/RK-5)
3. Is refresh-on-demand plus background sync fine, or do you need to call the platform live every time? (assumed local copy — A-4)
4. Are each account's OAuth tokens already handled elsewhere? (assumed yes — A-3)
5. What is the ownership model, and who is the "caller"? (assumed org-scoped — A-6)

---

## 8. Final Readiness Assessment

**CONDITIONAL GO.**

Why: The task is clearly scoped and has nothing blocking. The details left open on purpose are covered by clear, low-risk assumptions (§2.5) — which is what the task asks for. The design meets the main requirement — support many platforms now and more later — through the adapter and registry. Every requirement maps to a task, and the order has no circular dependencies. The main risk is building too much (RK-5), so the condition is to **time-box to the core path (TASK-1–9, 12, 13) with one real adapter plus the Mock**, and treat TASK-11 hardening and TASK-14 webhooks as stretch. Then start building.
