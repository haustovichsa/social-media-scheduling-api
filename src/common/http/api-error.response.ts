import { ApiProperty } from '@nestjs/swagger';

/**
 * The single, uniform error envelope every failed request returns (AC-5). It is
 * intentionally small and platform-free: a stable machine-readable `code` for
 * clients to branch on, a safe human `message`, plus the HTTP `statusCode` and
 * its reason phrase. Raw platform payloads and error `cause` chains never reach
 * this shape — {@link DomainExceptionFilter} builds it from our typed errors, so
 * a vendor's response body can't leak to the caller (RK-1, RK-6).
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
