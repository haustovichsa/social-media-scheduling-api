import { Page, PageCursor } from '../../domain';
import {
  AdapterContext,
  PlatformAdapter,
  PlatformCapabilities,
} from '../platform-adapter.interface';
import { FetchedComment, FetchedReply, ReplyInput } from '../platform-comment';
import { TokenBucketRateLimiter } from './rate-limiter';
import {
  isRateLimitOnly,
  isRetryablePlatformError,
  retry,
  RetryDeps,
  RetryPolicy,
} from './retry';

/** Backoff budgets for the two call kinds an adapter exposes. */
export interface ResiliencePolicies {
  /** Reads are idempotent, so any retryable failure is fair game. */
  readonly read: RetryPolicy;
  /**
   * Writes (posting a reply) are not idempotent, so this policy is applied with
   * a rate-limit-only predicate — see {@link ResilientAdapter}. Sizing it
   * separately (typically fewer attempts) keeps a throttled reply from being
   * re-issued many times.
   */
  readonly write: RetryPolicy;
}

/**
 * Wraps a concrete {@link PlatformAdapter} with the two cross-cutting resilience
 * concerns (§3.1) so no adapter re-implements them: a per-platform rate limiter
 * that paces calls under the platform's ceiling, and retry-with-backoff that
 * rides out the throttling and transient failures that still occur. It is a
 * transparent decorator — same interface, same `platform`/`capabilities`, so the
 * registry indexes and callers use it identically (NFR-1); the wrapping is pure
 * wiring, invisible above the adapter boundary.
 *
 * The rate limiter is acquired *inside* the retried block, so a retry waits its
 * turn again rather than jumping the queue — a burst of retries can't itself
 * become a spike that re-trips the limit.
 *
 * Read vs write retry differ deliberately. Reads retry on any error the adapter
 * flagged retryable. A reply is a non-idempotent write, so it retries *only* on
 * a 429 ({@link isRateLimitOnly}): a throttled request never reached the
 * platform's write path, whereas a 5xx/timeout might have created the reply with
 * only the response lost — retrying that risks a duplicate (RK-4). Typed
 * {@link PlatformError}s propagate unchanged for the exception filter to map, so
 * no raw platform payload ever escapes (AC-5).
 */
export class ResilientAdapter implements PlatformAdapter {
  private readonly writeDeps: RetryDeps;
  private readonly readDeps: RetryDeps;

  constructor(
    private readonly delegate: PlatformAdapter,
    /** Paces calls under the platform's ceiling; omitted to opt out of pacing. */
    private readonly limiter: TokenBucketRateLimiter | undefined,
    private readonly policies: ResiliencePolicies,
    /**
     * Retry primitives (sleep/jitter). Injected so tests drive time
     * deterministically; production uses the real-timer defaults.
     */
    deps: RetryDeps = {},
  ) {
    this.readDeps = { ...deps, shouldRetry: isRetryablePlatformError };
    this.writeDeps = { ...deps, shouldRetry: isRateLimitOnly };
  }

  get platform() {
    return this.delegate.platform;
  }

  get capabilities(): PlatformCapabilities {
    return this.delegate.capabilities;
  }

  getComments(
    ctx: AdapterContext,
    externalPostId: string,
    cursor?: PageCursor,
  ): Promise<Page<FetchedComment>> {
    return retry(
      async () => {
        await this.limiter?.acquire();
        return this.delegate.getComments(ctx, externalPostId, cursor);
      },
      this.policies.read,
      this.readDeps,
    );
  }

  replyToComment(
    ctx: AdapterContext,
    externalCommentId: string,
    body: ReplyInput,
  ): Promise<FetchedReply> {
    return retry(
      async () => {
        await this.limiter?.acquire();
        return this.delegate.replyToComment(ctx, externalCommentId, body);
      },
      this.policies.write,
      this.writeDeps,
    );
  }
}
