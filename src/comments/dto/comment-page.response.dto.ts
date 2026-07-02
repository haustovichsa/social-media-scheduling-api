import { ApiProperty } from '@nestjs/swagger';

import { Comment, Page } from '../../domain';
import { CommentResponseDto } from './comment.response.dto';

/**
 * Wire shape of one page of comments: the items, the opaque `nextCursor` for the
 * following page (`null` at end of list), and a list-level `syncedAt` telling the
 * caller how fresh this view is — we surface staleness rather than hide that this
 * is a local copy.
 */
export class CommentPageResponseDto {
  @ApiProperty({ type: [CommentResponseDto] })
  comments!: CommentResponseDto[];

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Opaque cursor for the next page, or null when there are no more.',
  })
  nextCursor!: string | null;

  @ApiProperty({
    format: 'date-time',
    description: 'ISO-8601. How fresh this page is against the platform.',
  })
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
