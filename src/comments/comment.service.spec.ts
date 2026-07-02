import { Types } from 'mongoose';

import { Platform } from '../common/enums/platform.enum';
import { Comment, Page } from '../domain';
import { PostDocument } from '../persistence/schemas/post.schema';
import { SyncStateDocument } from '../persistence/schemas/sync-state.schema';
import { AdapterRegistry, FetchedComment, FetchedReply } from '../platforms';
import {
  CommentNotFoundError,
  PostNotFoundError,
  ReplyInProgressError,
} from './comment-errors';
import { CommentRepository, ReplyTarget } from './comment.repository';
import { COMMENT_STALE_AFTER_MS, CommentService } from './comment.service';

/**
 * Unit tests for the read policy (TASK-07). The repository and the resolved
 * adapter are mocked, so these assert *behaviour* — when a refresh runs, how
 * paging resumes, how staleness is judged — without a database or a network. The
 * repository's own storage mechanics are covered separately against in-memory
 * Mongo.
 *
 * The collaborators are built from standalone `jest.fn()`s (rather than spying on
 * class methods) so assertions reference plain function values, not unbound
 * methods.
 */
describe('CommentService', () => {
  const POST_ID = new Types.ObjectId();
  const ACCOUNT_ID = new Types.ObjectId();
  const ORG_ID = 'org-1';
  const EXTERNAL_POST_ID = 'ext-post-1';

  let findPublishedPost: jest.Mock;
  let getSyncState: jest.Mock;
  let saveSyncState: jest.Mock;
  let upsertFetched: jest.Mock;
  let pageComments: jest.Mock;
  let getComments: jest.Mock;
  let findReplyTarget: jest.Mock;
  let beginReplyClaim: jest.Mock;
  let completeReply: jest.Mock;
  let abandonReplyClaim: jest.Mock;
  let findPersistedReply: jest.Mock;
  let replyToComment: jest.Mock;
  let service: CommentService;

  const post = {
    _id: POST_ID,
    platform: Platform.Mock,
    platformAccountId: ACCOUNT_ID,
    externalPostId: EXTERNAL_POST_ID,
    orgId: ORG_ID,
  } as unknown as PostDocument;

  const syncState = (
    overrides: Partial<Pick<SyncStateDocument, 'cursor' | 'lastSyncedAt'>> = {},
  ): SyncStateDocument =>
    ({
      cursor: null,
      lastSyncedAt: new Date(),
      ...overrides,
    }) as SyncStateDocument;

  const fresh = () => syncState({ lastSyncedAt: new Date() });
  const stale = (overrides: Partial<Pick<SyncStateDocument, 'cursor'>> = {}) =>
    syncState({
      lastSyncedAt: new Date(Date.now() - COMMENT_STALE_AFTER_MS - 1_000),
      ...overrides,
    });

  const fetched = (externalCommentId: string): FetchedComment => ({
    externalCommentId,
    externalParentCommentId: null,
    author: { externalAuthorId: 'ada', displayName: 'Ada' },
    text: 'hi',
    platformCreatedAt: new Date(),
  });

  const platformPage = (
    items: FetchedComment[],
    nextCursor: string | null,
  ): Page<FetchedComment> => ({ items, nextCursor });

  const emptyLocalPage: Page<Comment> = { items: [], nextCursor: null };

  beforeEach(() => {
    findPublishedPost = jest.fn();
    getSyncState = jest.fn();
    saveSyncState = jest.fn().mockResolvedValue(undefined);
    upsertFetched = jest.fn().mockResolvedValue(undefined);
    pageComments = jest.fn().mockResolvedValue(emptyLocalPage);
    getComments = jest.fn();
    findReplyTarget = jest.fn();
    beginReplyClaim = jest.fn();
    completeReply = jest.fn();
    abandonReplyClaim = jest.fn().mockResolvedValue(undefined);
    findPersistedReply = jest.fn();
    replyToComment = jest.fn();

    const repository = {
      findPublishedPost,
      getSyncState,
      saveSyncState,
      upsertFetched,
      pageComments,
      findReplyTarget,
      beginReplyClaim,
      completeReply,
      abandonReplyClaim,
      findPersistedReply,
    } as unknown as CommentRepository;
    const registry = {
      get: jest.fn().mockReturnValue({ getComments, replyToComment }),
    } as unknown as AdapterRegistry;

    service = new CommentService(repository, registry);
  });

  it('rejects a missing / cross-tenant / unpublished post', async () => {
    findPublishedPost.mockResolvedValue(null);

    await expect(
      service.getComments({ orgId: ORG_ID, postId: 'nope', limit: 25 }),
    ).rejects.toBeInstanceOf(PostNotFoundError);
    expect(getComments).not.toHaveBeenCalled();
  });

  describe('cache hit (fresh local copy)', () => {
    it('serves from the store without touching the platform', async () => {
      findPublishedPost.mockResolvedValue(post);
      getSyncState.mockResolvedValue(fresh());

      const result = await service.getComments({
        orgId: ORG_ID,
        postId: POST_ID.toString(),
        limit: 25,
      });

      expect(getComments).not.toHaveBeenCalled();
      expect(upsertFetched).not.toHaveBeenCalled();
      expect(saveSyncState).not.toHaveBeenCalled();
      expect(pageComments).toHaveBeenCalledWith(POST_ID, undefined, 25);
      expect(result.page).toBe(emptyLocalPage);
    });
  });

  describe('refresh (missing / stale local copy)', () => {
    it('refreshes when there is no sync bookmark, starting from the top', async () => {
      findPublishedPost.mockResolvedValue(post);
      // Never synced -> refresh from the top.
      getSyncState.mockResolvedValue(null);
      getComments.mockResolvedValue(platformPage([fetched('c1')], null));

      await service.getComments({
        orgId: ORG_ID,
        postId: POST_ID.toString(),
        limit: 25,
      });

      expect(getComments).toHaveBeenCalledWith(
        { platformAccountId: ACCOUNT_ID.toString() },
        EXTERNAL_POST_ID,
        undefined,
      );
      expect(upsertFetched).toHaveBeenCalledTimes(1);
      // List exhausted -> caught up, cursor reset to null.
      expect(saveSyncState).toHaveBeenCalledWith(
        POST_ID,
        null,
        expect.any(Date),
      );
    });

    it('refreshes a stale copy and resumes from the stored platform cursor', async () => {
      findPublishedPost.mockResolvedValue(post);
      getSyncState.mockResolvedValue(stale({ cursor: 'resume-here' }));
      getComments.mockResolvedValue(platformPage([fetched('c1')], null));

      await service.getComments({
        orgId: ORG_ID,
        postId: POST_ID.toString(),
        limit: 25,
      });

      expect(getComments).toHaveBeenNthCalledWith(
        1,
        expect.anything(),
        EXTERNAL_POST_ID,
        'resume-here',
      );
    });

    it('walks every platform page until the list is exhausted', async () => {
      findPublishedPost.mockResolvedValue(post);
      getSyncState.mockResolvedValue(stale());
      getComments
        .mockResolvedValueOnce(platformPage([fetched('c1')], 'page-2'))
        .mockResolvedValueOnce(platformPage([fetched('c2')], null));

      await service.getComments({
        orgId: ORG_ID,
        postId: POST_ID.toString(),
        limit: 25,
      });

      expect(getComments).toHaveBeenCalledTimes(2);
      expect(getComments).toHaveBeenNthCalledWith(
        2,
        expect.anything(),
        EXTERNAL_POST_ID,
        'page-2',
      );
      expect(upsertFetched).toHaveBeenCalledTimes(2);
      expect(saveSyncState).toHaveBeenCalledWith(
        POST_ID,
        null,
        expect.any(Date),
      );
    });

    it('caps a single refresh and saves the cursor to resume next time', async () => {
      findPublishedPost.mockResolvedValue(post);
      getSyncState.mockResolvedValue(stale());
      // Never returns null: the cap, not exhaustion, must stop the loop.
      getComments.mockResolvedValue(
        platformPage([fetched('c')], 'always-more'),
      );

      await service.getComments({
        orgId: ORG_ID,
        postId: POST_ID.toString(),
        limit: 25,
      });

      // Bounded, and the unfinished cursor is persisted for the next refresh.
      const calls = getComments.mock.calls.length;
      expect(calls).toBeGreaterThan(1);
      expect(calls).toBeLessThanOrEqual(20);
      expect(saveSyncState).toHaveBeenCalledWith(
        POST_ID,
        'always-more',
        expect.any(Date),
      );
    });
  });

  describe('pagination', () => {
    it('does NOT refresh when a cursor is supplied, even if stale', async () => {
      findPublishedPost.mockResolvedValue(post);
      getSyncState.mockResolvedValue(stale());

      await service.getComments({
        orgId: ORG_ID,
        postId: POST_ID.toString(),
        cursor: 'page-2-cursor',
        limit: 10,
      });

      expect(getComments).not.toHaveBeenCalled();
      expect(saveSyncState).not.toHaveBeenCalled();
      expect(pageComments).toHaveBeenCalledWith(POST_ID, 'page-2-cursor', 10);
    });

    it('passes the store cursor through and returns syncedAt from the bookmark', async () => {
      // Fresh (recent) so this stays a cache hit; assert the exact stamp flows out.
      const when = new Date();
      const localPage: Page<Comment> = { items: [], nextCursor: 'next-page' };
      findPublishedPost.mockResolvedValue(post);
      getSyncState.mockResolvedValue(syncState({ lastSyncedAt: when }));
      pageComments.mockResolvedValue(localPage);

      const result = await service.getComments({
        orgId: ORG_ID,
        postId: POST_ID.toString(),
        limit: 25,
      });

      expect(result.page.nextCursor).toBe('next-page');
      expect(result.syncedAt).toEqual(when);
    });
  });

  describe('replyToComment', () => {
    const COMMENT_ID = new Types.ObjectId();
    const IDEMPOTENCY_KEY = 'key-1';
    const EXTERNAL_COMMENT_ID = 'ext-comment-1';

    const comment = {
      _id: COMMENT_ID,
      externalCommentId: EXTERNAL_COMMENT_ID,
      platform: Platform.Mock,
    };
    const target = { comment, post } as unknown as ReplyTarget;

    const fetchedReply: FetchedReply = {
      externalCommentId: 'ext-reply-1',
      externalParentCommentId: EXTERNAL_COMMENT_ID,
      author: { externalAuthorId: 'me', displayName: 'Me' },
      text: 'thanks!',
      platformCreatedAt: new Date(),
    };

    const savedReply = {
      id: 'reply-doc-1',
      postId: POST_ID.toString(),
      platform: Platform.Mock,
      parentCommentId: COMMENT_ID.toString(),
      author: { id: 'me', displayName: 'Me' },
      text: 'thanks!',
      createdAt: fetchedReply.platformCreatedAt,
      syncedAt: new Date(),
    };

    const reply = () =>
      service.replyToComment({
        orgId: ORG_ID,
        commentId: COMMENT_ID.toString(),
        text: 'thanks!',
        idempotencyKey: IDEMPOTENCY_KEY,
      });

    it('rejects a missing / cross-tenant / unpublished comment', async () => {
      findReplyTarget.mockResolvedValue(null);

      await expect(reply()).rejects.toBeInstanceOf(CommentNotFoundError);
      expect(beginReplyClaim).not.toHaveBeenCalled();
      expect(replyToComment).not.toHaveBeenCalled();
    });

    it('claims the outbox, then writes through to the platform and persists', async () => {
      findReplyTarget.mockResolvedValue(target);
      beginReplyClaim.mockResolvedValue({ outcome: 'claimed' });
      replyToComment.mockResolvedValue(fetchedReply);
      completeReply.mockResolvedValue(savedReply);

      const result = await reply();

      // Claim happens before the send (the single-flight gate).
      expect(beginReplyClaim).toHaveBeenCalledWith(
        IDEMPOTENCY_KEY,
        COMMENT_ID,
        ORG_ID,
      );
      expect(replyToComment).toHaveBeenCalledWith(
        { platformAccountId: ACCOUNT_ID.toString() },
        EXTERNAL_COMMENT_ID,
        { text: 'thanks!' },
      );
      expect(completeReply).toHaveBeenCalledWith(
        target,
        fetchedReply,
        IDEMPOTENCY_KEY,
        expect.any(Date),
      );
      expect(result).toBe(savedReply);
      expect(abandonReplyClaim).not.toHaveBeenCalled();
    });

    it('replays the stored reply for an already-sent key without resending', async () => {
      findReplyTarget.mockResolvedValue(target);
      beginReplyClaim.mockResolvedValue({
        outcome: 'already-sent',
        externalReplyId: 'ext-reply-1',
      });
      findPersistedReply.mockResolvedValue(savedReply);

      const result = await reply();

      expect(result).toBe(savedReply);
      // The whole point of idempotency: no second post to the platform (RK-4).
      expect(replyToComment).not.toHaveBeenCalled();
      expect(completeReply).not.toHaveBeenCalled();
      expect(findPersistedReply).toHaveBeenCalledWith(
        COMMENT_ID,
        'ext-reply-1',
      );
    });

    it('refuses an in-progress key rather than risk a double-post', async () => {
      findReplyTarget.mockResolvedValue(target);
      beginReplyClaim.mockResolvedValue({ outcome: 'in-progress' });

      await expect(reply()).rejects.toBeInstanceOf(ReplyInProgressError);
      expect(replyToComment).not.toHaveBeenCalled();
      expect(completeReply).not.toHaveBeenCalled();
    });

    it('treats a sent claim whose reply is not yet visible as in-progress', async () => {
      findReplyTarget.mockResolvedValue(target);
      beginReplyClaim.mockResolvedValue({
        outcome: 'already-sent',
        externalReplyId: 'ext-reply-1',
      });
      // Marked sent, but the reply row isn't queryable yet (crash window).
      findPersistedReply.mockResolvedValue(null);

      await expect(reply()).rejects.toBeInstanceOf(ReplyInProgressError);
      expect(replyToComment).not.toHaveBeenCalled();
    });

    it('releases the claim and rethrows the typed error when the send fails, persisting nothing', async () => {
      const platformError = new Error('platform said no');
      findReplyTarget.mockResolvedValue(target);
      beginReplyClaim.mockResolvedValue({ outcome: 'claimed' });
      replyToComment.mockRejectedValue(platformError);

      await expect(reply()).rejects.toBe(platformError);
      expect(abandonReplyClaim).toHaveBeenCalledWith(IDEMPOTENCY_KEY);
      // No orphaned persisted reply on failure (DoD).
      expect(completeReply).not.toHaveBeenCalled();
    });
  });
});
