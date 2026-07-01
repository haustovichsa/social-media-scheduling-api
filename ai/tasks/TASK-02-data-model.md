# TASK-02 — Data model & collections

**Depends on:** TASK-01 · **Difficulty:** Medium · **Order:** 2
**Requirements:** FR-5, supports FR-1/FR-2, NFR-6

## Prompt
Define the MongoDB data model using `@nestjs/mongoose` `@Schema()`/`@Prop()` classes per `execution-plan.md` §3.3.

Model these collections:
- `PlatformAccount` — platform (enum), externalAccountId, orgId, tokenRef.
- `Post` — platformAccountId, platform, externalPostId, status (published), orgId.
- `Comment` — postId, platform, externalCommentId, `parentCommentId` (self-ref ObjectId, nullable),
  author subdocument, text, platformCreatedAt, ingestedAt/syncedAt, orgId.
  Add a **unique compound index** `{ platform, externalCommentId }` and index `{ postId, platformCreatedAt }`
(via `@Prop({ index })` and `SchemaFactory` + `schema.index(...)`).
- `SyncState` — per-post cursor + lastSyncedAt.
- `ReplyOutbox` — `idempotencyKey` (unique index), commentId, status, externalReplyId.

Reference (not embed) replies via `parentCommentId` to avoid unbounded arrays / document-size limits.
Add model comments explaining threading and uniqueness.

## Definition of Done
- Models compile; indexes are created on connect (`autoIndex` in dev / explicit `ensureIndexes`).
- Uniqueness + self-referential threading verified against a local or in-memory Mongo.
- Design rationale documented inline.

**Role focus:** Domain Researcher (threading), Performance (indexing) — elevated.
