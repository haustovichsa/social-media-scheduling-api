import { Comment, Page } from '../../domain';
import { CommentResponseDto } from './comment.response.dto';

/**
 * Wire shape of one page of comments (FR-1, AC-1). Carries the paged items, the
 * opaque `nextCursor` to fetch the following page (`null` at end of list), and a
 * list-level `syncedAt` telling the caller how fresh this view is — the read
 * service surfaces staleness rather than hiding the fact that this is a local
 * copy (A-4, NFR-6).
 */
export class CommentPageResponseDto {
  comments!: CommentResponseDto[];
  /** Opaque cursor for the next page, or `null` when there are no more. */
  nextCursor!: string | null;
  /** ISO-8601. How fresh this page is against the platform. */
  syncedAt!: string;

  static fromDomain(
    page: Page<Comment>,
    syncedAt: Date,
  ): CommentPageResponseDto {
    const dto = new CommentPageResponseDto();
    dto.comments = page.items.map((c) => CommentResponseDto.fromDomain(c));
    dto.nextCursor = page.nextCursor;
    dto.syncedAt = syncedAt.toISOString();
    return dto;
  }
}
