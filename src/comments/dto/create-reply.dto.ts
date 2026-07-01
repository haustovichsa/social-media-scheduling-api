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
  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_REPLY_LENGTH)
  text!: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(MAX_IDEMPOTENCY_KEY_LENGTH)
  idempotencyKey!: string;
}
