import { ApiProperty } from '@nestjs/swagger';

import { Platform } from '../../common/enums/platform.enum';
import { Comment } from '../../domain';
import { AuthorResponseDto } from './author.response.dto';

/**
 * Wire shape of a {@link Comment}. Dates go out as ISO-8601 strings so the JSON
 * contract is explicit and stable. Domain → DTO mapping happens here.
 */
export class CommentResponseDto {
  @ApiProperty({ description: 'Our internal comment id.' })
  id!: string;

  @ApiProperty({
    description: 'Our internal id of the post this comment belongs to.',
  })
  postId!: string;

  @ApiProperty({
    enum: Platform,
    description: 'The platform this comment came from.',
  })
  platform!: Platform;

  @ApiProperty({
    type: String,
    nullable: true,
    description:
      'Parent comment id for a threaded reply, or null for a top-level comment.',
  })
  parentCommentId!: string | null;

  @ApiProperty({ type: AuthorResponseDto })
  author!: AuthorResponseDto;

  @ApiProperty({ description: 'The comment body.' })
  text!: string;

  @ApiProperty({
    format: 'date-time',
    description: 'ISO-8601. Platform-reported creation time.',
  })
  createdAt!: string;

  @ApiProperty({
    format: 'date-time',
    description:
      'ISO-8601. When we last reconciled this comment with the platform.',
  })
  syncedAt!: string;

  static fromDomain(comment: Comment): CommentResponseDto {
    const dto = new CommentResponseDto();
    dto.id = comment.id;
    dto.postId = comment.postId;
    dto.platform = comment.platform;
    dto.parentCommentId = comment.parentCommentId;
    dto.author = AuthorResponseDto.fromDomain(comment.author);
    dto.text = comment.text;
    dto.createdAt = comment.createdAt.toISOString();
    dto.syncedAt = comment.syncedAt.toISOString();
    return dto;
  }
}
