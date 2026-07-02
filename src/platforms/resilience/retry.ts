import { PlatformError, RateLimitError } from '../platform-errors';
import { realSleep, Sleep } from './rate-limiter';

/** How many times, and how far apart, retryable failures are re-attempted. */
export interface RetryPolicy {
  /** Total attempts including the first. `1` disables retrying. */
  readonly maxAttempts: number;
  /** Backoff for the first retry; doubles each subsequent attempt. */
  readonly baseDelayMs: number;
  /** Ceiling on a single backoff delay, before honouring `Retry-After`. */
  readonly maxDelayMs: number;
}

/**
 * Decides whether a thrown error is worth retrying. The default trusts the
 * adapter taxonomy: only a {@link PlatformError} the adapter itself flagged
 * `retryable` (rate-limit, transient unavailability) is retried — an expired
 * token or a deleted resource fails fast, and a non-`PlatformError` (a bug that
 * escaped the adapter contract) is never swallowed by a retry loop.
 */
export type RetryPredicate = (error: unknown) => boolean;

/** The default: retry exactly the errors the adapter marked retryable. */
export const isRetryablePlatformError: RetryPredicate = (error) =>
  error instanceof PlatformError && error.retryable;

/**
 * Retry only rate-limiting. Used for non-idempotent writes (posting a reply):
 * a 429 is rejected *before* the platform acts, so retrying it cannot double the
 * effect — whereas a 5xx/timeout might mean the write landed and only the
 * response was lost, so retrying it risks a duplicate (RK-4). The reply outbox
 * guards the logical send, but this keeps the transport layer from re-issuing a
 * write that may already have taken.
 */
export const isRateLimitOnly: RetryPredicate = (error) =>
  error instanceof RateLimitError;

/** Injectable primitives so tests can drive time and jitter deterministically. */
export interface RetryDeps {
  readonly sleep?: Sleep;
  /** Jitter source in `[0, 1)`; defaults to {@link Math.random}. */
  readonly random?: () => number;
  /** Which errors to retry; defaults to {@link isRetryablePlatformError}. */
  readonly shouldRetry?: RetryPredicate;
}

/**
 * Run `fn`, retrying transient platform failures with exponential backoff and
 * jitter (RK-2, NFR-5). This is the reactive half of resilience: pacing keeps us
 * under the ceiling, backoff recovers from the throttling and blips that slip
 * through anyway. On the final attempt — or the first non-retryable error — the
 * original typed {@link PlatformError} propagates unchanged, so the exception
 * filter (TASK-09) still maps it to a documented status and no raw platform
 * shape leaks (AC-5).
 *
 * Backoff is `baseDelayMs · 2^(n-1)` capped at `maxDelayMs`, then "equal jitter"
 * (half fixed + half random) spreads retries so many callers throttled at once
 * don't resynchronise into a thundering herd. A {@link RateLimitError} carrying
 * `retryAfterMs` overrides that with the platform's own instruction when it asks
 * for a longer wait — we never retry sooner than told.
 */
export async function retry<T>(
  fn: () => Promise<T>,
  policy: RetryPolicy,
  deps: RetryDeps = {},
): Promise<T> {
  const sleep = deps.sleep ?? realSleep;
  const random = deps.random ?? Math.random;
  const shouldRetry = deps.shouldRetry ?? isRetryablePlatformError;

  let attempt = 1;
  for (;;) {
    try {
      return await fn();
    } catch (error) {
      if (attempt >= policy.maxAttempts || !shouldRetry(error)) {
        throw error;
      }
      await sleep(backoffMs(attempt, policy, random, error));
      attempt += 1;
    }
  }
}

/** Backoff for the given attempt: capped exponential + equal jitter, floored by `Retry-After`. */
function backoffMs(
  attempt: number,
  policy: RetryPolicy,
  random: () => number,
  error: unknown,
): number {
  const exp = Math.min(
    policy.maxDelayMs,
    policy.baseDelayMs * 2 ** (attempt - 1),
  );
  // Equal jitter: keep half the delay fixed (so we still back off meaningfully)
  // and randomise the other half to decorrelate concurrent retriers.
  const jittered = exp / 2 + random() * (exp / 2);

  const retryAfter =
    error instanceof RateLimitError ? error.retryAfterMs : undefined;
  return retryAfter !== undefined ? Math.max(jittered, retryAfter) : jittered;
}
