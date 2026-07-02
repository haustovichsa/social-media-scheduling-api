/**
 * How the resilience layer waits between attempts and paces requests. Factored
 * out so tests can drive time deterministically (Jest fake timers), and so the
 * default — a real `setTimeout` — is the only place a wall-clock delay is
 * introduced. Rejecting is not part of the contract: a sleep only ever resolves.
 */
export type Sleep = (ms: number) => Promise<void>;

/** Default wall-clock sleep. Swapped for a fake in tests. */
export const realSleep: Sleep = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** How the limiter reads the current time. Injectable so tests can freeze it. */
export type Clock = () => number;

/** Tuning for one {@link TokenBucketRateLimiter}. */
export interface RateLimiterOptions {
  /**
   * Maximum burst: how many calls can go through back-to-back before the bucket
   * empties and callers start being paced. Also the bucket's starting fill, so a
   * freshly built limiter absorbs an initial spike up to this many calls.
   */
  readonly capacity: number;
  /** Sustained rate the bucket refills at, in tokens (calls) per second. */
  readonly refillPerSec: number;
  /** Time source; defaults to {@link Date.now}. */
  readonly now?: Clock;
  /** Delay primitive; defaults to {@link realSleep}. */
  readonly sleep?: Sleep;
}

/**
 * A per-platform token bucket that paces outbound adapter calls so we stay under
 * a platform's request ceiling *before* it starts returning 429s (NFR-5, RK-2) —
 * the proactive half of resilience, with retry/backoff as the reactive half.
 *
 * The bucket starts full (absorbs a burst up to `capacity`) and refills
 * continuously at `refillPerSec`. {@link acquire} resolves immediately while
 * tokens remain and otherwise sleeps exactly long enough for the next token to
 * accrue. Calls are serialised through an internal promise chain, so concurrent
 * `acquire()`s are admitted one at a time in arrival order and can never
 * over-draw the bucket by racing on the token count. One limiter is created per
 * platform (see the resilience wiring), so a busy platform never starves another.
 */
export class TokenBucketRateLimiter {
  private readonly capacity: number;
  private readonly refillPerSec: number;
  private readonly now: Clock;
  private readonly sleep: Sleep;

  private tokens: number;
  private lastRefill: number;
  /** Tail of the admission queue; each acquire waits on the previous one. */
  private tail: Promise<void> = Promise.resolve();

  constructor(options: RateLimiterOptions) {
    if (options.capacity <= 0 || options.refillPerSec <= 0) {
      throw new Error(
        'Rate limiter capacity and refillPerSec must be positive',
      );
    }
    this.capacity = options.capacity;
    this.refillPerSec = options.refillPerSec;
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? realSleep;
    this.tokens = options.capacity;
    this.lastRefill = this.now();
  }

  /**
   * Resolve once a token is available, taking one. Returns synchronously (a
   * resolved promise) when the bucket has tokens; otherwise waits for the next
   * one to refill. Admissions are serialised, so N concurrent callers are let
   * through in order at the bucket's pace rather than all seeing the same
   * pre-decrement token count.
   */
  acquire(): Promise<void> {
    // Chain onto the queue tail so only one admission runs at a time, then
    // become the new tail. `void prev` swallows any earlier rejection — there is
    // none (admission never rejects), but this keeps the chain from ever
    // becoming an unhandled rejection.
    const admitted = this.tail.then(() => this.admitNext());
    this.tail = admitted.catch(() => undefined);
    return admitted;
  }

  private async admitNext(): Promise<void> {
    this.refill();
    if (this.tokens < 1) {
      // Not enough for a whole token yet: wait out the remaining fraction.
      const waitMs = Math.ceil(((1 - this.tokens) / this.refillPerSec) * 1000);
      await this.sleep(waitMs);
      this.refill();
    }
    this.tokens -= 1;
  }

  /** Credit tokens for the time elapsed since the last refill, capped at capacity. */
  private refill(): void {
    const now = this.now();
    const elapsedSec = (now - this.lastRefill) / 1000;
    if (elapsedSec > 0) {
      this.tokens = Math.min(
        this.capacity,
        this.tokens + elapsedSec * this.refillPerSec,
      );
      this.lastRefill = now;
    }
  }
}
