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
import { FetchedComment, FetchedReply } from '../platforms';
import { encodeCommentCursor, decodeCommentCursor } from './comment-cursor';

/**
 * The comment being replied to plus its post, so the reply flow has everything
 * in one lookup: the comment's external id and platform, and the post's
 * `platformAccountId` (the key the adapter turns into a token). Both are checked
 * against the caller's org, so a cross-tenant or unpublished target looks the
 * same as not found.
 */
export interface ReplyTarget {
  readonly comment: CommentDocument;
  readonly post: PostDocument;
}

/**
 * All comment persistence behind one class, so {@link CommentService} depends on
 * a small, mockable seam and never touches a Mongoose model directly. Policy
 * (when to refresh) stays separate from storage (how comments are paged and
 * upserted).
 *
 * Two identity rules shape everything here:
 *  - a comment's identity is `{ platform, externalCommentId }` (the upsert key),
 *    so a refresh updates the existing row instead of duplicating it;
 *  - threading is by our own `_id`, so ingest must map each fetched comment's
 *    external parent id to our id.
 */
@Injectable()
export class CommentRepository {
  constructor(
    @InjectModel(CommentEntity.name)
    private readonly commentModel: Model<CommentEntity>,
    @InjectModel(PostEntity.name)
    private readonly postModel: Model<PostEntity>,
  ) {}

  /**
   * The published post with this `postId` owned by `orgId`, or `null`. Scoping
   * the query by `orgId` means a cross-tenant id looks the same as not found —
   * the service maps both to a 404, so callers can't probe for ownership. An
   * invalid id is treated as "not found" rather than throwing a cast error.
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

  /**
   * Upsert one batch of fetched comments, keyed by
   * `{ platform, externalCommentId }`, stamping `syncedAt`. Returns nothing — the
   * read path re-queries the store.
   *
   * Parents come oldest-first, so a parent normally arrives before its replies.
   * We map each fetched comment's `externalParentCommentId` to our `_id` from
   * this batch first, then fall back to a stored parent from an earlier page. A
   * reply whose parent we haven't seen lands top-level (`null`) and gets
   * re-threaded on a later refresh — we never drop it.
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
   * One page of a post's comments in our shared shape, oldest-first. Keyset
   * paging on `{ platformCreatedAt, _id }`; fetches `limit + 1` rows to tell if
   * there's another page without a second count query. `nextCursor` is `null` at
   * end of list.
   */
  async pageComments(
    postId: Types.ObjectId,
    cursor: string | undefined,
    limit: number,
  ): Promise<Page<Comment>> {
    const filter: FilterQuery<CommentEntity> = { postId };

    if (cursor) {
      const { createdAt, id } = decodeCommentCursor(cursor);
      // Everything after the previous page's last item: a later timestamp, or
      // the same timestamp with a greater id.
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
   * The comment and its post, both scoped to `orgId` with the post published —
   * the ownership check for the reply flow. Returns `null` if the comment is
   * missing, the post isn't published, or either belongs to another org; the
   * service maps all of these to one 404 so callers can't probe for ownership.
   * An invalid id is treated as "not found", not an error.
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
    // Reuse the read flow's check so "owned + published" means the same thing
    // for both entry points.
    const post = await this.findPublishedPost(comment.postId.toString(), orgId);
    if (!post) {
      return null;
    }
    return { comment, post };
  }

  /**
   * Persist a reply the platform just accepted and return it in our shared shape.
   *
   * The reply is upserted into the same `comments` collection as any other
   * comment, keyed by `{ platform, externalCommentId }` so a later refresh
   * updates it instead of duplicating, and threaded under the comment we replied
   * to. Its `parentCommentId` is always set (it's `target.comment._id`).
   */
  async saveReply(
    target: ReplyTarget,
    fetched: FetchedReply,
    now: Date,
  ): Promise<Reply> {
    const { comment: parent, post } = target;

    const doc = await this.upsertCommentRow(post, fetched, parent._id, now);

    return toDomainReply(doc);
  }

  /**
   * The one place a comment row is written: an upsert on
   * `{ platform, externalCommentId }` so a re-fetch updates the existing row
   * instead of duplicating. Shared by ingest ({@link upsertFetched}) and the
   * reply flow ({@link saveReply}); they differ only in the `parentCommentId`
   * the caller passes in. `now` stamps `syncedAt`, and `ingestedAt` on first
   * insert.
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
   * Map a fetched comment's external parent id to our `_id`: this batch's rows
   * first, then a stored parent from an earlier page. A top-level comment and an
   * unseen parent both resolve to `null`.
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

/** Persistence author → {@link Author}: rename the external id key. */
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
 * Persistence document → {@link Reply}. A reply is a {@link Comment} whose parent
 * is never null; {@link CommentRepository.saveReply} always sets one, so we
 * assert that here and hand the caller the tighter type without its own null
 * check.
 */
function toDomainReply(doc: CommentDocument): Reply {
  const comment = toDomainComment(doc);
  return { ...comment, parentCommentId: comment.parentCommentId as string };
}

/** Fetched author → embedded persistence shape (external id key preserved). */
function toStoredAuthor(author: FetchedComment['author']) {
  return {
    externalAuthorId: author.externalAuthorId,
    displayName: author.displayName,
    ...(author.avatarUrl ? { avatarUrl: author.avatarUrl } : {}),
  };
}
