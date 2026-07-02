import { Platform } from '../common/enums/platform.enum';
import { Page, PageCursor } from '../domain';
import { FetchedComment, FetchedReply, ReplyInput } from './platform-comment';

/**
 * Identifies the connected account an adapter call acts as. The service layer
 * resolves it from the `Post`/`Comment` being operated on and threads it down so
 * the adapter can obtain that account's platform token via the `TokenProvider`
 * (TASK-06). Kept as an object rather than a bare id so the call site reads
 * unambiguously ("as this account, fetch that post"), so `externalPostId` and
 * the account id can't be transposed (they are both strings), and so future
 * per-call context (trace id, org) has a home without reshaping every signature.
 */
export interface AdapterContext {
  /** Our `PlatformAccount` id — the key the `TokenProvider` resolves to a token. */
  readonly platformAccountId: string;
}

/**
 * What a platform can and cannot do, so the core can adapt without hard-coding
 * per-vendor rules. Read by the mapping/read flow (each platform nests replies
 * to a different depth) and by the webhook seam (TASK-14).
 */
export interface PlatformCapabilities {
  /**
   * Deepest reply nesting the platform allows. The adapter enforces this on
   * ingest (A-5): comments below the limit are flattened onto the deepest
   * allowed ancestor rather than dropped.
   */
  readonly maxThreadDepth: number;
  /** Whether the platform can push new comments to us via webhook (TASK-14). */
  readonly supportsWebhooks: boolean;
}

/**
 * The one contract every platform implements — the extension point that makes
 * "support many platforms, add more later" a matter of writing a class, not
 * touching the core (NFR-1, AC-3). Concrete adapters own everything
 * platform-specific: auth (resolved per-account via the TokenProvider, TASK-06),
 * request shape, paging tokens, and mapping payloads to the external-keyed
 * {@link FetchedComment}/{@link FetchedReply} structs.
 *
 * Two rules make the contract safe to depend on and are exercised by the shared
 * contract test (TASK-12):
 *  1. Every failure is thrown as a {@link PlatformError} subclass — no vendor
 *     error shape ever escapes an adapter (RK-1, AC-5).
 *  2. `nextCursor` is opaque and round-trips: passing a page's `nextCursor`
 *     straight back returns the following page; `null` means end of list.
 */
export interface PlatformAdapter {
  /** Which platform this adapter speaks for. The registry keys on this. */
  readonly platform: Platform;
  readonly capabilities: PlatformCapabilities;

  /**
   * Fetch one page of a published post's comments, acting as `ctx`'s account,
   * with paging semantics defined by the adapter. `cursor` is `undefined` for
   * the first page and otherwise the `nextCursor` from the previous page. Throws
   * a {@link PlatformError} on any platform failure.
   */
  getComments(
    ctx: AdapterContext,
    externalPostId: string,
    cursor?: PageCursor,
  ): Promise<Page<FetchedComment>>;

  /**
   * Post a reply under `externalCommentId` as `ctx`'s account and return the
   * comment the platform created for it. Throws a {@link PlatformError} on any
   * platform failure; the reply service (TASK-08) is responsible for at-most-once
   * delivery via the outbox, so this method just performs the send.
   */
  replyToComment(
    ctx: AdapterContext,
    externalCommentId: string,
    body: ReplyInput,
  ): Promise<FetchedReply>;
}

/**
 * DI token resolving to every registered {@link PlatformAdapter}. The
 * `PlatformsModule` binds it to the adapter instances; {@link AdapterRegistry}
 * injects the array and indexes it by platform. Kept as a token (not a direct
 * array) so the set of adapters is assembled by Nest's container.
 */
export const PLATFORM_ADAPTERS = Symbol('PLATFORM_ADAPTERS');
