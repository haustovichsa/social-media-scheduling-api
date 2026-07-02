import { TokenBucketRateLimiter } from './rate-limiter';

/**
 * A hand-driven clock + sleep so the token bucket is tested without any real
 * time: `sleep` advances the same clock `now` reads, so waiting for a token is
 * instantaneous yet the bucket sees time pass exactly as it would in production.
 */
function fakeTime() {
  let current = 0;
  const slept: number[] = [];
  return {
    now: () => current,
    sleep: (ms: number) => {
      slept.push(ms);
      current += ms;
      return Promise.resolve();
    },
    advance: (ms: number) => {
      current += ms;
    },
    slept,
  };
}

describe('TokenBucketRateLimiter', () => {
  it('admits an initial burst up to capacity without waiting', async () => {
    const time = fakeTime();
    const limiter = new TokenBucketRateLimiter({
      capacity: 3,
      refillPerSec: 1,
      now: time.now,
      sleep: time.sleep,
    });

    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    expect(time.slept).toEqual([]);
  });

  it('paces the next call by the refill interval once the bucket is empty', async () => {
    const time = fakeTime();
    const limiter = new TokenBucketRateLimiter({
      capacity: 1,
      refillPerSec: 2, // one token every 500ms
      now: time.now,
      sleep: time.sleep,
    });

    await limiter.acquire(); // spends the initial token, no wait
    await limiter.acquire(); // bucket empty → wait for one token to refill

    expect(time.slept).toEqual([500]);
  });

  it('does not wait when enough time has already elapsed to refill', async () => {
    const time = fakeTime();
    const limiter = new TokenBucketRateLimiter({
      capacity: 1,
      refillPerSec: 1,
      now: time.now,
      sleep: time.sleep,
    });

    await limiter.acquire();
    time.advance(1000); // a full second passes between calls

    await limiter.acquire();

    expect(time.slept).toEqual([]);
  });

  it('never over-draws the bucket under concurrent acquires', async () => {
    const time = fakeTime();
    const limiter = new TokenBucketRateLimiter({
      capacity: 2,
      refillPerSec: 1, // one token per second after the burst
      now: time.now,
      sleep: time.sleep,
    });

    // Fire five at once: two ride the burst, the rest are paced one per second.
    await Promise.all([
      limiter.acquire(),
      limiter.acquire(),
      limiter.acquire(),
      limiter.acquire(),
      limiter.acquire(),
    ]);

    // Two free, then three waits — serialised in arrival order, not raced.
    expect(time.slept).toEqual([1000, 1000, 1000]);
  });

  it('caps accrued tokens at capacity over a long idle period', async () => {
    const time = fakeTime();
    const limiter = new TokenBucketRateLimiter({
      capacity: 2,
      refillPerSec: 1,
      now: time.now,
      sleep: time.sleep,
    });

    await limiter.acquire();
    await limiter.acquire(); // bucket now empty
    time.advance(60_000); // idle a full minute

    // Only `capacity` tokens accrued, so the third post-idle call still waits.
    await limiter.acquire();
    await limiter.acquire();
    await limiter.acquire();

    expect(time.slept).toEqual([1000]);
  });

  it('rejects a non-positive configuration', () => {
    expect(
      () => new TokenBucketRateLimiter({ capacity: 0, refillPerSec: 1 }),
    ).toThrow(/positive/);
    expect(
      () => new TokenBucketRateLimiter({ capacity: 1, refillPerSec: 0 }),
    ).toThrow(/positive/);
  });
});
