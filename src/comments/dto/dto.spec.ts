import 'reflect-metadata';

import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

import { Platform } from '../../common/enums/platform.enum';
import { Comment, Page, Reply } from '../../domain';
import { CommentPageResponseDto } from './comment-page.response.dto';
import { CommentResponseDto } from './comment.response.dto';
import { CreateReplyDto, MAX_REPLY_LENGTH } from './create-reply.dto';
import {
  DEFAULT_PAGE_LIMIT,
  ListCommentsQueryDto,
  MAX_PAGE_LIMIT,
} from './list-comments.query.dto';

/**
 * Mirrors what the global `ValidationPipe` does: transform the raw payload into
 * the DTO class (coercing query strings) then validate, and collect the property
 * names that failed. `enableImplicitConversion` is off — the DTOs declare their
 * own `@Type` where coercion is intended, matching the pipe config in main.ts.
 */
function validateDto<T extends object>(
  cls: new () => T,
  payload: unknown,
): string[] {
  const instance = plainToInstance(cls, payload);
  return validateSync(instance as object, { whitelist: true }).map(
    (e) => e.property,
  );
}

describe('CreateReplyDto', () => {
  it('accepts a well-formed body', () => {
    expect(validateDto(CreateReplyDto, { text: 'thanks!' })).toEqual([]);
  });

  it('rejects empty text', () => {
    expect(validateDto(CreateReplyDto, { text: '' })).toContain('text');
  });

  it('rejects text over the max length', () => {
    expect(
      validateDto(CreateReplyDto, {
        text: 'x'.repeat(MAX_REPLY_LENGTH + 1),
      }),
    ).toContain('text');
  });

  it('rejects a non-string text', () => {
    expect(validateDto(CreateReplyDto, { text: 42 })).toContain('text');
  });
});

describe('ListCommentsQueryDto', () => {
  it('defaults the limit when omitted', () => {
    const dto = plainToInstance(ListCommentsQueryDto, {});
    expect(validateSync(dto)).toEqual([]);
    expect(dto.limit).toBe(DEFAULT_PAGE_LIMIT);
    expect(dto.cursor).toBeUndefined();
  });

  it('coerces a numeric-string limit and accepts a cursor', () => {
    const dto = plainToInstance(ListCommentsQueryDto, {
      limit: '10',
      cursor: 'opaque-abc',
    });
    expect(validateSync(dto)).toEqual([]);
    expect(dto.limit).toBe(10);
    expect(dto.cursor).toBe('opaque-abc');
  });

  it('rejects a limit above the max and below the min', () => {
    expect(
      validateDto(ListCommentsQueryDto, { limit: String(MAX_PAGE_LIMIT + 1) }),
    ).toContain('limit');
    expect(validateDto(ListCommentsQueryDto, { limit: '0' })).toContain(
      'limit',
    );
  });

  it('rejects a non-integer limit', () => {
    expect(validateDto(ListCommentsQueryDto, { limit: '1.5' })).toContain(
      'limit',
    );
  });
});

describe('response DTO mapping (domain → wire)', () => {
  const createdAt = new Date('2026-01-02T03:04:05.000Z');
  const syncedAt = new Date('2026-01-02T04:00:00.000Z');

  const comment: Comment = {
    id: 'c1',
    postId: 'p1',
    platform: Platform.Facebook,
    parentCommentId: null,
    author: { id: 'a1', displayName: 'Ada', avatarUrl: 'http://x/a.png' },
    text: 'hello',
    createdAt,
    syncedAt,
  };

  it('serialises dates to ISO strings and maps the author', () => {
    const dto = CommentResponseDto.fromDomain(comment);
    expect(dto.createdAt).toBe(createdAt.toISOString());
    expect(dto.syncedAt).toBe(syncedAt.toISOString());
    expect(dto.parentCommentId).toBeNull();
    expect(dto.author).toMatchObject({ id: 'a1', displayName: 'Ada' });
  });

  it('maps a reply through the shared comment DTO, keeping its parent', () => {
    const reply: Reply = { ...comment, parentCommentId: 'c1' };
    const dto = CommentResponseDto.fromDomain(reply);
    expect(dto.parentCommentId).toBe('c1');
  });

  it('maps a page, carrying cursor and list-level syncedAt', () => {
    const page: Page<Comment> = { items: [comment], nextCursor: 'next-1' };
    const dto = CommentPageResponseDto.fromDomain(page, syncedAt);
    expect(dto.comments).toHaveLength(1);
    expect(dto.nextCursor).toBe('next-1');
    expect(dto.syncedAt).toBe(syncedAt.toISOString());
  });

  it('reports end of list as a null cursor', () => {
    const page: Page<Comment> = { items: [], nextCursor: null };
    expect(
      CommentPageResponseDto.fromDomain(page, syncedAt).nextCursor,
    ).toBeNull();
  });
});
