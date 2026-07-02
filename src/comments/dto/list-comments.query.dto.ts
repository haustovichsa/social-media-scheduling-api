import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Page size used when the caller does not ask for one. */
export const DEFAULT_PAGE_LIMIT = 25;
/** Hard ceiling on page size, so one request can't ask for an unbounded page. */
export const MAX_PAGE_LIMIT = 100;

/**
 * Query parameters for `GET /posts/:postId/comments`. Cursor paging only: omit
 * `cursor` for the first page, or echo back the previous page's `nextCursor`.
 * `cursor` stays an opaque string here — this layer never reads it (see
 * {@link PageCursor}).
 *
 * `limit` arrives as a string, so `@Type(() => Number)` coerces it before the
 * numeric checks run. The global `ValidationPipe`'s `whitelist` /
 * `forbidNonWhitelisted` reject any unknown query param.
 */
export class ListCommentsQueryDto {
  @ApiPropertyOptional({
    description:
      'Opaque forward cursor. Omit for the first page; echo back the previous ' +
      'page’s `nextCursor` for subsequent pages.',
  })
  @IsOptional()
  @IsString()
  cursor?: string;

  @ApiPropertyOptional({
    description: 'Page size.',
    minimum: 1,
    maximum: MAX_PAGE_LIMIT,
    default: DEFAULT_PAGE_LIMIT,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit: number = DEFAULT_PAGE_LIMIT;
}
