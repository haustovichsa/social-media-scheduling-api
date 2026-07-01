import { Platform } from '../../common/enums/platform.enum';
import { Comment } from '../../domain';
import { AuthorResponseDto } from './author.response.dto';

/**
 * Wire shape of a {@link Comment}. Dates are serialised as ISO-8601 strings so
 * the JSON contract is explicit and stable regardless of how the transport
 * serialises `Date`. Mapping domain → DTO happens here at the API boundary.
 */
export class CommentResponseDto {
  id!: string;
  postId!: string;
  platform!: Platform;
  parentCommentId!: string | null;
  author!: AuthorResponseDto;
  text!: string;
  /** ISO-8601. Platform-reported creation time. */
  createdAt!: string;
  /** ISO-8601. When we last reconciled this comment with the platform. */
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
