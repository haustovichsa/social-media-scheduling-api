import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';

import { Platform } from '../common/enums/platform.enum';
import { Author, Comment, Page, Reply } from '../domain';
import {
  Comment as CommentEntity,
  CommentDocument,
} from '../persistence/schemas/comment.schema';
import {
  Post as PostEntity,
  PostDocument,
  PostStatus,
} from '../persistence/schemas/post.schema';
import {
  ReplyOutbox as ReplyOutboxEntity,
  ReplyStatus,
} from '../persistence/schemas/reply-outbox.schema';
import {
  SyncState as SyncStateEntity,
  SyncStateDocument,
} from '../persistence/schemas/sync-state.schema';
import { FetchedComment, FetchedReply } from '../platforms';
import { encodeCommentCursor, decodeCommentCursor } from './comment-cursor';

/**
 * The comment being replied to, resolved together with its post so the reply
 * flow has everything one lookup needs: the target comment's external id and
 * platform, and the post's `platformAccountId` — the key the adapter's
 * `TokenProvider` resolves to a token. Both are re-checked against the caller's
 * org, so a cross-tenant or unpublished target is indistinguishable from a
 * missing one.
 */
export interface ReplyTarget {
  readonly comment: CommentDocument;
  readonly post: PostDocument;
}

/**
 * Outcome of claiming the outbox row for an idempotency key — the single gate
 * that makes replying safe to retry (RK-4):
 *  - `claimed`   — we created (or re-drove a failed) row and own the send;
 *  - `in-progress` — a prior attempt is still pending, outcome unknown;
 *  - `already-sent` — the key's reply was posted before; replay it, don't resend.
 */
export type ReplyClaim =
  | { readonly outcome: 'claimed' }
  | { readonly outcome: 'in-progress' }
  | { readonly outcome: 'already-sent'; readonly externalReplyId: string };

/**
 * All persistence for the read flow (TASK-07), kept behind one class so
 * {@link CommentService} depends on a small, mockable seam and never touches a
 * Mongoose model directly — the policy (when to refresh) stays separate from the
 * storage mechanics (how comments are paged and upserted).
 *
 * Two identity rules from the data model (TASK-02) shape everything here:
 *  - a comment's identity is `{ platform, externalCommentId }` (the upsert key),
 *    so a refresh updates the existing row instead of duplicating it;
 *  - threading is by our own `_id` (`parentCommentId` is a self-`ObjectId`), so
 *    ingest must resolve each fetched comment's *external* parent id to our id.
 */
@Injectable()
export class CommentRepository {
  constructor(
    @InjectModel(CommentEntity.name)
    private readonly commentModel: Model<CommentEntity>,
    @InjectModel(PostEntity.name)
    private readonly postModel: Model<PostEntity>,
    @InjectModel(SyncStateEntity.name)
    private readonly syncStateModel: Model<SyncStateEntity>,
    @InjectModel(ReplyOutboxEntity.name)
    private readonly replyOutboxModel: Model<ReplyOutboxEntity>,
  ) {}

  /**
   * The published post identified by `postId` *and* owned by `orgId`, or `null`.
   * Scoping the query by `orgId` (not just filtering after load) means a
   * cross-tenant id is indistinguishable from a missing one — the service maps
   * both to a 404, so ownership can't be probed (A-6, defence in depth behind the
   * TASK-10 guard). A syntactically invalid id is treated as "not found" rather
   * than throwing a cast error.
   */
  async findPublishedPost(
    postId: string,
    orgId: string,
  ): Promise<PostDocument | null> {
    if (!Types.ObjectId.isValid(postId)) {
      return null;
    }
    return this.postModel
      .findOne({
        _id: new Types.ObjectId(postId),
        orgId,
        status: PostStatus.Published,
      })
      .exec();
  }

  /** The post's sync bookmark, or `null` if it has never been synced. */
  async getSyncState(
    postId: Types.ObjectId,
  ): Promise<SyncStateDocument | null> {
    return this.syncStateModel.findOne({ postId }).exec();
  }

  /**
   * Record how far the refresh got: the platform cursor to resume from next time
   * (`null` once we have caught up to the end of the list) and the moment the
   * sync ran, which the read service surfaces as `syncedAt`. Upserted so the
   * first refresh creates the one-per-post bookmark.
   */
  async saveSyncState(
    postId: Types.ObjectId,
    cursor: string | null,
    lastSyncedAt: Date,
  ): Promise<void> {
    await this.syncStateModel
      .updateOne(
        { postId },
        { $set: { cursor, lastSyncedAt } },
        { upsert: true },
      )
      .exec();
  }

