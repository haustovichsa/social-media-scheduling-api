import { Type } from 'class-transformer';
import { IsInt, IsOptional, IsString, Max, Min } from 'class-validator';

/** Page size used when the caller does not ask for one. */
export const DEFAULT_PAGE_LIMIT = 25;
/** Hard ceiling on page size, so one request can't ask for an unbounded page. */
export const MAX_PAGE_LIMIT = 100;

/**
 * Query parameters for `GET /posts/:postId/comments` (FR-1). Cursor paging only:
 * the caller either omits `cursor` (first page) or echoes back the `nextCursor`
 * from the previous page. `cursor` stays a plain opaque string here — this layer
 * never interprets it (see {@link PageCursor}).
 *
 * `limit` arrives as a string on the query string, so `@Type(() => Number)`
 * coerces it before the numeric checks run (the global `ValidationPipe` is
 * configured with `transform: true`). `whitelist`/`forbidNonWhitelisted` on that
 * pipe reject any unknown query param.
 */
export class ListCommentsQueryDto {
  @IsOptional()
  @IsString()
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_LIMIT)
  limit: number = DEFAULT_PAGE_LIMIT;
}
