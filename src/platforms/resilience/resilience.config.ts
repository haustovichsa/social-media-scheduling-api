import { Platform } from '../../common/enums/platform.enum';
import { PlatformAdapter } from '../platform-adapter.interface';
import { RateLimiterOptions, TokenBucketRateLimiter } from './rate-limiter';
import { ResiliencePolicies, ResilientAdapter } from './resilient-adapter';

/**
 * Default retry budgets. Reads are idempotent so they get more attempts; a reply
 * is a non-idempotent write, so it gets fewer (and, per {@link ResilientAdapter},
 * only retries a 429). Delays are illustrative — a real deployment would tune
 * them per platform from observed limits.
 */
export const DEFAULT_POLICIES: ResiliencePolicies = {
  read: { maxAttempts: 4, baseDelayMs: 250, maxDelayMs: 8_000 },
  write: { maxAttempts: 3, baseDelayMs: 250, maxDelayMs: 8_000 },
};

/**
 * The pacing applied to a platform with no explicit entry in {@link RATE_LIMITS}:
 * conservative on purpose, so a newly added platform is throttled safely until
 * its real quota is configured rather than hammering the platform unbounded.
 */
const DEFAULT_RATE_LIMIT: RateLimiterOptions = {
  capacity: 10,
  refillPerSec: 5,
};

/**
 * Per-platform request ceilings, as a bucket capacity (burst) and sustained
 * refill rate. Values are conservative placeholders standing in for each
 * platform's published quota — the point is that the *shape* is per-platform, so
 * one noisy platform's throttling never paces another. Only platforms that
 * differ from {@link DEFAULT_RATE_LIMIT} are listed; the rest inherit it. A
 * `null` entry opts out of pacing entirely (the mock talks to no external
 * service, so pacing it would only slow local runs and tests).
 */
const RATE_LIMITS: Partial<Record<Platform, RateLimiterOptions | null>> = {
  [Platform.LinkedIn]: { capacity: 5, refillPerSec: 2 },
  [Platform.X]: { capacity: 5, refillPerSec: 3 },
  [Platform.Mock]: null,
};

/**
 * Wrap a concrete adapter with its per-platform rate limiter and the shared
 * retry policies — the single place platform wiring turns a plain adapter into a
 * resilient one (called by the `PlatformsModule` factory). Each call builds a
 * fresh limiter, so every platform gets its own independent bucket; a platform
 * that opts out of pacing gets none.
 */
export function withResilience(adapter: PlatformAdapter): ResilientAdapter {
  // `in` distinguishes "listed as null (opt out)" from "absent (use default)".
  const options =
    adapter.platform in RATE_LIMITS
      ? RATE_LIMITS[adapter.platform]
      : DEFAULT_RATE_LIMIT;
  const limiter = options ? new TokenBucketRateLimiter(options) : undefined;
  return new ResilientAdapter(adapter, limiter, DEFAULT_POLICIES);
}
