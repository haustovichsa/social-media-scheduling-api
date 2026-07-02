import { Platform } from '../common/enums/platform.enum';

/**
 * Stable, machine-readable codes for the failures an adapter can surface. These
 * are part of the adapter contract: the HTTP error filter switches on the *code*,
 * never on a platform's raw response, so every platform's problems map to the
 * same documented API errors (AC-5). Add a platform without touching this — the
 * codes describe categories, not vendors.
 */
export enum PlatformErrorCode {
  /** The platform throttled us (HTTP 429 or an equivalent). Retryable. */
  RateLimited = 'RATE_LIMITED',
  /** The account's credentials expired or were revoked. Not retryable as-is. */
  TokenExpired = 'TOKEN_EXPIRED',
  /** The post/comment is gone on the platform (deleted, or never existed). */
  ResourceNotFound = 'RESOURCE_NOT_FOUND',
  /** The platform is down or returned a 5xx. Retryable with backoff. */
  Unavailable = 'PLATFORM_UNAVAILABLE',
  /** Anything the adapter could not classify. Treated as non-retryable. */
  Unknown = 'PLATFORM_ERROR',
}

/**
 * Base class for every error an adapter is allowed to throw. Adapters must
 * translate platform-native failures into one of these subclasses so the core
 * never sees a vendor error shape (RK-1, NFR-1); anything else escaping an
 * adapter is a bug. Carries a stable {@link PlatformErrorCode}, the offending
 * `platform`, and a `retryable` hint the rate-limit/retry seam would read (§8).
 *
 * The original error is kept on `cause` for logging only — it must never be
 * serialised into an API response (RK-6).
 */
export abstract class PlatformError extends Error {
  abstract readonly code: PlatformErrorCode;
  /** Whether retrying the same call could plausibly succeed. */
  abstract readonly retryable: boolean;

  constructor(
    readonly platform: Platform,
    message: string,
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = new.target.name;
  }
}

/** The platform throttled the request (RK-2). */
export class RateLimitError extends PlatformError {
  readonly code = PlatformErrorCode.RateLimited;
  readonly retryable = true;

  constructor(
    platform: Platform,
    /** How long the platform asked us to wait, if it said. Drives backoff. */
    readonly retryAfterMs?: number,
    options?: { cause?: unknown },
  ) {
    super(platform, `Rate limited by ${platform}`, options);
  }
}

/** The account's platform token expired or was revoked (RK-2). */
export class TokenExpiredError extends PlatformError {
  readonly code = PlatformErrorCode.TokenExpired;
  readonly retryable = false;

  constructor(platform: Platform, options?: { cause?: unknown }) {
    super(
      platform,
      `Platform token for ${platform} is expired or invalid`,
      options,
    );
  }
}

/** The referenced post or comment does not exist on the platform anymore. */
export class ResourceNotFoundError extends PlatformError {
  readonly code = PlatformErrorCode.ResourceNotFound;
  readonly retryable = false;

  constructor(
    platform: Platform,
    externalId: string,
    options?: { cause?: unknown },
  ) {
    super(
      platform,
      `Resource "${externalId}" not found on ${platform}`,
      options,
    );
  }
}

/** The platform is unavailable (5xx, timeout, network). Retry with backoff. */
export class PlatformUnavailableError extends PlatformError {
  readonly code = PlatformErrorCode.Unavailable;
  readonly retryable = true;

  constructor(
    platform: Platform,
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(platform, message ?? `${platform} is unavailable`, options);
  }
}

/** A platform failure the adapter could not map to a more specific class. */
export class UnknownPlatformError extends PlatformError {
  readonly code = PlatformErrorCode.Unknown;
  readonly retryable = false;

  constructor(
    platform: Platform,
    message?: string,
    options?: { cause?: unknown },
  ) {
    super(platform, message ?? `Unexpected error from ${platform}`, options);
  }
}

/**
 * No adapter is registered for the requested {@link Platform}. This is a
 * configuration error on *our* side (a platform value with no adapter provider),
 * not a platform failure — hence it is not a {@link PlatformError}. The registry
 * throws it so an unknown platform fails loudly and typed rather than returning
 * `undefined` and blowing up later with a null-deref.
 */
export class AdapterNotFoundError extends Error {
  constructor(readonly platform: Platform) {
    super(`No platform adapter registered for "${platform}"`);
    this.name = 'AdapterNotFoundError';
  }
}