  /**
   * Upsert one batch of fetched comments into the local store, keyed by
   * `{ platform, externalCommentId }`, stamping `syncedAt` so freshness reflects
   * this reconciliation. Returns nothing — the read path re-queries the store.
   *
   * Parent resolution: platforms stream (and we page) oldest-first, so a parent
   * normally precedes its replies. We resolve each fetched comment's
   * `externalParentCommentId` to our `_id` from a batch-local map first, falling
   * back to a lookup for a parent ingested on an earlier page. A reply whose
   * parent we haven't seen yet lands top-level (`null`) for now and is re-threaded
   * on a later refresh once the parent exists — we never drop it.
   */
  async upsertFetched(
    post: PostDocument,
    comments: readonly FetchedComment[],
    syncedAt: Date,
  ): Promise<void> {
    const localIdByExternal = new Map<string, Types.ObjectId>();

    for (const fetched of comments) {
      const parentCommentId = await this.resolveParentId(
        post.platform,
        fetched.externalParentCommentId,
        localIdByExternal,
      );

      const doc = await this.upsertCommentRow(
        post,
        fetched,
        parentCommentId,
        syncedAt,
      );

      localIdByExternal.set(fetched.externalCommentId, doc._id);
    }
  }

  /**
   * One page of a post's comments in the shared format, oldest-first. Uses keyset
   * paging on `{ platformCreatedAt, _id }` (the read index) and fetches
   * `limit + 1` rows to tell whether a further page exists without a second
   * count query. `nextCursor` is `null` at end of list.
   */
  async pageComments(
    postId: Types.ObjectId,
    cursor: string | undefined,
    limit: number,
  ): Promise<Page<Comment>> {
    const filter: FilterQuery<CommentEntity> = { postId };

    if (cursor) {
      const { createdAt, id } = decodeCommentCursor(cursor);
      // Everything strictly after the previous page's last item under the total
      // order (createdAt, _id): a later timestamp, or the same timestamp with a
      // greater id.
      filter.$or = [
        { platformCreatedAt: { $gt: createdAt } },
        { platformCreatedAt: createdAt, _id: { $gt: id } },
      ];
    }

    const docs = await this.commentModel
      .find(filter)
      .sort({ platformCreatedAt: 1, _id: 1 })
      .limit(limit + 1)
      .exec();

    const hasMore = docs.length > limit;
    const pageDocs = hasMore ? docs.slice(0, limit) : docs;
    const items = pageDocs.map(toDomainComment);

    const last = pageDocs[pageDocs.length - 1];
    const nextCursor =
      hasMore && last
        ? encodeCommentCursor(last.platformCreatedAt, last._id.toString())
        : null;

    return { items, nextCursor };
  }

  /**
   * The comment `commentId` and its post, both scoped to `orgId` and the post
   * published — the ownership check for the reply flow (A-6). Returns `null` if
   * the comment is missing, the post isn't published, or either belongs to
   * another org; the service maps all of these to a single 404 so ownership
   * can't be probed. An invalid id is treated as "not found", not an error.
   */
  async findReplyTarget(
    commentId: string,
    orgId: string,
  ): Promise<ReplyTarget | null> {
    if (!Types.ObjectId.isValid(commentId)) {
      return null;
    }
    const comment = await this.commentModel
      .findOne({ _id: new Types.ObjectId(commentId), orgId })
      .exec();
    if (!comment) {
      return null;
    }
    // Reuse the read flow's ownership predicate so "owned + published" has a
    // single definition across both entry points.
    const post = await this.findPublishedPost(comment.postId.toString(), orgId);
    if (!post) {
      return null;
    }
    return { comment, post };
  }

