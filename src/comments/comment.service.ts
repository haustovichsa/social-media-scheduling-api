import { Injectable } from '@nestjs/common';

import { Comment, Page, Reply } from '../domain';
import { PostDocument } from '../persistence/schemas/post.schema';
import { AdapterContext, AdapterRegistry } from '../platforms';
import { CommentNotFoundError, PostNotFoundError } from './comment-errors';
import { CommentRepository } from './comment.repository';

/**
 * Safety bound on how many platform pages one on-demand refresh will drain, so a
 * read can't fan out into an unbounded crawl of a huge comment history under the
 * caller's request.
 */
const MAX_REFRESH_PAGES = 50;

/** What {@link CommentService.getComments} needs to serve one page. */
export interface GetCommentsParams {
  /** Caller's tenant, used to scope the post lookup (A-6). */
  readonly orgId: string;
  /** Our internal post id (the route param resolves to this). */
  readonly postId: string;
  /** Opaque local-store cursor; omitted for the first page. */
  readonly cursor?: string;
  /** Page size, already validated/bounded by the query DTO. */
  readonly limit: number;
}

/** A page of comments plus the freshness stamp the API surfaces (NFR-6). */
export interface CommentListResult {
  readonly page: Page<Comment>;
  readonly syncedAt: Date;
}

/** What {@link CommentService.replyToComment} needs to post one reply. */
export interface ReplyToCommentParams {
  /** Caller's tenant, used to scope the comment/post lookup (A-6). */
  readonly orgId: string;
  /** Our internal id of the comment being replied to (the route param). */
  readonly commentId: string;
  /** The reply body, already validated/bounded by the request DTO. */
  readonly text: string;
}

/**
 * Serves reads (FR-1) and replies (FR-2). Reads follow a simple cache-and-sync
 * policy: refresh our local copy from the platform, then answer from the store.
 * The service owns *policy* and delegates storage and platform mechanics to
 * {@link CommentRepository} and the resolved {@link PlatformAdapter}, so it stays
 * platform-agnostic (NFR-1).
 *
 * Deliberately simple here (see DESIGN.md §3/§4 for the designed-not-built
 * seams): the refresh always re-drains the platform on the first page rather than
 * gating on a staleness window or resuming from a saved cursor, and a reply posts
 * straight through without an idempotency/outbox guard.
 */
@Injectable()
export class CommentService {
  constructor(
    private readonly repository: CommentRepository,
    private readonly registry: AdapterRegistry,
  ) {}

  /**
   * One page of a published post's comments in the shared format, plus how fresh
   * that view is. Throws {@link PostNotFoundError} if the post doesn't exist,
   * isn't published, or isn't owned by `orgId` — a caller can't tell those apart.
   *
   * We refresh only on the first page (no `cursor`): a scroll session then pages
   * a stable snapshot of the store rather than re-syncing between pages. Platform
   * failures during refresh surface as the shared `PlatformError` taxonomy,
   * never leaking a raw platform response.
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
   * Post a reply to a comment and return it in the shared format (FR-2). The flow
   * is write-through: we call the platform first and only persist once it
   * accepts, so our store never holds a reply the platform doesn't. The comment
   * and its published post must belong to `orgId`, else {@link CommentNotFoundError}
   * (a single, unprobeable 404). A platform failure surfaces as the typed
   * {@link PlatformError}; nothing is persisted in that case.
   *
   * At-most-once delivery under client/network retries (an idempotency key +
   * outbox) is a designed-not-built seam — see DESIGN.md §4.
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
   * Pull the post's comments from the platform and upsert them into the local
   * store, draining pages up to {@link MAX_REFRESH_PAGES}. Every row touched
   * shares one `syncedAt` stamp. Starts from the top each time — a background sync
   * that keeps a warm copy and resumes from a saved cursor is left as a seam
   * (DESIGN.md §3).
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
 * The page's freshness stamp: the latest `syncedAt` among the returned rows (all
 * rows touched by one refresh share a stamp), falling back to now for an empty
 * page. This surfaces how fresh the local copy is without a separate bookkeeping
 * collection (NFR-6).
 */
function latestSyncedAt(page: Page<Comment>): Date {
  let latest = 0;
  for (const comment of page.items) {
    latest = Math.max(latest, comment.syncedAt.getTime());
  }
  return latest > 0 ? new Date(latest) : new Date();
}
