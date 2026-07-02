import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/**
 * Cap on reply length. This is our own conservative limit; the true limit is
 * platform-specific and enforced by the adapter at send time — this just rejects
 * obviously oversized bodies before we ever call a platform.
 */
export const MAX_REPLY_LENGTH = 5000;
/** Cap on the idempotency key — a client-supplied token, not free text. */
export const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

/**
 * Request body for `POST /comments/:commentId/replies` (FR-2).
 *
 * `idempotencyKey` is required and is the dedupe key for the whole send: the
 * reply outbox has a unique index on it, so a retry carrying the same key can
 * never post the reply twice (RK-4). Making the client own the key means a
 * network retry of the *same* logical request is safe, while two genuinely
 * different replies simply use two different keys.
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

  @ApiProperty({
    description:
      'Client-owned dedupe key for the whole send. Retrying with the same key ' +
      'never posts twice (RK-4).',
    maxLength: MAX_IDEMPOTENCY_KEY_LENGTH,
    example: 'a1b2c3d4-reply-once',
  })
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_IDEMPOTENCY_KEY_LENGTH)
  idempotencyKey!: string;
}
