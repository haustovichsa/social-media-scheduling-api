import { ApiProperty } from '@nestjs/swagger';

/**
 * The single, uniform error envelope every failed request returns. Small and
 * platform-free: a stable machine-readable `code` for clients to branch on, a
 * safe human `message`, plus the HTTP `statusCode` and its reason phrase.
 * {@link DomainExceptionFilter} builds it from our typed errors, so raw platform
 * payloads and error `cause` chains can't leak to the caller.
 */
export class ApiErrorResponse {
  @ApiProperty({ example: 404, description: 'HTTP status code.' })
  statusCode!: number;

  @ApiProperty({
    example: 'Not Found',
    description: 'HTTP status reason phrase.',
  })
  error!: string;

  @ApiProperty({
    example: 'POST_NOT_FOUND',
    description:
      'Stable machine-readable error code. Clients branch on this, not on the message.',
  })
  code!: string;

  @ApiProperty({
    example: 'Post "645f…" not found',
    description: 'Human-readable, safe-to-display explanation.',
  })
  message!: string;
}
