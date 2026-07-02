import { INestApplication } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import request from 'supertest';
import { App } from 'supertest/types';

import { AuthGuard, Caller, CALLER_RESOLVER } from '../src/auth';
import { Platform } from '../src/common/enums/platform.enum';
import { ApiErrorResponse } from '../src/common/http';
import { CommentController } from '../src/comments/comment.controller';
import { CommentResponseDto } from '../src/comments/dto';
import { PostNotFoundError } from '../src/comments/comment-errors';
import { CommentService } from '../src/comments/comment.service';
import { Comment, Page, Reply } from '../src/domain';
import { RateLimitError } from '../src/platforms/platform-errors';
import { configureApp } from '../src/setup-app';

/**
 * HTTP-level tests for the comment endpoints, wired exactly as `main.ts` does via
 * the shared {@link configureApp} — global `ValidationPipe` +
 * `DomainExceptionFilter` — plus the real {@link AuthGuard} over a stub
 * {@link CallerResolver}. The {@link CommentService} is mocked so the run needs
 * no Mongo or network. They prove the edge end to end: auth rejects
 * unauthenticated requests, the resolved org scopes the call, validation rejects
 * bad input, our shared shapes go out on success, and typed errors map to the
 * documented HTTP codes and envelope.
 */
describe('Comments (e2e)', () => {
  // Two dev API keys mapping to two tenants, via the stub resolver below.
  const ORG1_AUTH: [string, string] = ['Authorization', 'Bearer org-1-key'];
  const ORG2_AUTH: [string, string] = ['Authorization', 'Bearer org-2-key'];

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
  const orgByKey: Record<string, string> = {
    'org-1-key': 'org-1',
    'org-2-key': 'org-2',
  };
  const resolve = jest.fn<Promise<Caller | null>, [string]>((credential) =>
    Promise.resolve(
      orgByKey[credential] ? { orgId: orgByKey[credential] } : null,
    ),
  );

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      controllers: [CommentController],
      providers: [
        { provide: CommentService, useValue: { getComments, replyToComment } },
        { provide: CALLER_RESOLVER, useValue: { resolve } },
        AuthGuard,
      ],
    }).compile();

    app = moduleFixture.createNestApplication();
    configureApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    getComments.mockReset();
    replyToComment.mockReset();
  });

  describe('authentication (AC-4)', () => {
    it('rejects a request with no credentials as 401', async () => {
      const res = await request(app.getHttpServer())
        .get('/posts/p1/comments')
        .expect(401);

      expect((res.body as ApiErrorResponse).code).toBe('UNAUTHORIZED');
      expect(getComments).not.toHaveBeenCalled();
    });

    it('rejects an unknown API key as 401', async () => {
      await request(app.getHttpServer())
        .get('/posts/p1/comments')
        .set('Authorization', 'Bearer nope')
        .expect(401);
      expect(getComments).not.toHaveBeenCalled();
    });

    it('scopes the call to the tenant the credential resolves to', async () => {
      getComments.mockResolvedValue({
        page: { items: [], nextCursor: null } as Page<Comment>,
        syncedAt,
      });

      await request(app.getHttpServer())
        .get('/posts/p1/comments')
        .set(...ORG2_AUTH)
        .expect(200);

      expect(getComments).toHaveBeenCalledWith(
        expect.objectContaining({ orgId: 'org-2', postId: 'p1' }),
      );
    });
  });

  describe('GET /posts/:postId/comments', () => {
    it('returns a canonical page with ISO dates', async () => {
      const page: Page<Comment> = { items: [comment], nextCursor: 'next-1' };
      getComments.mockResolvedValue({ page, syncedAt });

      const res = await request(app.getHttpServer())
        .get('/posts/p1/comments')
        .set(...ORG1_AUTH)
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
        .set(...ORG1_AUTH)
        .query({ limit: 9999 })
        .expect(400);

      expect((res.body as ApiErrorResponse).code).toBe('VALIDATION_FAILED');
      expect(getComments).not.toHaveBeenCalled();
    });

    it('rejects an unknown query param', async () => {
      await request(app.getHttpServer())
        .get('/posts/p1/comments')
        .set(...ORG1_AUTH)
        .query({ bogus: 'x' })
        .expect(400);
    });

    it('maps a cross-tenant / missing post to a 404 envelope', async () => {
      getComments.mockRejectedValue(new PostNotFoundError('p1'));

      const res = await request(app.getHttpServer())
        .get('/posts/p1/comments')
        .set(...ORG1_AUTH)
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
        .set(...ORG1_AUTH)
        .send({ text: 'thanks!' })
        .expect(201);

      const body = res.body as CommentResponseDto;
      expect(body.id).toBe('r1');
      expect(body.parentCommentId).toBe('c1');
      expect(replyToComment).toHaveBeenCalledWith({
        orgId: 'org-1',
        commentId: 'c1',
        text: 'thanks!',
      });
    });

    it('requires authentication', async () => {
      await request(app.getHttpServer())
        .post('/comments/c1/replies')
        .send({ text: 'thanks!' })
        .expect(401);
      expect(replyToComment).not.toHaveBeenCalled();
    });

    it('rejects a body with empty text', async () => {
      const res = await request(app.getHttpServer())
        .post('/comments/c1/replies')
        .set(...ORG1_AUTH)
        .send({ text: '' })
        .expect(400);

      expect((res.body as ApiErrorResponse).code).toBe('VALIDATION_FAILED');
      expect(replyToComment).not.toHaveBeenCalled();
    });

    it('maps a platform rate limit to 429 with Retry-After', async () => {
      replyToComment.mockRejectedValue(
        new RateLimitError(Platform.Mock, 3_000),
      );

      const res = await request(app.getHttpServer())
        .post('/comments/c1/replies')
        .set(...ORG1_AUTH)
        .send({ text: 'thanks!' })
        .expect(429);

      expect((res.body as ApiErrorResponse).code).toBe('RATE_LIMITED');
      expect(res.headers['retry-after']).toBe('3');
    });
  });
});
