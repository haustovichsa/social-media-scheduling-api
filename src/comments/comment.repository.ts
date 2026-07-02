import { Injectable } from '@nestjs/common';
import { InjectModel } from '@nestjs/mongoose';
import { FilterQuery, Model, Types } from 'mongoose';

import { Platform } from '../common/enums/platform.enum';
import { Author, Comment, Page } from '../domain';
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
  SyncState as SyncStateEntity,
  SyncStateDocument,
} from '../persistence/schemas/sync-state.schema';
import { FetchedComment } from '../platforms';
import { encodeCommentCursor, decodeCommentCursor } from './comment-cursor';

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

      const doc = await this.commentModel
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
              syncedAt,
              orgId: post.orgId,
            },
            $setOnInsert: { ingestedAt: syncedAt },
          },
          { upsert: true, new: true },
        )
        .exec();

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

/** Fetched author → embedded persistence shape (external id key preserved). */
function toStoredAuthor(author: FetchedComment['author']) {
  return {
    externalAuthorId: author.externalAuthorId,
    displayName: author.displayName,
    ...(author.avatarUrl ? { avatarUrl: author.avatarUrl } : {}),
  };
}
