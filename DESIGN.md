# Design decisions & trade-offs

This file explains the main design choices behind the comment system, why each
was made, and the assumptions it is built on. It goes together with the
requirements-and-tasks write-up in
[`ai/execution-plan.md`](ai/execution-plan.md) and the guide for adding a
platform in [`src/platforms/README.md`](src/platforms/README.md).

The task left some details open on purpose and asked us to write down our
assumptions. Those are in [§ Assumptions](#assumptions) at the end.

---

## The problem in one line

Read the comments on a published post, and reply to a comment — across many
social platforms (Facebook, Instagram, LinkedIn, X, …). Each platform is
different (login, data shape, paging, how deep replies nest, rate limits), and
each platform **owns the data**. Our service is a client, not the owner.

Everything below comes from those two facts: *many different platforms* and
*we don't own the data*.

---

## Architecture at a glance

```
                      HTTP request (Bearer <apiKey>)
                                    │
                                    ▼
                    ┌───────────────────────────────┐
                    │       CommentController       │   AuthGuard  → 401
                    │ (@UseGuards, ValidationPipe)  │   ↳ resolves orgId
                    └───────────────┴───────────────┘
                                    │  canonical DTOs only
                                    ▼
                    ┌───────────────────────────────┐      ┌──────────────────┐
                    │        CommentService         │      │CommentRepository │──▶ MongoDB
                    │    policy: cache-and-sync,    │─────▶│   (org-scoped    │    posts, comments,
                    │   idempotent write-through    │      │     queries)     │    sync_states, outbox
                    └───────────────┴───────────────┘      └──────────────────┘
                                    │  get(platform)
                                    ▼
                    ┌───────────────────────────────┐
                    │        AdapterRegistry        │   ← the one place a platform plugs in
                    └───────────────┴───────────────┘
                                    │  resolves
                                    ▼
                    ┌───────────────────────────────┐     ┌──────────────────┐
                    │ ResilientAdapter (decorator)  │     │  TokenProvider   │
                    │  rate-limit + retry/backoff   │◀────│ (tokenRef→token) │─▶ secret store
                    └─────┬─────────┬─────────┬─────┘     └──────────────────┘   (tokens never
                          │         │         │                                  leak: RK-6)
                      Facebook    Mock        …       ← concrete PlatformAdapters
                          │         │         │
             ┌────────────┬─────────┬─────────┬───────────┐
             │   Platform APIs (external, own the data)   │
             └────────────────────────────────────────────┘

  Errors: each layer throws a typed PlatformError or domain error. The global
  DomainExceptionFilter at the HTTP edge turns them into one documented error
  shape (AC-5) — no raw platform response or token ever reaches the caller (RK-6).
```

**Read (FR-1)** `GET /posts/:postId/comments` → the guard finds the caller's org
→ the service loads the caller's published post → if the local copy is old, it
refreshes from the platform and saves → it reads one page from Mongo → it returns
the comments in our shared shape plus a `syncedAt` time.

**Reply (FR-2)** `POST /comments/:commentId/replies` → the guard → the service
loads the caller's comment → it claims a row in the outbox by `idempotencyKey`
→ it sends the reply through the adapter → it saves and returns the reply in our
shared shape.

The numbered sections below explain *why* each part looks the way it does.

---

## 1. One adapter per platform (the place to plug in)

**Decision.** All platform-specific code sits behind one `PlatformAdapter`
interface (`getComments`, `replyToComment`, `capabilities`). The services only
know about an `AdapterRegistry` that gives them the right adapter for a platform;
they never import a real adapter. Adding a platform means: write one
`@Injectable` adapter class, and add it to one array in `platforms.module.ts`.

**Why.** The main requirement is "support many platforms now and add more later,
without changing the core code" (NFR-1, AC-3). A firm interface plus one shared
model with no platform fields (`Comment`, `Reply`, `Page`, `Author`) keeps each
platform's differences inside its own adapter — they never reach the services or
controllers (RK-1). A shared **adapter contract test** (TASK-12) checks every
platform against the same rules, so this stays true as we add platforms.

**Trade-off.** It adds a layer compared with calling a platform SDK straight from
a service. Worth it: that layer *is* the feature the task asks for, and it lets
us test each adapter on its own with mocks.

See the full "how to add a platform" guide in
[`src/platforms/README.md`](src/platforms/README.md).

## 2. NestJS instead of wiring things by hand

**Decision.** Use NestJS. The registry is a `PlatformsModule` provider; services
are `@Injectable`; auth is a guard; error mapping is an exception filter; input
checking is the global `ValidationPipe`; the OpenAPI docs come from decorators.

**Why.** The shared concerns this design needs — an adapter registry, per-request
auth and ownership, one error mapper, input checking — match NestJS features
directly. So there is no hand-written setup file to keep in sync, and
constructor injection makes everything easy to mock in `Test.createTestingModule`.

**Trade-off.** It is a bigger framework than, say, plain Express. Accepted: the
DI container and clear module boundaries are what keep the plug-in point and the
guards clean.

## 3. Cache-and-sync: keep a local copy, refresh when needed

**Decision.** Reads come from our own MongoDB copy of the comments. On the first
page of a read, if the copy is missing or older than a set window
(`COMMENT_STALE_AFTER_MS`, 60s), we refresh from the platform, save the results,
and stamp `syncedAt`; the response returns that time. The refresh is capped
(`MAX_REFRESH_PAGES`) and continues from a saved platform cursor. A real
deployment would also run a background sync so most reads hit a warm copy; the
hook for that is already there (a per-post `SyncState`).

**Why (instead of calling the platform on every request).** Calling live is
simpler (no store), but it hits the rate limit on every request, can't serve
reads when the platform is down, and gives unstable paging while scrolling. A
local copy is more reliable and much easier on rate limits (NFR-5), and it lets
us page a steady snapshot. We show the caller how fresh the data is with
`syncedAt` (NFR-6, RK-3) instead of pretending it is live.

**Trade-off.** The copy can be a little out of date, and there is more code. We
accept that on purpose and show it. We decide whether to refresh only on page 1,
so one scroll session pages a steady snapshot instead of the list changing
between pages.

## 4. Replies are write-through and safe to retry

**Decision.** A reply is sent at most once. The steps: check ownership → **claim**
an outbox row keyed by the caller's `idempotencyKey` (a unique index) → call the
platform → save the reply it returns. Retrying with the same key never posts
twice: a `sent` key returns the saved reply, a still-`pending` key is refused
with `409 REPLY_IN_PROGRESS`, and if the adapter call fails the claim is released
so a retry can try again — and nothing was saved, so there is no leftover row.

**Why.** Networks and clients retry. Without a dedupe key, a retry would post the
same public reply twice (RK-4). We call the platform *before* saving, so our
store never holds a reply the platform doesn't have. Reads retry on any retryable
error, but a reply retries **only** on a 429 (a throttled request never reached
the platform) — a 5xx or timeout might have created the reply and only lost the
response, so retrying it could post twice.

**Trade-off.** The outbox and the claim/save/release steps add moving parts.
Needed for a public write that can't safely be repeated.

## 5. One `comments` collection, replies linked by a pointer

**Decision.** All comments (including replies) live in one `comments` collection
as flat rows. A reply points at its parent with `parentCommentId`; a top-level
comment has `null`. Each adapter applies its platform's `maxThreadDepth` when
saving, moving replies that are too deep up onto the deepest allowed parent.

**Why.** Platforms nest replies to different depths. Putting replies inside a
parent document builds arrays that can grow without limit and eventually pass
Mongo's 16 MB document size, and it makes paging hard. Flat linked rows can each
be paged on their own and share the same indexes.

**Indexes.** `{ platform, externalCommentId }` unique (the key we save on, so a
refresh updates the row instead of adding a copy); `{ postId, platformCreatedAt }`
(the main read path — steady oldest-first paging); `{ parentCommentId,
platformCreatedAt }` (get the replies under a comment).

**Trade-off.** Showing a deep thread needs several reads instead of one document
read. Fine for how we read (page a post's comments), and it is the only shape
that scales.

## 6. Opaque cursors for paging

**Decision.** Paging uses an opaque `PageCursor` string. The caller passes the
`nextCursor` from one page straight back to get the next one; `null` means the
end (an empty page can still have a next cursor). Each adapter can back it with
whatever the platform uses — a page token, an offset, or a `created_before` time.

**Why.** Platforms page in different ways. An opaque cursor keeps that difference
out of the shared model (NFR-1) and lets each adapter pick what fits.

## 7. All errors mapped in one place

**Decision.** Every adapter turns a platform failure into a `PlatformError`
subclass with a stable `code`; anything else escaping an adapter is a bug. One
global `DomainExceptionFilter` turns all of these into documented HTTP responses
with the same error shape. The original platform error is kept on `cause` for
logs only — it is never put into a response.

**Why.** Platform problems must come back as clear, documented API errors, never
raw platform responses or 500s (AC-5). Mapping in one place keeps the services
and adapters free of HTTP details and stops internals or tokens from leaking
(RK-6).

**Mapping:**

| Condition                                    | Error type                | HTTP | Code                |
| -------------------------------------------- | ------------------------- | ---- | ------------------- |
| Platform throttled us                        | `RateLimitError`          | 429  | `RATE_LIMITED` (+ `Retry-After`) |
| Token expired / revoked                      | `TokenExpiredError`       | 502  | `TOKEN_EXPIRED`     |
| Post/comment gone on the platform            | `ResourceNotFoundError`   | 404  | `RESOURCE_NOT_FOUND`|
| Platform down / 5xx / timeout                | `PlatformUnavailableError`| 502  | `PLATFORM_UNAVAILABLE` |
| Platform failure we can't classify           | `UnknownPlatformError`    | 502  | `PLATFORM_ERROR`    |
| Post not owned / not published               | `PostNotFoundError`       | 404  | `POST_NOT_FOUND`    |
| Comment not owned                            | `CommentNotFoundError`    | 404  | `COMMENT_NOT_FOUND` |
| Reply for this key still in progress         | `ReplyInProgressError`    | 409  | `REPLY_IN_PROGRESS` |
| Missing / invalid credentials                | (guard)                   | 401  | `UNAUTHORIZED`      |
| Bad request body / params                    | (`ValidationPipe`)        | 400  | `VALIDATION_FAILED` |
| No adapter for platform / anything else      | (misconfig / unmapped)    | 500  | `INTERNAL_ERROR` (hidden) |

An expired token maps to `502`, not `401`: it is *our* upstream credential that
failed, not the caller's — a `401` would wrongly tell the caller to log in again.

## 8. Reliability: rate limiting and retry per platform

**Decision.** A `ResilientAdapter` wraps each real adapter and adds two things: a
per-platform rate limiter (token bucket) and retry with backoff. The limiter is
taken *inside* the retry block, so a burst of retries can't itself become a
spike. Reads and writes use different retry rules (writes retry on a 429 only,
per §4).

**Why.** Rate limits and short-lived failures are the failures we expect (RK-2,
NFR-5). Making this a wrapper means no adapter has to build it again, and it stays
invisible above the adapter — the registry stores the wrapped adapter and callers
use it the same way.

## 9. Security & multi-tenancy

**Decision.** Every request is scoped to one tenant. An `AuthGuard` turns the
bearer token into an `orgId` and puts it on the request; every repository query
filters by that `orgId`. So a resource in another tenant looks exactly like a
missing one → **404, not 403** — which means a caller can't probe for what they
don't own. Platform tokens are never stored in our DB, returned, or logged:
`PlatformAccount` holds only an opaque `tokenRef`, and the `TokenProvider` turns
that into a live secret on demand and hands the adapter an `AccessToken` wrapper,
not a plain string.

**Why.** Callers must only touch their own org's data (AC-4, NFR-4), and tokens
must never leak (RK-6). We keep *who you are* (→ 401) separate from *what you can
see* (→ 404), so the guard never needs to load the resource to make that call.

---

## Data model

| Collection          | Purpose                                                                                          | Key indexes |
| ------------------- | ------------------------------------------------------------------------------------------------ | ----------- |
| `platform_accounts` | A connected social account owned by an org; holds `tokenRef`, never the token                    | unique `{ platform, externalAccountId }` |
| `posts`             | A published post; maps our `_id` to the platform's `externalPostId`; the feature only touches `published` posts | unique `{ platform, externalPostId }` |
| `comments`          | Local copy of comments **and** replies, flat, linked by `parentCommentId`                        | unique `{ platform, externalCommentId }`; `{ postId, platformCreatedAt }`; `{ parentCommentId, platformCreatedAt }` |
| `sync_states`       | Per-post refresh bookmark: platform cursor + `lastSyncedAt` (freshness)                           | unique `{ postId }` |
| `reply_outbox`      | Keeps reply sends safe to retry (pending → sent/failed)                                            | unique `{ idempotencyKey }` |

`orgId` is stored on the tenant-owned collections for scoping. `sync_states` is
infrastructure, not tenant data, so it is scoped through its post instead.

---

## Assumptions

Taken from the planning phase (`ai/execution-plan.md` §2.5). None block the work;
each is a sensible default the reviewer can change.

| #   | Assumption                                                                                                         | Confidence |
| --- | ------------------------------------------------------------------------------------------------------------------ | ---------- |
| A-1 | Stack = TypeScript + NestJS + MongoDB + @nestjs/mongoose + Jest + class-validator (**confirmed**)                  | High       |
| A-2 | A "published post" already exists in the scheduling system, with its platform and external post id stored          | High       |
| A-3 | Each account's OAuth credentials already exist and are managed elsewhere; this feature just reads them through a token provider | Medium  |
| A-4 | Reads come from a local copy kept fresh on demand (and by background sync); replies go to the platform first, then are saved | Medium |
| A-5 | Threads use a `parentCommentId` pointer; each adapter applies the platform's max nesting depth                      | High       |
| A-6 | Multi-tenant: posts and comments belong to an org/user, and ownership is checked on every request                   | High       |
| A-7 | Audience = engineers reviewing a take-home                                                                          | High       |

## Scope note

Per the task (design + partial implementation), the build ships the full core
path (read, reply, REST, auth, reliability, tests, docs) with **one real adapter
(Facebook Graph, partial) plus a Mock adapter**. The other platforms are the
interface only — which is the "add a platform = one adapter" idea in action.
Webhook intake (TASK-14) is left as a documented hook
(`capabilities.supportsWebhooks`), not built.
