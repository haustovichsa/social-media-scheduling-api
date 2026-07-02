import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';
import { STATUS_CODES } from 'node:http';

// Import the error types from their concrete modules (not the feature barrels)
// so this filter — pulled in transitively by every controller via the
// common/http barrel — doesn't create an import cycle back through the feature
// modules.
import {
  CommentNotFoundError,
  PostNotFoundError,
} from '../../comments/comment-errors';
import {
  AdapterNotFoundError,
  PlatformError,
  PlatformErrorCode,
  RateLimitError,
} from '../../platforms/platform-errors';
import { ApiErrorResponse } from './api-error.response';

/** How a mapped error should be rendered: status, our envelope, optional headers. */
interface MappedError {
  readonly status: number;
  readonly code: string;
  readonly message: string;
  /** Extra response headers (e.g. `Retry-After` on a 429). */
  readonly headers?: Readonly<Record<string, string>>;
}

/**
 * The response for a fault we won't describe: any server-side error (5xx),
 * whether it arrived raw or as an `HttpException`. Internals never reach the
 * caller (RK-6) — the real error is logged for operators instead.
 */
const OPAQUE_500: MappedError = {
  status: HttpStatus.INTERNAL_SERVER_ERROR,
  code: 'INTERNAL_ERROR',
  message: 'An unexpected error occurred.',
};

/**
 * Status + code for the simple domain errors, keyed by their constructor. These
 * all just carry the error's own `message`, so the table is the whole mapping —
 * no per-type branch needed. `AdapterNotFoundError` and `PlatformError` are
 * handled separately (they log / vary by code), so they're deliberately absent.
 */
type ErrorCtor = new (...args: never[]) => Error;

const DOMAIN_ERROR_MAP = new Map<ErrorCtor, { status: number; code: string }>([
  [PostNotFoundError, { status: HttpStatus.NOT_FOUND, code: 'POST_NOT_FOUND' }],
  [
    CommentNotFoundError,
    { status: HttpStatus.NOT_FOUND, code: 'COMMENT_NOT_FOUND' },
  ],
]);

/** A stable code for framework errors that carry no code of their own. */
const HTTP_ERROR_CODE: Readonly<Record<number, string>> = {
  [HttpStatus.BAD_REQUEST]: 'VALIDATION_FAILED',
  [HttpStatus.UNAUTHORIZED]: 'UNAUTHORIZED',
  [HttpStatus.FORBIDDEN]: 'FORBIDDEN',
  [HttpStatus.NOT_FOUND]: 'NOT_FOUND',
};

/**
 * Translates the whole typed error taxonomy into documented HTTP responses at
 * the single API edge (AC-5). The services and adapters stay transport-agnostic
 * and throw domain/`PlatformError`s; this filter is the one place that decides
 * status codes and shapes the {@link ApiErrorResponse} envelope — so no raw
 * platform response or error `cause` ever reaches the caller (RK-1, RK-6).
 *
 * It is a catch-all (`@Catch()`) with four branches in {@link resolve}:
 *  1. `PlatformError`s → mapped by their stable code;
 *  2. simple domain errors → the {@link DOMAIN_ERROR_MAP} table;
 *  3. framework `HttpException`s (e.g. the `ValidationPipe`'s 400) → preserved
 *     status, re-wrapped in the same envelope so every error looks alike;
 *  4. anything else (and our own misconfigurations) → an opaque 500.
 */
@Catch()
export class DomainExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(DomainExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const mapped = this.resolve(exception);

    if (mapped.headers) {
      for (const [name, value] of Object.entries(mapped.headers)) {
        response.setHeader(name, value);
      }
    }

    const body: ApiErrorResponse = {
      statusCode: mapped.status,
      // Reuse Node's built-in reason phrases rather than maintaining our own.
      error: STATUS_CODES[mapped.status] ?? 'Error',
      code: mapped.code,
      message: mapped.message,
    };
    response.status(mapped.status).json(body);
  }

  /** Pick the right branch, logging server-side/upstream faults for operators. */
  private resolve(exception: unknown): MappedError {
    if (exception instanceof PlatformError) {
      return this.mapPlatformError(exception);
    }

    if (exception instanceof Error) {
      const domain = DOMAIN_ERROR_MAP.get(exception.constructor as ErrorCtor);
      if (domain) {
        return { ...domain, message: exception.message };
      }
    }

    if (exception instanceof AdapterNotFoundError) {
      // A platform value with no registered adapter is our misconfiguration, not
      // a caller or platform fault. Log it and return an opaque 500.
      this.logger.error(exception.message);
      return OPAQUE_500;
    }

    if (exception instanceof HttpException) {
      return fromHttpException(exception);
    }

    // Unmapped: never surface internals. Log the real error for operators; the
    // caller gets a generic 500.
    this.logger.error('Unhandled exception', asError(exception).stack);
    return OPAQUE_500;
  }

  /** Map the shared {@link PlatformError} taxonomy by its stable code. */
  private mapPlatformError(error: PlatformError): MappedError {
    // Upstream failures are worth an operator log (with cause), but the cause is
    // never serialised into the response.
    this.logger.warn(`Platform error (${error.code}): ${error.message}`);

    // Only the status (and the rate-limit header) varies; code and message are
    // always the error's own.
    const base = { code: error.code, message: error.message };
    switch (error.code) {
      case PlatformErrorCode.RateLimited: {
        const retryAfterMs =
          error instanceof RateLimitError ? error.retryAfterMs : undefined;
        return {
          ...base,
          status: HttpStatus.TOO_MANY_REQUESTS,
          headers:
            retryAfterMs !== undefined
              ? { 'Retry-After': String(Math.ceil(retryAfterMs / 1000)) }
              : undefined,
        };
      }
      case PlatformErrorCode.ResourceNotFound:
        return { ...base, status: HttpStatus.NOT_FOUND };
      default:
        // TokenExpired / Unavailable / Unknown: the platform (our upstream)
        // failed or is unreachable → 502 Bad Gateway.
        return { ...base, status: HttpStatus.BAD_GATEWAY };
    }
  }
}

/** Re-wrap a framework `HttpException` in our envelope, keeping its status. */
function fromHttpException(exception: HttpException): MappedError {
  const status = exception.getStatus();

  // A 5xx that happens to arrive as an HttpException is still a server-side
  // fault: stay opaque, exactly like a raw throw, so internal messages (e.g. a
  // missing-guard misconfiguration) can't leak.
  if (status >= 500) {
    return { ...OPAQUE_500, status };
  }

  // `ValidationPipe` and friends put the details under `message`; a raw string
  // response is the message itself.
  const payload = exception.getResponse();
  let message = exception.message;
  if (typeof payload === 'object' && payload !== null && 'message' in payload) {
    const detail = payload.message;
    message = Array.isArray(detail) ? detail.join('; ') : String(detail);
  } else if (typeof payload === 'string') {
    message = payload;
  }

  return { status, code: HTTP_ERROR_CODE[status] ?? 'HTTP_ERROR', message };
}

/** Coerce an unknown thrown value into an `Error` for logging. */
function asError(value: unknown): Error {
  return value instanceof Error ? value : new Error(String(value));
}
