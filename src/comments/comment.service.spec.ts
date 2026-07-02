import { Types } from 'mongoose';

import { Platform } from '../common/enums/platform.enum';
import { Comment, Page } from '../domain';
import { PostDocument } from '../persistence/schemas/post.schema';
import { AdapterRegistry, FetchedComment, FetchedReply } from '../platforms';
import { CommentNotFoundError, PostNotFoundError } from './comment-errors';
import { CommentRepository, ReplyTarget } from './comment.repository';
import { CommentService } from './comment.service';

/**
 * Unit tests for the comment service. The repository and the resolved adapter are
 * mocked, so these assert *behaviour* — when a refresh runs, how it drains the
 * platform, and the write-through reply flow — without a database or a network.
 * The repository's own storage mechanics are covered separately against
 * in-memory Mongo.
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
  let upsertFetched: jest.Mock;
  let pageComments: jest.Mock;
  let getComments: jest.Mock;
  let findReplyTarget: jest.Mock;
  let saveReply: jest.Mock;
  let replyToComment: jest.Mock;
  let service: CommentService;

  const post = {
    _id: POST_ID,
    platform: Platform.Mock,
    platformAccountId: ACCOUNT_ID,
    externalPostId: EXTERNAL_POST_ID,
    orgId: ORG_ID,
  } as unknown as PostDocument;

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
    upsertFetched = jest.fn().mockResolvedValue(undefined);
    pageComments = jest.fn().mockResolvedValue(emptyLocalPage);
    getComments = jest.fn();
    findReplyTarget = jest.fn();
    saveReply = jest.fn();
    replyToComment = jest.fn();

    const repository = {
      findPublishedPost,
      upsertFetched,
      pageComments,
      findReplyTarget,
      saveReply,
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

  describe('refresh (first page)', () => {
    it('refreshes from the top and upserts, then pages from the store', async () => {
      findPublishedPost.mockResolvedValue(post);
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
      expect(pageComments).toHaveBeenCalledWith(POST_ID, undefined, 25);
    });

    it('walks every platform page until the list is exhausted', async () => {
      findPublishedPost.mockResolvedValue(post);
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
    });

    it('caps a single refresh so it cannot crawl unbounded', async () => {
      findPublishedPost.mockResolvedValue(post);
      // Never returns null: the cap, not exhaustion, must stop the loop.
      getComments.mockResolvedValue(
        platformPage([fetched('c')], 'always-more'),
      );

      await service.getComments({
        orgId: ORG_ID,
        postId: POST_ID.toString(),
        limit: 25,
      });

      const calls = getComments.mock.calls.length;
      expect(calls).toBeGreaterThan(1);
      expect(calls).toBeLessThanOrEqual(50);
    });
  });

  describe('pagination', () => {
    it('does NOT refresh when a cursor is supplied', async () => {
      findPublishedPost.mockResolvedValue(post);

      await service.getComments({
        orgId: ORG_ID,
        postId: POST_ID.toString(),
        cursor: 'page-2-cursor',
        limit: 10,
      });

      expect(getComments).not.toHaveBeenCalled();
      expect(pageComments).toHaveBeenCalledWith(POST_ID, 'page-2-cursor', 10);
    });

    it('surfaces the latest row syncedAt as the page freshness stamp', async () => {
      const when = new Date('2026-01-01T00:00:00.000Z');
      const item = {
        id: 'c1',
        postId: POST_ID.toString(),
        platform: Platform.Mock,
        parentCommentId: null,
        author: { id: 'ada', displayName: 'Ada' },
        text: 'hi',
        createdAt: when,
        syncedAt: when,
      } satisfies Comment;
      findPublishedPost.mockResolvedValue(post);
      pageComments.mockResolvedValue({
        items: [item],
        nextCursor: 'next-page',
      });

      const result = await service.getComments({
        orgId: ORG_ID,
        postId: POST_ID.toString(),
        cursor: 'some-cursor',
        limit: 25,
      });

      expect(result.page.nextCursor).toBe('next-page');
      expect(result.syncedAt).toEqual(when);
    });
  });

  describe('replyToComment', () => {
    const COMMENT_ID = new Types.ObjectId();
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
      });

    it('rejects a missing / cross-tenant / unpublished comment', async () => {
      findReplyTarget.mockResolvedValue(null);

      await expect(reply()).rejects.toBeInstanceOf(CommentNotFoundError);
      expect(replyToComment).not.toHaveBeenCalled();
    });

    it('writes through to the platform, then persists and returns the reply', async () => {
      findReplyTarget.mockResolvedValue(target);
      replyToComment.mockResolvedValue(fetchedReply);
      saveReply.mockResolvedValue(savedReply);

      const result = await reply();

      expect(replyToComment).toHaveBeenCalledWith(
        { platformAccountId: ACCOUNT_ID.toString() },
        EXTERNAL_COMMENT_ID,
        { text: 'thanks!' },
      );
      expect(saveReply).toHaveBeenCalledWith(
        target,
        fetchedReply,
        expect.any(Date),
      );
      expect(result).toBe(savedReply);
    });

    it('rethrows the typed error and persists nothing when the send fails', async () => {
      const platformError = new Error('platform said no');
      findReplyTarget.mockResolvedValue(target);
      replyToComment.mockRejectedValue(platformError);

      await expect(reply()).rejects.toBe(platformError);
      expect(saveReply).not.toHaveBeenCalled();
    });
  });
});
