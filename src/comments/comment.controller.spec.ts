import { Test, TestingModule } from '@nestjs/testing';

import { AuthGuard } from '../auth';
import { Platform } from '../common/enums/platform.enum';
import { Comment, Page, Reply } from '../domain';
import { CommentController } from './comment.controller';
import { CommentService } from './comment.service';
import { ListCommentsQueryDto } from './dto';

/**
 * Unit tests for the controller's mapping and delegation (TASK-09). The service
 * is mocked and these call the handlers directly, so they assert only what the
 * edge owns: it passes the resolved org and route/query params straight through,
 * and maps the canonical result up to the wire DTOs. Error translation is the
 * filter's job and the {@link AuthGuard} its own — both tested separately — so
 * the guard is stubbed out here.
 */
describe('CommentController', () => {
  const ORG_ID = 'org-1';
  const createdAt = new Date('2026-01-02T03:04:05.000Z');
  const syncedAt = new Date('2026-01-02T04:00:00.000Z');

  const comment: Comment = {
    id: 'c1',
    postId: 'p1',
    platform: Platform.Facebook,
    parentCommentId: null,
    author: { id: 'a1', displayName: 'Ada' },
    text: 'hello',
    createdAt,
    syncedAt,
  };

  let getComments: jest.Mock;
  let replyToComment: jest.Mock;
  let controller: CommentController;

  beforeEach(async () => {
    getComments = jest.fn();
    replyToComment = jest.fn();

    const module: TestingModule = await Test.createTestingModule({
      controllers: [CommentController],
      providers: [
        { provide: CommentService, useValue: { getComments, replyToComment } },
      ],
    })
      .overrideGuard(AuthGuard)
      .useValue({ canActivate: () => true })
      .compile();

    controller = module.get(CommentController);
  });

  describe('GET /posts/:postId/comments', () => {
    it('passes the org, post id and paging params through and maps the page', async () => {
      const page: Page<Comment> = { items: [comment], nextCursor: 'next-1' };
      getComments.mockResolvedValue({ page, syncedAt });

      const query = Object.assign(new ListCommentsQueryDto(), {
        cursor: 'cur-0',
        limit: 10,
      });
      const result = await controller.listComments(ORG_ID, 'p1', query);

      expect(getComments).toHaveBeenCalledWith({
        orgId: ORG_ID,
        postId: 'p1',
        cursor: 'cur-0',
        limit: 10,
      });
      expect(result.comments).toHaveLength(1);
      expect(result.comments[0].id).toBe('c1');
      expect(result.nextCursor).toBe('next-1');
      expect(result.syncedAt).toBe(syncedAt.toISOString());
    });

    it('surfaces the service error unchanged (the filter maps it)', async () => {
      const boom = new Error('nope');
      getComments.mockRejectedValue(boom);

      await expect(
        controller.listComments(ORG_ID, 'p1', new ListCommentsQueryDto()),
      ).rejects.toBe(boom);
    });
  });

  describe('POST /comments/:commentId/replies', () => {
    it('passes the reply body through and maps the created reply', async () => {
      const reply: Reply = { ...comment, id: 'r1', parentCommentId: 'c1' };
      replyToComment.mockResolvedValue(reply);

      const result = await controller.replyToComment(ORG_ID, 'c1', {
        text: 'thanks!',
      });

      expect(replyToComment).toHaveBeenCalledWith({
        orgId: ORG_ID,
        commentId: 'c1',
        text: 'thanks!',
      });
      expect(result.id).toBe('r1');
      expect(result.parentCommentId).toBe('c1');
    });
  });
});
