import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Cap on reply length. This is our own conservative limit; the true limit is
 * platform-specific and enforced by the adapter at send time — this just rejects
 * obviously oversized bodies before we ever call a platform.
 */
export const MAX_REPLY_LENGTH = 5000;

/**
 * Request body for `POST /comments/:commentId/replies` (FR-2).
 *
 * A client-owned idempotency key that makes retrying the *same* logical send
 * safe (at-most-once delivery) is a designed-not-built seam — see DESIGN.md §4.
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
