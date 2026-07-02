import { Injectable } from '@nestjs/common';

import { Comment, Page, Reply } from '../domain';
import { PostDocument } from '../persistence/schemas/post.schema';
import { SyncStateDocument } from '../persistence/schemas/sync-state.schema';
import { AdapterContext, AdapterRegistry, FetchedReply } from '../platforms';
import {
  CommentNotFoundError,
  PostNotFoundError,
  ReplyInProgressError,
} from './comment-errors';
import { CommentRepository } from './comment.repository';

/**
 * How long a post's local comment copy is considered fresh before an on-demand
 * read triggers a refresh (A-4). A short window keeps reads current without
 * hammering the platform on every request; a real deployment would also run a
 * background sync (out of scope here) so most reads hit a warm cache.
 */
export const COMMENT_STALE_AFTER_MS = 60_000;

/**
 * Upper bound on platform pages pulled in a single on-demand refresh, so one read
 * can't fan out into an unbounded crawl of a huge comment history under the
 * caller's request. We persist the platform cursor as we go (see
 * {@link CommentRepository.saveSyncState}), so a later refresh resumes where this
 * one stopped rather than restarting from the top.
 */
const MAX_REFRESH_PAGES = 20;

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

/** A page of comments plus the freshness stamp the API surfaces (A-4, NFR-6). */
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
  /**
   * Caller-supplied dedupe key for the whole send. The same key is safe to
   * retry: it posts to the platform at most once (RK-4).
   */
  readonly idempotencyKey: string;
}

/**
 * Serves reads (FR-1) under the cache-and-sync policy (A-4): answer from our
 * local copy, refreshing it from the platform first when it is missing or stale.
 * The service owns *policy* — when to refresh and how freshness is judged — and
 * delegates all storage and platform mechanics to {@link CommentRepository} and
 * the resolved {@link PlatformAdapter}, so it stays platform-agnostic (NFR-1).
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
   * Refresh is decided only on the first page (no `cursor`): a scroll session
   * then pages a stable snapshot instead of re-syncing — and possibly reshaping
   * the list — between pages. Platform failures during refresh surface as the
   * shared `PlatformError` taxonomy (mapped by TASK-09/TASK-11), never leaking a
   * raw platform response.
   */
  async getComments(params: GetCommentsParams): Promise<CommentListResult> {
    const { orgId, postId, cursor, limit } = params;

    const post = await this.repository.findPublishedPost(postId, orgId);
    if (!post) {
      throw new PostNotFoundError(postId);
    }

    const sync = await this.repository.getSyncState(post._id);
    // `refresh` returns the stamp it just persisted, so we don't re-read the
    // bookmark to learn `syncedAt`. The `?? new Date()` fallback covers only the
    // odd case of deep-paging a never-synced post (nothing to be stale about).
    let syncedAt = sync?.lastSyncedAt;
    if (!cursor && this.isStale(sync)) {
      syncedAt = await this.refresh(post, sync?.cursor ?? undefined);
    }

    const page = await this.repository.pageComments(post._id, cursor, limit);

    return { page, syncedAt: syncedAt ?? new Date() };
  }

  /**
   * Post a reply to a comment and return it in the shared format (FR-2), safely
   * under retries (RK-4). The flow is write-through: we call the platform first
   * and only persist once it accepts, so our store never holds a reply the
   * platform doesn't.
   *
   * Ordering matters for the two guarantees in the task's Definition of Done:
   *  1. ownership — the comment and its published post must belong to `orgId`,
   *     else {@link CommentNotFoundError} (a single, unprobeable 404);
   *  2. claim the outbox by `idempotencyKey` *before* sending — a `sent` key
   *     replays the stored reply (no double-post), a still-`pending` key is
   *     refused as {@link ReplyInProgressError} (indeterminate), and only a
   *     fresh/failed key proceeds to the send;
   *  3. on adapter failure, mark the claim failed and rethrow the typed
   *     {@link PlatformError} — nothing was persisted, so no orphan is left.
   */
  async replyToComment(params: ReplyToCommentParams): Promise<Reply> {
    const { orgId, commentId, text, idempotencyKey } = params;

    const target = await this.repository.findReplyTarget(commentId, orgId);
    if (!target) {
      throw new CommentNotFoundError(commentId);
    }
    const { comment, post } = target;

    const claim = await this.repository.beginReplyClaim(
      idempotencyKey,
      comment._id,
      orgId,
    );
    if (claim.outcome === 'already-sent') {
      const existing = await this.repository.findPersistedReply(
        comment._id,
        claim.externalReplyId,
      );
      // Marked sent but the reply row isn't visible yet: the same narrow crash
      // window completeReply guards against — treat it as still settling.
      if (!existing) {
        throw new ReplyInProgressError(idempotencyKey);
      }
      return existing;
    }
    if (claim.outcome === 'in-progress') {
      throw new ReplyInProgressError(idempotencyKey);
    }

    const adapter = this.registry.get(post.platform);
    const ctx: AdapterContext = {
      platformAccountId: post.platformAccountId.toString(),
    };

    let fetched: FetchedReply;
    try {
      fetched = await adapter.replyToComment(ctx, comment.externalCommentId, {
        text,
      });
    } catch (error) {
      // The send failed before creating anything; release the claim so a retry
      // with the same key can try again, and surface the platform's typed error.
      await this.repository.abandonReplyClaim(idempotencyKey);
      throw error;
    }

    return this.repository.completeReply(
      target,
      fetched,
      idempotencyKey,
      new Date(),
    );
  }

  /** Missing bookmark, or older than the freshness window, means refresh. */
  private isStale(sync: SyncStateDocument | null): boolean {
    if (!sync) {
      return true;
    }
    return Date.now() - sync.lastSyncedAt.getTime() >= COMMENT_STALE_AFTER_MS;
  }

  /**
   * Pull comments from the platform and upsert them, resuming from the stored
   * cursor. Pages up to {@link MAX_REFRESH_PAGES}; if the platform has more
   * beyond that, the last cursor is saved so the next refresh continues, and if
   * the list is exhausted the cursor is reset to `null` (a later refresh re-reads
   * from the top to catch edits and new comments). Returns the single `syncedAt`
   * stamp used for the whole run — every row touched shares it, and the caller
   * reuses it as the page's freshness rather than re-reading the bookmark.
   */
  private async refresh(
    post: PostDocument,
    resumeCursor: string | undefined,
  ): Promise<Date> {
    const adapter = this.registry.get(post.platform);
    const ctx: AdapterContext = {
      platformAccountId: post.platformAccountId.toString(),
    };
    const syncedAt = new Date();

    let cursor = resumeCursor;
    for (let page = 0; page < MAX_REFRESH_PAGES; page++) {
      const result = await adapter.getComments(
        ctx,
        post.externalPostId,
        cursor,
      );
      await this.repository.upsertFetched(post, result.items, syncedAt);

      if (result.nextCursor === null) {
        cursor = undefined;
        break;
      }
      cursor = result.nextCursor;
    }

    await this.repository.saveSyncState(post._id, cursor ?? null, syncedAt);
    return syncedAt;
  }
}
