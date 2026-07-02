import { Platform } from '../../common/enums/platform.enum';
import {
  PlatformUnavailableError,
  RateLimitError,
  TokenExpiredError,
} from '../platform-errors';
import {
  isRateLimitOnly,
  isRetryablePlatformError,
  retry,
  RetryPolicy,
} from './retry';

const POLICY: RetryPolicy = {
  maxAttempts: 3,
  baseDelayMs: 100,
  maxDelayMs: 1000,
};

/** Captures the delays retry would sleep for, without any real waiting. */
function recordingSleep() {
  const delays: number[] = [];
  return {
    delays,
    sleep: (ms: number) => {
      delays.push(ms);
      return Promise.resolve();
    },
  };
}

/** random fixed at 0 makes the "equal jitter" delay deterministic: exp / 2. */
const noJitter = () => 0;

describe('retry', () => {
  it('returns the result without sleeping when the call succeeds first time', async () => {
    const { delays, sleep } = recordingSleep();
    const fn = jest.fn().mockResolvedValue('ok');

    await expect(retry(fn, POLICY, { sleep, random: noJitter })).resolves.toBe(
      'ok',
    );
    expect(fn).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it('retries a retryable platform error with exponential backoff, then succeeds', async () => {
    const { delays, sleep } = recordingSleep();
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new PlatformUnavailableError(Platform.Facebook))
      .mockRejectedValueOnce(new PlatformUnavailableError(Platform.Facebook))
      .mockResolvedValue('ok');

    await expect(retry(fn, POLICY, { sleep, random: noJitter })).resolves.toBe(
      'ok',
    );
    expect(fn).toHaveBeenCalledTimes(3);
    // exp = 100, 200 → equal jitter with random 0 halves each.
    expect(delays).toEqual([50, 100]);
  });

  it('gives up after maxAttempts and rethrows the original typed error', async () => {
    const { delays, sleep } = recordingSleep();
    const boom = new PlatformUnavailableError(Platform.Facebook);
    const fn = jest.fn().mockRejectedValue(boom);

    await expect(retry(fn, POLICY, { sleep, random: noJitter })).rejects.toBe(
      boom,
    );
    // 3 attempts total → 2 backoffs between them.
    expect(fn).toHaveBeenCalledTimes(3);
    expect(delays).toEqual([50, 100]);
  });

  it('does not retry a non-retryable platform error', async () => {
    const { delays, sleep } = recordingSleep();
    const fn = jest
      .fn()
      .mockRejectedValue(new TokenExpiredError(Platform.Facebook));

    await expect(
      retry(fn, POLICY, { sleep, random: noJitter }),
    ).rejects.toBeInstanceOf(TokenExpiredError);
    expect(fn).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it('does not retry an error that is not a PlatformError (a leaked bug)', async () => {
    const { delays, sleep } = recordingSleep();
    const fn = jest.fn().mockRejectedValue(new Error('unexpected'));

    await expect(
      retry(fn, POLICY, { sleep, random: noJitter }),
    ).rejects.toThrow('unexpected');
    expect(fn).toHaveBeenCalledTimes(1);
    expect(delays).toEqual([]);
  });

  it("honours a 429's Retry-After when it exceeds the computed backoff", async () => {
    const { delays, sleep } = recordingSleep();
    const fn = jest
      .fn()
      .mockRejectedValueOnce(new RateLimitError(Platform.Facebook, 5_000))
      .mockResolvedValue('ok');

    await expect(retry(fn, POLICY, { sleep, random: noJitter })).resolves.toBe(
      'ok',
    );
    // Computed backoff would be 50ms; the platform asked for 5s, so we wait 5s.
    expect(delays).toEqual([5_000]);
  });

  it('backs off on a 429 and recovers, driven by Jest fake timers', async () => {
    jest.useFakeTimers();
    try {
      const fn = jest
        .fn()
        .mockRejectedValueOnce(new RateLimitError(Platform.Facebook, 1_000))
        .mockResolvedValue('ok');

      // Uses the real setTimeout-based sleep, faked by Jest.
      const pending = retry(fn, POLICY, { random: noJitter });
      await jest.advanceTimersByTimeAsync(1_000);

      await expect(pending).resolves.toBe('ok');
      expect(fn).toHaveBeenCalledTimes(2);
    } finally {
      jest.useRealTimers();
    }
  });
});

describe('retry predicates', () => {
  it('isRetryablePlatformError follows the adapter retryable flag', () => {
    expect(
      isRetryablePlatformError(new RateLimitError(Platform.Facebook)),
    ).toBe(true);
    expect(
      isRetryablePlatformError(new PlatformUnavailableError(Platform.Facebook)),
    ).toBe(true);
    expect(
      isRetryablePlatformError(new TokenExpiredError(Platform.Facebook)),
    ).toBe(false);
    expect(isRetryablePlatformError(new Error('nope'))).toBe(false);
  });

  it('isRateLimitOnly retries only throttling, never a write that may have landed', () => {
    expect(isRateLimitOnly(new RateLimitError(Platform.Facebook))).toBe(true);
    expect(
      isRateLimitOnly(new PlatformUnavailableError(Platform.Facebook)),
    ).toBe(false);
  });
});
