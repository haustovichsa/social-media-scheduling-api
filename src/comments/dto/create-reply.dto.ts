import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Cap on reply length. Our own conservative limit; the real limit is
 * platform-specific and enforced by the adapter at send time. This just rejects
 * obviously oversized bodies before we call a platform.
 */
export const MAX_REPLY_LENGTH = 5000;

/**
 * Request body for `POST /comments/:commentId/replies`.
 *
 * A client-owned idempotency key that makes retrying the same send safe is
 * designed but not built — see DESIGN.md §4.
 */
export class CreateReplyDto {
  @ApiProperty({
    description: 'The reply text to post to the platform.',
    maxLength: MAX_REPLY_LENGTH,
    example: 'Thanks for the feedback!',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_REPLY_LENGTH)
  text!: string;
}
