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
                    │  policy: refresh-on-read,     │─────▶│   (org-scoped    │    platform_accounts,
                    │      write-through reply      │      │     queries)     │    posts, comments
                    └───────────────┴───────────────┘      └──────────────────┘
                                    │  get(platform)
                                    ▼
                    ┌───────────────────────────────┐
                    │        AdapterRegistry        │   ← the one place a platform plugs in
                    └───────────────┴───────────────┘
                                    │  resolves
                                    ▼
                    ┌───────────────────────────────┐     ┌──────────────────┐
                    │       PlatformAdapter         │     │  TokenProvider   │
                    │   (rate-limit/retry decorator │◀────│ (tokenRef→token) │─▶ secret store
                    │      is a seam here, §8)      │     └──────────────────┘   (tokens never
                    └─────┬─────────┬─────────┬─────┘                            leak: RK-6)
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
→ the service loads the caller's published post → on the first page it refreshes
from the platform and upserts → it reads one page from Mongo → it returns the
comments in our shared shape plus a `syncedAt` time.

**Reply (FR-2)** `POST /comments/:commentId/replies` → the guard → the service
loads the caller's comment → it sends the reply through the adapter → it persists
and returns the reply in our shared shape.

The numbered sections below explain *why* each part looks the way it does.

> **Scope of the implementation.** The task asked to *design and partially
> implement*. The built core is the full read/reply path across platforms: the
> adapter extension point, the canonical model, REST, tenant-scoped auth, the
> error taxonomy, and a real (Facebook, partial) plus Mock adapter under a shared
> contract test. Four production concerns are **designed here but deliberately
> left as seams** rather than built, each flagged inline below: freshness &
> background sync (§3), at-most-once replies (§4), per-platform
> rate-limiting/retry (§8), and a real secret manager (§9). This keeps the
> reviewable surface small while showing where each concern plugs in.

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

## 3. Cache-and-sync: keep a local copy, refresh on read

**Decision.** Reads come from our own MongoDB copy of the comments. On the first
page of a read (no `cursor`), we refresh from the platform — drain its comment
pages (bounded by `MAX_REFRESH_PAGES`), upsert each into the store, and stamp
every touched row with one `syncedAt`; the response surfaces that time. Later
pages of the same scroll session read straight from the store, so they page a
steady snapshot instead of re-syncing between pages.

**Why (instead of calling the platform on every request).** Calling live is
simpler (no store), but it hits the rate limit on every request, can't serve
reads when the platform is down, gives unstable paging while scrolling, and — the
part that matters for replies — leaves us with no stable id to reply *to*. A
local copy is more reliable and much easier on rate limits (NFR-5), it lets us
page a steady snapshot, and it gives every comment one of our ids. We show the
caller how fresh the data is with `syncedAt` (NFR-6, RK-3) instead of pretending
it is live.

**Seam left for production (designed, not built).** A real deployment would (a)
gate the refresh on a staleness window instead of refreshing on every first page,
and (b) run a *background* sync that keeps a warm copy and resumes from a saved
per-post platform cursor, so reads rarely touch the platform at all. Both are a
small, well-isolated addition: reintroduce a per-post `SyncState` bookmark
(cursor + `lastSyncedAt`) and consult it in `CommentService.refresh`. It is left
out here to keep the read path to its essentials.

**Trade-off.** The copy can be a little out of date, and every first-page read
re-drains the platform. Accepted for a take-home; the seam above is the honest
production answer.

## 4. Replies are write-through

**Decision.** The steps: check ownership → call the platform → persist the reply
it returns as a first-class row in the `comments` collection, threaded under its
parent. We call the platform *before* saving, so our store never holds a reply
the platform doesn't have; if the adapter call fails, the typed `PlatformError`
propagates and nothing is persisted — no orphan to clean up.

**Why.** The write-through ordering is the load-bearing guarantee: our data can
never claim a reply that isn't actually on the platform. Persisting the reply
into the same identity-keyed `comments` collection (§5) means a later refresh
reconciles it instead of duplicating.

**Seam left for production (designed, not built).** A public write must be safe
to *retry* — a client or proxy that resends the request must not post the reply
twice (RK-4). The intended design: a caller-supplied `idempotencyKey` backed by a
unique-indexed outbox row claimed *before* the send. Retrying the same key then
replays the stored reply (`sent`), or is refused as indeterminate while a first
attempt is still in flight (`pending` → `409`); the send itself retries only on a
429 (a throttled request never reached the platform), since a 5xx/timeout might
have created the reply and only lost the response. This is a self-contained
addition — an outbox collection plus a claim/complete/abandon guard around the
existing send — and is left out here to keep the reply path to its essentials.

**Trade-off.** As built, a genuine client retry can double-post. Accepted for a
take-home; the seam above is the production answer.

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
| Missing / invalid credentials                | (guard)                   | 401  | `UNAUTHORIZED`      |
| Bad request body / params                    | (`ValidationPipe`)        | 400  | `VALIDATION_FAILED` |
| No adapter for platform / anything else      | (misconfig / unmapped)    | 500  | `INTERNAL_ERROR` (hidden) |

