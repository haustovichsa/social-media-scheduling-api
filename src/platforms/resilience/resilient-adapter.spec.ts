import { Platform } from '../../common/enums/platform.enum';
import { Page } from '../../domain';
import {
  AdapterContext,
  PlatformAdapter,
  PlatformCapabilities,
} from '../platform-adapter.interface';
import { FetchedComment, FetchedReply } from '../platform-comment';
import {
  PlatformUnavailableError,
  RateLimitError,
  ResourceNotFoundError,
} from '../platform-errors';
import { TokenBucketRateLimiter } from './rate-limiter';
import { ResiliencePolicies, ResilientAdapter } from './resilient-adapter';

const CTX: AdapterContext = { platformAccountId: 'acc-1' };

const POLICIES: ResiliencePolicies = {
  read: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1_000 },
  write: { maxAttempts: 3, baseDelayMs: 100, maxDelayMs: 1_000 },
};

const REPLY: FetchedReply = {
  externalCommentId: 'r1',
  externalParentCommentId: 'c1',
  author: { externalAuthorId: 'me', displayName: 'Me' },
  text: 'hi',
  platformCreatedAt: new Date('2026-01-01T00:00:00Z'),
};

/** A programmable delegate that records calls and yields queued outcomes. */
class StubAdapter implements PlatformAdapter {
  readonly platform = Platform.Facebook;
  readonly capabilities: PlatformCapabilities = {
    maxThreadDepth: 1,
    supportsWebhooks: true,
  };

  getCommentsCalls = 0;
  replyCalls = 0;

  constructor(
    private readonly getCommentsImpl: () => Promise<Page<FetchedComment>>,
    private readonly replyImpl: () => Promise<FetchedReply>,
  ) {}

  getComments(): Promise<Page<FetchedComment>> {
    this.getCommentsCalls += 1;
    return this.getCommentsImpl();
  }

  replyToComment(): Promise<FetchedReply> {
    this.replyCalls += 1;
    return this.replyImpl();
  }
}

/** A generous limiter (never paces) plus a no-wait sleep, so tests run instantly. */
function fastSetup(delegate: PlatformAdapter) {
  const limiter = new TokenBucketRateLimiter({
    capacity: 1_000,
    refillPerSec: 1_000,
  });
  const sleeps: number[] = [];
  const adapter = new ResilientAdapter(delegate, limiter, POLICIES, {
    sleep: (ms) => {
      sleeps.push(ms);
      return Promise.resolve();
    },
    random: () => 0,
  });
  return { adapter, sleeps };
}

describe('ResilientAdapter', () => {
  it('is transparent: exposes the delegate platform and capabilities', () => {
    const delegate = new StubAdapter(
      () => Promise.resolve({ items: [], nextCursor: null }),
      () => Promise.resolve(REPLY),
    );
    const { adapter } = fastSetup(delegate);

    expect(adapter.platform).toBe(Platform.Facebook);
    expect(adapter.capabilities).toEqual(delegate.capabilities);
  });

  it('passes a successful read straight through without retrying', async () => {
    const page: Page<FetchedComment> = { items: [], nextCursor: 'next' };
    const delegate = new StubAdapter(
      () => Promise.resolve(page),
      () => Promise.resolve(REPLY),
    );
    const { adapter, sleeps } = fastSetup(delegate);

    await expect(adapter.getComments(CTX, 'post-1')).resolves.toBe(page);
    expect(delegate.getCommentsCalls).toBe(1);
    expect(sleeps).toEqual([]);
  });

  it('retries a read on a transient platform failure, then succeeds', async () => {
    const page: Page<FetchedComment> = { items: [], nextCursor: null };
    let call = 0;
    const delegate = new StubAdapter(
      () => {
        call += 1;
        return call < 3
          ? Promise.reject(new PlatformUnavailableError(Platform.Facebook))
          : Promise.resolve(page);
      },
      () => Promise.resolve(REPLY),
    );
    const { adapter, sleeps } = fastSetup(delegate);

    await expect(adapter.getComments(CTX, 'post-1')).resolves.toBe(page);
    expect(delegate.getCommentsCalls).toBe(3);
    expect(sleeps).toEqual([50, 100]);
  });

  it('surfaces the typed error unchanged when reads exhaust retries', async () => {
    const boom = new PlatformUnavailableError(Platform.Facebook);
    const delegate = new StubAdapter(
      () => Promise.reject(boom),
      () => Promise.resolve(REPLY),
    );
    const { adapter } = fastSetup(delegate);

    await expect(adapter.getComments(CTX, 'post-1')).rejects.toBe(boom);
    expect(delegate.getCommentsCalls).toBe(3);
  });

  it('does not retry a read on a non-retryable error', async () => {
    const delegate = new StubAdapter(
      () => Promise.reject(new ResourceNotFoundError(Platform.Facebook, 'x')),
      () => Promise.resolve(REPLY),
    );
    const { adapter } = fastSetup(delegate);

    await expect(adapter.getComments(CTX, 'post-1')).rejects.toBeInstanceOf(
      ResourceNotFoundError,
    );
    expect(delegate.getCommentsCalls).toBe(1);
  });

  it('retries a reply on a 429 (rejected before the platform acted)', async () => {
    let call = 0;
    const delegate = new StubAdapter(
      () => Promise.resolve({ items: [], nextCursor: null }),
      () => {
        call += 1;
        return call === 1
          ? Promise.reject(new RateLimitError(Platform.Facebook))
          : Promise.resolve(REPLY);
      },
    );
    const { adapter } = fastSetup(delegate);

    await expect(
      adapter.replyToComment(CTX, 'c1', { text: 'hi' }),
    ).resolves.toBe(REPLY);
    expect(delegate.replyCalls).toBe(2);
  });

  it('does NOT retry a reply on a transient failure that may have landed (RK-4)', async () => {
    const delegate = new StubAdapter(
      () => Promise.resolve({ items: [], nextCursor: null }),
      () => Promise.reject(new PlatformUnavailableError(Platform.Facebook)),
    );
    const { adapter } = fastSetup(delegate);

    await expect(
      adapter.replyToComment(CTX, 'c1', { text: 'hi' }),
    ).rejects.toBeInstanceOf(PlatformUnavailableError);
    // Exactly one send: a 5xx/timeout must not be re-issued for a write.
    expect(delegate.replyCalls).toBe(1);
  });

  it('paces calls through the rate limiter before hitting the delegate', async () => {
    const page: Page<FetchedComment> = { items: [], nextCursor: null };
    const delegate = new StubAdapter(
      () => Promise.resolve(page),
      () => Promise.resolve(REPLY),
    );

    // A hand-driven clock the limiter's sleep advances, so the second call is
    // paced without any real waiting. capacity 1, refill 2/s → one token free,
    // the next accrues after 500ms.
    let clock = 0;
    const paced: number[] = [];
    const limiter = new TokenBucketRateLimiter({
      capacity: 1,
      refillPerSec: 2,
      now: () => clock,
      sleep: (ms) => {
        paced.push(ms);
        clock += ms;
        return Promise.resolve();
      },
    });
    const adapter = new ResilientAdapter(delegate, limiter, POLICIES, {
      random: () => 0,
    });

    await adapter.getComments(CTX, 'post-1'); // rides the initial token
    await adapter.getComments(CTX, 'post-1'); // bucket empty → paced 500ms

    expect(delegate.getCommentsCalls).toBe(2);
    expect(paced).toEqual([500]);
  });
});
