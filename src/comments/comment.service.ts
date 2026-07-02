import { Injectable } from '@nestjs/common';

import { Comment, Page } from '../domain';
import { PostDocument } from '../persistence/schemas/post.schema';
import { SyncStateDocument } from '../persistence/schemas/sync-state.schema';
import { AdapterContext, AdapterRegistry } from '../platforms';
import { PostNotFoundError } from './comment-errors';
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
