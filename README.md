# social-media-scheduling-api

A multi-platform **comment system** for a social-media scheduling API. It does
two things across many platforms (Facebook, Instagram, LinkedIn, X, …) behind
one shared interface:

- **Read** the comments on an already-published post (`GET /posts/:postId/comments`).
- **Reply** to a comment (`POST /comments/:commentId/replies`).

Built with **NestJS · MongoDB · @nestjs/mongoose · Jest · class-validator**.

> - **Design decisions, trade-offs & assumptions:** [`DESIGN.md`](DESIGN.md)
> - **How to add a new platform:** [`src/platforms/README.md`](src/platforms/README.md)
> - **Full requirements → task breakdown:** [`ai/execution-plan.md`](ai/execution-plan.md)

---

## How it works, in one paragraph

Everything platform-specific lives behind a single `PlatformAdapter` interface;
services depend only on an `AdapterRegistry`, never on a concrete platform, so
adding a platform means writing one adapter class and registering it — no core
code changes (NFR-1). Comments are cached in our own MongoDB in one shared
format and refreshed from the platform on read; replies are sent to the platform
first and only then persisted. Every request is tenant-scoped and platform
failures are mapped to a documented error taxonomy. Production concerns that the
brief only asked us to *design* — freshness/background sync, idempotent replies,
per-platform rate-limiting/retry, and a real secret manager — are called out as
seams in [`DESIGN.md`](DESIGN.md) rather than fully built. See it for the
reasoning behind each choice.

---

## Getting started

### Prerequisites

- Node.js 20+ and npm
- A reachable MongoDB instance (v6/7)

### Install

```bash
npm install
```

### Configure MongoDB

The service needs a MongoDB connection string in `MONGODB_URI`. For local
development, the quickest option is Docker:

```bash
docker run -d --name sms-mongo -p 27017:27017 mongo:7
```

Then copy the example env file and adjust as needed:

```bash
cp .env.example .env
```

The tests do **not** need this — they spin up an in-memory MongoDB
(`mongodb-memory-server`) automatically, so `npm test` runs with no external
database.

### Run

```bash
npm run dev            # start with watch mode (recommended for development)
npm start              # start once
npm run build && npm run start:prod   # compiled production start
```

On boot the environment is validated (see `src/config/env.validation.ts`); a
missing or malformed variable fails fast with a clear message rather than
surfacing later at runtime.

Verify it is up:

```bash
curl localhost:3000/health        # → { "status": "ok" }
```

### API docs (OpenAPI / Swagger)

Once running, interactive API documentation is served at:

```
http://localhost:3000/docs
```

---

## Configuration

Environment variables (validated at boot):

| Variable          | Default                                            | Description                                                                 |
| ----------------- | -------------------------------------------------- | --------------------------------------------------------------------------- |
| `NODE_ENV`        | `development`                                      | `development` \| `test` \| `production`                                     |
| `PORT`            | `3000`                                             | HTTP server port                                                            |
| `MONGODB_URI`     | —                                                  | MongoDB connection string (required)                                        |
| `SOCIAL_API_KEYS` | —                                                  | Dev-only auth: comma-separated `apiKey:orgId` pairs (see **Authentication**) |

### Authentication (development)

Requests are tenant-scoped. Callers present a bearer token:

```
Authorization: Bearer <apiKey>
```

In development the key is resolved to an org via `SOCIAL_API_KEYS`
(`devkey-org1:org-1,devkey-org2:org-2`). This is a stub `CallerResolver` meant
to be replaced by a real authenticator in production — the guard, the
`orgId`-scoping, and the ownership model do not change when it is. A missing or
unknown key → `401`; a resource in another tenant is indistinguishable from a
missing one → `404` (we never leak existence). See [`DESIGN.md`](DESIGN.md#9-security--multi-tenancy).

---

## Using the API

**List a post's comments** (paged, one shared shape regardless of platform):

```bash
curl -H "Authorization: Bearer devkey-org1" \
  "localhost:3000/posts/<postId>/comments?limit=20&cursor=<opaqueCursor>"
```

Returns a page of comments plus an opaque `nextCursor` (`null` = end of list)
and a `syncedAt` freshness stamp.

**Reply to a comment:**

```bash
curl -X POST -H "Authorization: Bearer devkey-org1" \
  -H "Content-Type: application/json" \
  -d '{"text":"Thanks for the feedback!"}' \
  "localhost:3000/comments/<commentId>/replies"
```

The reply is written through to the platform first, then persisted. Making a
retried send safe (at-most-once via an idempotency key) is designed but not
built — see [`DESIGN.md`](DESIGN.md#4-replies-are-write-through).

Platform problems (throttling, expired token, deleted comment) come back as
documented HTTP errors in a consistent envelope, never as raw platform responses
or 500s. See the error taxonomy in [`DESIGN.md`](DESIGN.md#7-error-taxonomy-mapped-at-one-edge).

---

## Scripts

| Script             | Purpose                                  |
| ------------------ | ---------------------------------------- |
| `npm run build`    | Compile TypeScript to `dist/`            |
| `npm run dev`      | Start in watch mode                      |
| `npm start`        | Start once                               |
| `npm run start:prod` | Run the compiled build                 |
| `npm run lint`     | ESLint (zero warnings allowed)           |
| `npm run format`   | Prettier                                 |
| `npm test`         | Unit + integration tests (Jest)          |
| `npm run test:cov` | Tests with coverage                      |
| `npm run test:e2e` | End-to-end HTTP tests (supertest)        |

## Testing

Tests run with no external services — an in-memory MongoDB is started per suite.
The suite covers the main read and reply paths plus edge cases (empty/paged
reads, cross-org access → 404, the platform error taxonomy → HTTP mapping), and
a **reusable adapter contract test** that every platform adapter must pass — the
mechanism that keeps the extension point honest as platforms are added.

```bash
npm test
```

## Project layout

```
src/
  comments/      Read & reply services, repository, controller, DTOs, error types
  platforms/     The extension point: adapter interface, registry, adapters,
                 shared fetched shapes, opaque cursor + thread-depth helpers
    adapters/    mock/ — the reference adapter exercising the full contract
  domain/        Platform-free canonical types (Comment, Reply, Page, Author)
  persistence/   @nestjs/mongoose schemas (platform accounts, posts, comments)
  credentials/   TokenProvider interface + env-backed stub (tokens never leak, RK-6)
  auth/          Auth guard + caller resolver (tenant scoping)
  common/        Platform enum, HTTP error filter & envelope, decorators
  config/        Env validation
  health/        Liveness route
```

---

## How AI tools were used

This project was built AI-assisted, end to end, in a plan-then-execute flow:

1. **Planning.** A multi-role planning prompt (`ai/master-prompt-to-start.md`)
   was run against the take-home brief (`ai/take-home-task.md`) to produce
   [`ai/execution-plan.md`](ai/execution-plan.md) — the requirements analysis,
   architecture, trade-off table, and a dependency-ordered task breakdown.
2. **Execution.** Each task has a self-contained prompt in `ai/tasks/`
   (`TASK-01…TASK-14`). Tasks were implemented one at a time, each as its own
   reviewed commit (see `git log`), so every change traces back to a requirement.
3. **Author's role.** AI generated code, tests, and docs; the author set the
   stack and scope, confirmed the assumptions in [`DESIGN.md`](DESIGN.md), steered
   trade-offs, and reviewed every diff. All output was verified with `build`,
   `lint`, and the test suite before commit.