An expired token maps to `502`, not `401`: it is *our* upstream credential that
failed, not the caller's — a `401` would wrongly tell the caller to log in again.

## 8. Reliability: rate limiting and retry per platform (seam)

**Decision (designed, not built).** Rate limits and short-lived failures are the
failures we expect (RK-2, NFR-5), so each adapter should sit behind a decorator
that adds a per-platform rate limiter (token bucket) and retry with backoff. The
limiter is taken *inside* the retry block so a burst of retries can't itself
become a spike; reads and writes use different retry rules (a write retries on a
429 only, per §4). A decorator keeps this **invisible above the adapter** — the
registry would store the wrapped instance and every caller uses it unchanged.

**Where it plugs in.** `PlatformsModule` already assembles the adapter array
through a factory (`useFactory: (...instances) => instances`); wrapping is a
one-line change there — `instances.map(withResilience)` — touching nothing else.
That single, well-marked seam is why the concern is documented rather than built:
adding it later changes one factory, not the registry, the services, or any
adapter.

## 9. Security & multi-tenancy

**Decision.** Every request is scoped to one tenant. An `AuthGuard` turns the
bearer token into an `orgId` and puts it on the request; every repository query
filters by that `orgId`. So a resource in another tenant looks exactly like a
missing one → **404, not 403** — which means a caller can't probe for what they
don't own. Platform tokens are never stored in our DB, returned, or logged:
`PlatformAccount` holds only an opaque `tokenRef`, and adapters obtain a token
only through the one-method `TokenProvider` interface — never by reading a secret
directly.

**Why.** Callers must only touch their own org's data (AC-4, NFR-4), and tokens
must never leak (RK-6). We keep *who you are* (→ 401) separate from *what you can
see* (→ 404), so the guard never needs to load the resource to make that call.

**Seam left for production (designed, not built).** The `TokenProvider` is the
single place credential handling grows up: the reference implementation
(`EnvTokenProvider`) reads a token from the environment, but the same interface
is where a real secret manager (Vault, AWS/GCP Secret Manager) resolving the
account's `tokenRef` plugs in, along with token caching, refresh-on-expiry, and a
leak-proof token value object (overriding `toString`/`toJSON`/inspect to redact)
in place of the plain string. None of that changes an adapter — they already
depend only on `getToken`.

---

## Data model

| Collection          | Purpose                                                                                          | Key indexes |
| ------------------- | ------------------------------------------------------------------------------------------------ | ----------- |
| `platform_accounts` | A connected social account owned by an org; holds `tokenRef`, never the token                    | unique `{ platform, externalAccountId }` |
| `posts`             | A published post; maps our `_id` to the platform's `externalPostId`; the feature only touches `published` posts | unique `{ platform, externalPostId }` |
| `comments`          | Local copy of comments **and** replies, flat, linked by `parentCommentId`                        | unique `{ platform, externalCommentId }`; `{ postId, platformCreatedAt }`; `{ parentCommentId, platformCreatedAt }` |

`orgId` is stored on the tenant-owned collections for scoping. Two collections
the seams in §3 and §4 would add — a per-post `sync_states` bookmark (freshness /
resumable cursor) and a `reply_outbox` (unique `{ idempotencyKey }`, for
at-most-once replies) — are described there but not part of the built schema.

---

## Assumptions

Taken from the planning phase (`ai/execution-plan.md` §2.5). None block the work;
each is a sensible default the reviewer can change.

| #   | Assumption                                                                                                         | Confidence |
| --- | ------------------------------------------------------------------------------------------------------------------ | ---------- |
| A-1 | Stack = TypeScript + NestJS + MongoDB + @nestjs/mongoose + Jest + class-validator (**confirmed**)                  | High       |
| A-2 | A "published post" already exists in the scheduling system, with its platform and external post id stored          | High       |
| A-3 | Each account's OAuth credentials already exist and are managed elsewhere; this feature just reads them through a token provider | Medium  |
| A-4 | Reads come from a local copy refreshed on read (background sync is a seam, §3); replies go to the platform first, then are saved | Medium |
| A-5 | Threads use a `parentCommentId` pointer; each adapter applies the platform's max nesting depth                      | High       |
| A-6 | Multi-tenant: posts and comments belong to an org/user, and ownership is checked on every request                   | High       |
| A-7 | Audience = engineers reviewing a take-home                                                                          | High       |

## Scope note

Per the task (design + partial implementation), the build ships the full core
path (read, reply, REST, auth, error taxonomy, tests, docs) with **one real
adapter (Facebook Graph, partial) plus a Mock adapter**. The other platforms are
the interface only — which is the "add a platform = one adapter" idea in action.

Four production concerns are **designed here but left as seams**, each explained
inline: freshness & background sync (§3), at-most-once replies (§4),
per-platform rate-limiting/retry (§8), and a real secret manager (§9). Webhook
intake (TASK-14) is likewise a documented hook (`capabilities.supportsWebhooks`),
not built. Scoping these out — rather than half-building them — is a deliberate
judgement call: it keeps the reviewable core small while showing exactly where
each concern attaches. Note that the numbered TASK/`ai/` planning docs describe
the *original* fuller build; this file is the source of truth for what ships.
