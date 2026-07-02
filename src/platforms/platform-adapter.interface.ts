import { Platform } from '../common/enums/platform.enum';
import { Page, PageCursor } from '../domain';
import { FetchedComment, FetchedReply, ReplyInput } from './platform-comment';

/**
 * Which connected account an adapter call acts as. The service resolves it from
 * the `Post`/`Comment` being operated on so the adapter can get that account's
 * token via the `TokenProvider`. An object, not a bare id, so the call site reads
 * clearly, the account id can't be swapped with `externalPostId` (both strings),
 * and future per-call context (trace id, org) has a home.
 */
export interface AdapterContext {
  /** Our `PlatformAccount` id — the key the `TokenProvider` resolves to a token. */
  readonly platformAccountId: string;
}

/**
 * What a platform can and cannot do, so the core adapts without hard-coding
 * per-vendor rules. Read by the read flow (platforms nest replies to different
 * depths) and by the webhook seam.
 */
export interface PlatformCapabilities {
  /**
   * Deepest reply nesting the platform allows. The adapter enforces this on
   * ingest: comments below the limit are flattened onto the deepest allowed
   * ancestor rather than dropped.
   */
  readonly maxThreadDepth: number;
  /** Whether the platform can push new comments to us via webhook. */
  readonly supportsWebhooks: boolean;
}

/**
 * The one contract every platform implements: you add a platform by writing one
 * class, without touching the core. Concrete adapters own everything
 * platform-specific: auth (per-account via the TokenProvider), request shape,
 * paging tokens, and mapping payloads to the external-keyed
 * {@link FetchedComment}/{@link FetchedReply} structs.
 *
 * Two rules make the contract safe to depend on, both checked by the shared
 * contract test:
 *  1. Every failure is thrown as a {@link PlatformError} subclass — adapters
 *     never leak raw platform errors.
 *  2. `nextCursor` is opaque and round-trips: passing a page's `nextCursor`
 *     straight back returns the following page; `null` means end of list.
 */
export interface PlatformAdapter {
  /** Which platform this adapter speaks for. The registry keys on this. */
  readonly platform: Platform;
  readonly capabilities: PlatformCapabilities;

  /**
   * Fetch one page of a published post's comments as `ctx`'s account. `cursor` is
   * `undefined` for the first page, otherwise the previous page's `nextCursor`.
   * Throws a {@link PlatformError} on any platform failure.
   */
  getComments(
    ctx: AdapterContext,
    externalPostId: string,
    cursor?: PageCursor,
  ): Promise<Page<FetchedComment>>;

  /**
   * Post a reply under `externalCommentId` as `ctx`'s account and return the
   * comment the platform created. Throws a {@link PlatformError} on any failure.
   * This just performs the send; the reply service handles at-most-once delivery.
   */
  replyToComment(
    ctx: AdapterContext,
    externalCommentId: string,
    body: ReplyInput,
  ): Promise<FetchedReply>;
}

/**
 * DI token for every registered {@link PlatformAdapter}. `PlatformsModule` binds
 * it to the adapter instances; {@link AdapterRegistry} injects the array and
 * indexes it by platform. A token, not a direct array, so Nest's container
 * assembles the set.
 */
export const PLATFORM_ADAPTERS = Symbol('PLATFORM_ADAPTERS');
