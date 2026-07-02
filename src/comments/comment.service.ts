import { Injectable } from '@nestjs/common';

import { Comment, Page, Reply } from '../domain';
import { PostDocument } from '../persistence/schemas/post.schema';
import { AdapterContext, AdapterRegistry } from '../platforms';
import { CommentNotFoundError, PostNotFoundError } from './comment-errors';
import { CommentRepository } from './comment.repository';

/**
 * Cap on how many platform pages one refresh will drain, so a read can't turn
 * into an unbounded crawl of a huge comment history.
 */
const MAX_REFRESH_PAGES = 50;

/** What {@link CommentService.getComments} needs to serve one page. */
export interface GetCommentsParams {
  /** Caller's tenant, used to scope the post lookup. */
  readonly orgId: string;
  /** Our internal post id. */
  readonly postId: string;
  /** Opaque local-store cursor; omitted for the first page. */
  readonly cursor?: string;
  /** Page size, already validated by the query DTO. */
  readonly limit: number;
}

/** A page of comments plus the freshness stamp the API surfaces. */
export interface CommentListResult {
  readonly page: Page<Comment>;
  readonly syncedAt: Date;
}

/** What {@link CommentService.replyToComment} needs to post one reply. */
export interface ReplyToCommentParams {
  /** Caller's tenant, used to scope the comment/post lookup. */
  readonly orgId: string;
  /** Our internal id of the comment being replied to. */
  readonly commentId: string;
  /** The reply body, already validated by the request DTO. */
  readonly text: string;
}

/**
 * Serves comment reads and replies. Reads use a simple cache-and-sync policy:
 * refresh our local copy from the platform, then answer from the store. The
 * service owns policy and leaves storage and platform mechanics to
 * {@link CommentRepository} and the resolved {@link PlatformAdapter}, so it stays
 * platform-agnostic.
 *
 * Kept simple on purpose: the refresh always re-drains the platform on the first
 * page rather than gating on staleness or resuming from a saved cursor, and a
 * reply posts straight through with no idempotency guard. A staleness window,
 * cursor resume, and idempotency are designed but not built (see DESIGN.md §3/§4).
 */
@Injectable()
export class CommentService {
  constructor(
    private readonly repository: CommentRepository,
    private readonly registry: AdapterRegistry,
  ) {}

  /**
   * One page of a published post's comments in our shared shape, plus how fresh
   * it is. Throws {@link PostNotFoundError} if the post doesn't exist, isn't
   * published, or isn't owned by `orgId` — the caller can't tell those apart.
   *
   * We refresh only on the first page (no `cursor`), so a scroll session pages a
   * stable snapshot instead of re-syncing between pages. Platform failures during
   * refresh come out as typed `PlatformError`s, never a raw platform response.
   */
  async getComments(params: GetCommentsParams): Promise<CommentListResult> {
    const { orgId, postId, cursor, limit } = params;

    const post = await this.repository.findPublishedPost(postId, orgId);
    if (!post) {
      throw new PostNotFoundError(postId);
    }

    if (!cursor) {
      await this.refresh(post);
    }

    const page = await this.repository.pageComments(post._id, cursor, limit);

    return { page, syncedAt: latestSyncedAt(page) };
  }

  /**
   * Post a reply to a comment and return it in our shared shape. Write-through:
   * we call the platform first and only persist once it accepts, so our store
   * never holds a reply the platform doesn't. The comment and its published post
   * must belong to `orgId`, else {@link CommentNotFoundError} (one 404 callers
   * can't probe). A platform failure comes out as a typed {@link PlatformError}
   * and nothing is persisted.
   *
   * At-most-once delivery under client retries (idempotency key + outbox) is
   * designed but not built — see DESIGN.md §4.
   */
  async replyToComment(params: ReplyToCommentParams): Promise<Reply> {
    const { orgId, commentId, text } = params;

    const target = await this.repository.findReplyTarget(commentId, orgId);
    if (!target) {
      throw new CommentNotFoundError(commentId);
    }

    const adapter = this.registry.get(target.post.platform);
    const ctx: AdapterContext = {
      platformAccountId: target.post.platformAccountId.toString(),
    };

    const fetched = await adapter.replyToComment(
      ctx,
      target.comment.externalCommentId,
      { text },
    );

    return this.repository.saveReply(target, fetched, new Date());
  }

  /**
   * Pull the post's comments from the platform and upsert them, draining up to
   * {@link MAX_REFRESH_PAGES} pages. Every row touched shares one `syncedAt`
   * stamp. Starts from the top each time — a background sync that keeps a warm
   * copy and resumes from a saved cursor is designed but not built (DESIGN.md §3).
   */
  private async refresh(post: PostDocument): Promise<void> {
    const adapter = this.registry.get(post.platform);
    const ctx: AdapterContext = {
      platformAccountId: post.platformAccountId.toString(),
    };
    const syncedAt = new Date();

    let cursor: string | undefined;
    for (let page = 0; page < MAX_REFRESH_PAGES; page++) {
      const result = await adapter.getComments(
        ctx,
        post.externalPostId,
        cursor,
      );
      await this.repository.upsertFetched(post, result.items, syncedAt);

      if (result.nextCursor === null) {
        break;
      }
      cursor = result.nextCursor;
    }
  }
}

/**
 * The page's freshness stamp: the latest `syncedAt` among the returned rows,
 * falling back to now for an empty page. Surfaces how fresh the local copy is
 * without a separate bookkeeping collection.
 */
function latestSyncedAt(page: Page<Comment>): Date {
  let latest = 0;
  for (const comment of page.items) {
    latest = Math.max(latest, comment.syncedAt.getTime());
  }
  return latest > 0 ? new Date(latest) : new Date();
}
