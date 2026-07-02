import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { NextFunction, Response } from 'express';
import request from 'supertest';
import { App } from 'supertest/types';

import { Platform } from '../src/common/enums/platform.enum';
import { ApiErrorResponse, AuthenticatedRequest } from '../src/common/http';
import { CommentController } from '../src/comments/comment.controller';
import { CommentResponseDto } from '../src/comments/dto';
import {
  PostNotFoundError,
  ReplyInProgressError,
} from '../src/comments/comment-errors';
import { CommentService } from '../src/comments/comment.service';
import { Comment, Page, Reply } from '../src/domain';
import { RateLimitError } from '../src/platforms/platform-errors';
import { configureApp } from '../src/setup-app';

/**
 * HTTP-level tests for the comment endpoints (TASK-09), wired exactly as
 * `main.ts` wires them via the shared {@link configureApp} — global
 * `ValidationPipe` + `DomainExceptionFilter` — but with the
 * {@link CommentService} mocked so the run needs no Mongo or network. They prove
 * the edge end to end: validation rejects bad input, the canonical shapes go out
 * on success, and the typed taxonomy maps to the documented HTTP codes and
 * envelope (AC-5). A tiny middleware stands in for TASK-10's auth guard by
 * populating `req.orgId`.
 */
describe('Comments (e2e)', () => {
  const createdAt = new Date('2026-01-02T03:04:05.000Z');
  const syncedAt = new Date('2026-01-02T04:00:00.000Z');
  const comment: Comment = {
    id: 'c1',
    postId: 'p1',
    platform: Platform.Mock,
    parentCommentId: null,
    author: { id: 'a1', displayName: 'Ada' },
    text: 'hello',
    createdAt,
    syncedAt,
  };

  let app: INestApplication<App>;
  const getComments = jest.fn();
  const replyToComment = jest.fn();

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [CommentController],
      providers: [
        { provide: CommentService, useValue: { getComments, replyToComment } },
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    // Stand-in for TASK-10's auth/ownership guard.
    app.use((req: AuthenticatedRequest, _res: Response, next: NextFunction) => {
      req.orgId = 'org-1';
      next();
    });
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => jest.clearAllMocks());

  describe('GET /posts/:postId/comments', () => {
    it('returns a canonical page with ISO dates', async () => {
      const page: Page<Comment> = { items: [comment], nextCursor: 'next-1' };
      getComments.mockResolvedValue({ page, syncedAt });

      const res = await request(app.getHttpServer())
        .get('/posts/p1/comments')
        .query({ limit: 10 })
        .expect(200);

      expect(res.body).toEqual({
        comments: [
          {
            id: 'c1',
            postId: 'p1',
            platform: 'mock',
            parentCommentId: null,
            author: { id: 'a1', displayName: 'Ada' },
            text: 'hello',
            createdAt: createdAt.toISOString(),
            syncedAt: syncedAt.toISOString(),
          },
        ],
        nextCursor: 'next-1',
        syncedAt: syncedAt.toISOString(),
      });
      expect(getComments).toHaveBeenCalledWith({
        orgId: 'org-1',
        postId: 'p1',
        cursor: undefined,
        limit: 10,
      });
    });

    it('rejects an out-of-range limit with a 400 envelope', async () => {
      const res = await request(app.getHttpServer())
        .get('/posts/p1/comments')
        .query({ limit: 9999 })
        .expect(400);

      expect((res.body as ApiErrorResponse).code).toBe('VALIDATION_FAILED');
      expect(getComments).not.toHaveBeenCalled();
    });

    it('rejects an unknown query param', async () => {
      await request(app.getHttpServer())
        .get('/posts/p1/comments')
        .query({ bogus: 'x' })
        .expect(400);
    });

    it('maps a missing post to a 404 envelope', async () => {
      getComments.mockRejectedValue(new PostNotFoundError('p1'));

      const res = await request(app.getHttpServer())
        .get('/posts/p1/comments')
        .expect(404);

      expect(res.body).toMatchObject({
        statusCode: 404,
        error: 'Not Found',
        code: 'POST_NOT_FOUND',
      });
    });
  });

  describe('POST /comments/:commentId/replies', () => {
    it('creates a reply and returns 201 with the canonical shape', async () => {
      const reply: Reply = { ...comment, id: 'r1', parentCommentId: 'c1' };
      replyToComment.mockResolvedValue(reply);

      const res = await request(app.getHttpServer())
        .post('/comments/c1/replies')
        .send({ text: 'thanks!', idempotencyKey: 'k-1' })
        .expect(201);

      const body = res.body as CommentResponseDto;
      expect(body.id).toBe('r1');
      expect(body.parentCommentId).toBe('c1');
      expect(replyToComment).toHaveBeenCalledWith({
        orgId: 'org-1',
        commentId: 'c1',
        text: 'thanks!',
        idempotencyKey: 'k-1',
      });
    });

    it('rejects a body missing the idempotency key', async () => {
      const res = await request(app.getHttpServer())
        .post('/comments/c1/replies')
        .send({ text: 'thanks!' })
        .expect(400);

      expect((res.body as ApiErrorResponse).code).toBe('VALIDATION_FAILED');
      expect(replyToComment).not.toHaveBeenCalled();
    });

    it('maps an in-progress reply to a 409 envelope', async () => {
      replyToComment.mockRejectedValue(new ReplyInProgressError('k-1'));

      const res = await request(app.getHttpServer())
        .post('/comments/c1/replies')
        .send({ text: 'thanks!', idempotencyKey: 'k-1' })
        .expect(409);

      expect((res.body as ApiErrorResponse).code).toBe('REPLY_IN_PROGRESS');
    });

    it('maps a platform rate limit to 429 with Retry-After', async () => {
      replyToComment.mockRejectedValue(
        new RateLimitError(Platform.Mock, 3_000),
      );

      const res = await request(app.getHttpServer())
        .post('/comments/c1/replies')
        .send({ text: 'thanks!', idempotencyKey: 'k-2' })
        .expect(429);

      expect((res.body as ApiErrorResponse).code).toBe('RATE_LIMITED');
      expect(res.headers['retry-after']).toBe('3');
    });
  });
});
