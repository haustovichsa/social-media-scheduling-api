import {
  ArgumentsHost,
  BadRequestException,
  HttpStatus,
  InternalServerErrorException,
  Logger,
} from '@nestjs/common';

import { Platform } from '../enums/platform.enum';
import {
  CommentNotFoundError,
  PostNotFoundError,
} from '../../comments/comment-errors';
import {
  AdapterNotFoundError,
  PlatformUnavailableError,
  RateLimitError,
  ResourceNotFoundError,
  TokenExpiredError,
  UnknownPlatformError,
} from '../../platforms/platform-errors';
import { ApiErrorResponse } from './api-error.response';
import { DomainExceptionFilter } from './domain-exception.filter';

/**
 * Verifies the error-to-HTTP mapping: every typed error becomes a documented
 * status in the uniform envelope, and no platform `cause` leaks into the body.
 * The `Response` is a spy capturing status, headers and body.
 */
describe('DomainExceptionFilter', () => {
  let filter: DomainExceptionFilter;
  let status: jest.Mock<{ json: jest.Mock }, [number]>;
  let json: jest.Mock<void, [ApiErrorResponse]>;
  let setHeader: jest.Mock;

  // Silence the logs the filter emits for 5xx/upstream faults.
  beforeAll(() => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation(() => undefined);
    jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
  });

  afterAll(() => jest.restoreAllMocks());

  beforeEach(() => {
    filter = new DomainExceptionFilter();
    json = jest.fn<void, [ApiErrorResponse]>();
    setHeader = jest.fn();
    status = jest.fn<{ json: jest.Mock }, [number]>().mockReturnValue({ json });
  });

  function run(exception: unknown): {
    statusCode: number;
    body: ApiErrorResponse;
  } {
    const host = {
      switchToHttp: () => ({
        getResponse: () => ({ status, setHeader }),
      }),
    } as unknown as ArgumentsHost;

    filter.catch(exception, host);

    return {
      statusCode: status.mock.calls[0][0],
      body: json.mock.calls[0][0],
    };
  }

  it.each([
    ['post not found', new PostNotFoundError('p1'), 404, 'POST_NOT_FOUND'],
    [
      'comment not found',
      new CommentNotFoundError('c1'),
      404,
      'COMMENT_NOT_FOUND',
    ],
    [
      'platform resource gone',
      new ResourceNotFoundError(Platform.Facebook, 'ext-1'),
      404,
      'RESOURCE_NOT_FOUND',
    ],
    [
      'token expired',
      new TokenExpiredError(Platform.Facebook),
      502,
      'TOKEN_EXPIRED',
    ],
    [
      'platform unavailable',
      new PlatformUnavailableError(Platform.Facebook),
      502,
      'PLATFORM_UNAVAILABLE',
    ],
    [
      'unknown platform error',
      new UnknownPlatformError(Platform.Facebook),
      502,
      'PLATFORM_ERROR',
    ],
  ])('maps %s to %d/%s', (_label, error, expectedStatus, expectedCode) => {
    const { statusCode, body } = run(error);
    expect(statusCode).toBe(expectedStatus);
    expect(body).toMatchObject({
      statusCode: expectedStatus,
      code: expectedCode,
    });
    expect(typeof body.message).toBe('string');
  });

  it('maps a rate-limit error to 429 with a Retry-After header (seconds)', () => {
    const { statusCode, body } = run(
      new RateLimitError(Platform.Facebook, 2_000),
    );
    expect(statusCode).toBe(HttpStatus.TOO_MANY_REQUESTS);
    expect(body.code).toBe('RATE_LIMITED');
    expect(setHeader).toHaveBeenCalledWith('Retry-After', '2');
  });

  it('omits Retry-After when the platform gave no hint', () => {
    run(new RateLimitError(Platform.Facebook));
    expect(setHeader).not.toHaveBeenCalled();
  });

  it('maps a misconfigured adapter to an opaque 500', () => {
    const { statusCode, body } = run(new AdapterNotFoundError(Platform.X));
    expect(statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).not.toContain('adapter');
  });

  it('preserves a framework HttpException status and flattens its messages', () => {
    const { statusCode, body } = run(
      new BadRequestException(['text should not be empty', 'bad limit']),
    );
    expect(statusCode).toBe(HttpStatus.BAD_REQUEST);
    expect(body.code).toBe('VALIDATION_FAILED');
    expect(body.message).toBe('text should not be empty; bad limit');
  });

  it('never leaks a platform cause into the response body', () => {
    const secret = new Error('token=SECRET in url https://graph…');
    const { body } = run(
      new PlatformUnavailableError(Platform.Facebook, undefined, {
        cause: secret,
      }),
    );
    expect(JSON.stringify(body)).not.toContain('SECRET');
  });

  it('keeps a 5xx HttpException opaque (its message never leaks)', () => {
    const { statusCode, body } = run(
      new InternalServerErrorException('route is not protected by the guard'),
    );
    expect(statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).not.toContain('guard');
  });

  it('maps an unrecognised error to an opaque 500', () => {
    const { statusCode, body } = run(new Error('internal detail'));
    expect(statusCode).toBe(HttpStatus.INTERNAL_SERVER_ERROR);
    expect(body.code).toBe('INTERNAL_ERROR');
    expect(body.message).not.toContain('internal detail');
  });
});