  /**
   * Claim the outbox row for `idempotencyKey` before we call the platform — the
   * single-flight gate that makes replying safe to retry (RK-4). The unique
   * index on `idempotencyKey` guarantees at most one live claim per key, so the
   * platform is written to at most once even under a client (or network) retry.
   *
   * The claim resolves to one of three outcomes (see {@link ReplyClaim}):
   *  - a fresh key, or one whose prior attempt is `failed` (the adapter threw
   *    before creating anything, so re-sending is safe), is re-driven to
   *    `pending` and returns `claimed` — the caller owns the send;
   *  - a `sent` key returns `already-sent` so the caller replays the stored
   *    reply instead of posting again;
   *  - a still-`pending` key returns `in-progress`: a prior attempt's outcome is
   *    unknown, so re-sending might double-post and the caller must refuse.
   *
   * The `failed → pending` transition is a guarded conditional update so two
   * concurrent retries can't both re-drive the same key: the loser sees
   * `pending` and backs off as `in-progress`.
   *
   * The fresh key is the dominant case (the first attempt of every reply), so we
   * try the `create` first — one round-trip — and only fall back to the revive /
   * classify queries when the unique index rejects the insert.
   */
  async beginReplyClaim(
    idempotencyKey: string,
    commentId: Types.ObjectId,
    orgId: string,
  ): Promise<ReplyClaim> {
    try {
      await this.replyOutboxModel.create({
        idempotencyKey,
        commentId,
        orgId,
        status: ReplyStatus.Pending,
      });
      return { outcome: 'claimed' };
    } catch (error) {
      if (!isDuplicateKeyError(error)) {
        throw error;
      }
    }

    // A row already exists. If its prior attempt `failed` (the adapter threw
    // before creating anything, so re-sending is safe), re-drive it to `pending`
    // — guarded on `status: Failed` so concurrent retries can't both win.
    const revived = await this.replyOutboxModel
      .findOneAndUpdate(
        { idempotencyKey, status: ReplyStatus.Failed },
        { $set: { status: ReplyStatus.Pending } },
        { new: true },
      )
      .exec();
    if (revived) {
      return { outcome: 'claimed' };
    }

    // Not `failed`: it's `sent` (replay it) or still `pending` (indeterminate —
    // refuse to resend).
    const existing = await this.replyOutboxModel
      .findOne({ idempotencyKey })
      .exec();
    if (
      existing?.status === ReplyStatus.Sent &&
      existing.externalReplyId !== null
    ) {
      return {
        outcome: 'already-sent',
        externalReplyId: existing.externalReplyId,
      };
    }
    return { outcome: 'in-progress' };
  }

  /**
   * Persist a reply the platform just accepted and close out its outbox claim.
   *
   * The reply is upserted into the same `comments` collection as any other
   * comment, keyed by `{ platform, externalCommentId }` so it reconciles with a
   * later refresh instead of duplicating, and threaded under the comment we
   * replied to (`target.comment`). We persist the reply *first*, then flip the
   * outbox to `sent` with the platform's id: if a crash lands between the two,
   * the claim stays `pending` and a retry is refused as in-progress — never a
   * double-post, and never an orphaned outbox pointing at a missing reply.
   *
   * Returns the canonical {@link Reply}; its `parentCommentId` is non-null by
   * construction (it is `target.comment._id`).
   */
  async completeReply(
    target: ReplyTarget,
    fetched: FetchedReply,
    idempotencyKey: string,
    now: Date,
  ): Promise<Reply> {
    const { comment: parent, post } = target;

    // Same identity-keyed upsert as an ingested comment, but threaded under the
    // comment we replied to rather than a resolved external parent.
    const doc = await this.upsertCommentRow(post, fetched, parent._id, now);

    await this.replyOutboxModel
      .updateOne(
        { idempotencyKey },
        {
          $set: {
            status: ReplyStatus.Sent,
            externalReplyId: fetched.externalCommentId,
          },
        },
      )
      .exec();

    return toDomainReply(doc);
  }

  /**
   * Mark a claim `failed` after the adapter threw — the send never happened, so
   * nothing was persisted and there is nothing to undo. Keeping the row (rather
   * than deleting it) both records the attempt and lets a later retry with the
   * same key re-drive the send via {@link beginReplyClaim}'s `failed → pending`
   * path. Best-effort: a failure to record this must not mask the original
   * platform error the caller is about to see.
   */
  async abandonReplyClaim(idempotencyKey: string): Promise<void> {
    await this.replyOutboxModel
      .updateOne({ idempotencyKey }, { $set: { status: ReplyStatus.Failed } })
      .exec();
  }

  /**
   * The reply threaded under `parentCommentId` with the given external id, in
   * canonical form — how the `already-sent` replay path returns the reply a
   * prior request already posted. `null` if it isn't persisted yet (the narrow
   * crash window in {@link completeReply}), which the service treats as still
   * in-progress.
   */
  async findPersistedReply(
    parentCommentId: Types.ObjectId,
    externalReplyId: string,
  ): Promise<Reply | null> {
    const doc = await this.commentModel
      .findOne({ parentCommentId, externalCommentId: externalReplyId })
      .exec();
    return doc ? toDomainReply(doc) : null;
  }

  /**
   * The one place a comment row is written: an identity-keyed upsert on
   * `{ platform, externalCommentId }` so a re-fetch (or a reply already ingested
   * by a refresh) updates the existing row instead of duplicating. Shared by the
   * read-flow ingest ({@link upsertFetched}) and the reply flow
   * ({@link completeReply}); the two differ only in how `parentCommentId` is
   * derived, which the caller passes in. `now` stamps both `syncedAt` and, on
   * first insert, `ingestedAt`.
   */
  private upsertCommentRow(
    post: PostDocument,
    fetched: FetchedComment,
    parentCommentId: Types.ObjectId | null,
    now: Date,
  ): Promise<CommentDocument> {
    return this.commentModel
      .findOneAndUpdate(
        {
          platform: post.platform,
          externalCommentId: fetched.externalCommentId,
        },
        {
          $set: {
            postId: post._id,
            platform: post.platform,
            externalCommentId: fetched.externalCommentId,
            parentCommentId,
            author: toStoredAuthor(fetched.author),
            text: fetched.text,
            platformCreatedAt: fetched.platformCreatedAt,
            syncedAt: now,
            orgId: post.orgId,
          },
          $setOnInsert: { ingestedAt: now },
        },
        { upsert: true, new: true },
      )
      .exec();
  }

  /**
   * Map a fetched comment's external parent id to our internal `_id`: this
   * batch's already-upserted rows first, then a stored parent from an earlier
   * page. `null` (top-level) and an as-yet-unseen parent both resolve to `null`.
   */
  private async resolveParentId(
    platform: Platform,
    externalParentCommentId: string | null,
    localIdByExternal: ReadonlyMap<string, Types.ObjectId>,
  ): Promise<Types.ObjectId | null> {
    if (externalParentCommentId === null) {
      return null;
    }

    const fromBatch = localIdByExternal.get(externalParentCommentId);
    if (fromBatch) {
      return fromBatch;
    }

    const stored = await this.commentModel
      .findOne(
        { platform, externalCommentId: externalParentCommentId },
        { _id: 1 },
      )
      .exec();
    return stored?._id ?? null;
  }
}

/** Persistence author → canonical {@link Author}: rename the external id key. */
function toDomainComment(doc: CommentDocument): Comment {
  const author: Author = {
    id: doc.author.externalAuthorId,
    displayName: doc.author.displayName,
    ...(doc.author.avatarUrl ? { avatarUrl: doc.author.avatarUrl } : {}),
  };

  return {
    id: doc._id.toString(),
    postId: doc.postId.toString(),
    platform: doc.platform,
    parentCommentId: doc.parentCommentId
      ? doc.parentCommentId.toString()
      : null,
    author,
    text: doc.text,
    createdAt: doc.platformCreatedAt,
    syncedAt: doc.syncedAt,
  };
}

/**
 * Persistence document → canonical {@link Reply}. A reply is structurally a
 * {@link Comment} whose parent is guaranteed non-null; we assert that here (it
 * holds by construction — {@link CommentRepository.completeReply} always sets a
 * parent) so the caller gets the tighter type without its own null check.
 */
function toDomainReply(doc: CommentDocument): Reply {
  const comment = toDomainComment(doc);
  return { ...comment, parentCommentId: comment.parentCommentId as string };
}

/**
 * Whether a Mongo write rejected on the unique index (duplicate key, code
 * 11000). This is how {@link CommentRepository.beginReplyClaim} learns that a
 * concurrent request already claimed the same idempotency key, turning the race
 * into the ordinary "a row already exists" path rather than a 500.
 */
function isDuplicateKeyError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { code?: number }).code === 11000
  );
}

/** Fetched author → embedded persistence shape (external id key preserved). */
function toStoredAuthor(author: FetchedComment['author']) {
  return {
    externalAuthorId: author.externalAuthorId,
    displayName: author.displayName,
    ...(author.avatarUrl ? { avatarUrl: author.avatarUrl } : {}),
  };
}
