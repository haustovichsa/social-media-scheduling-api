import { Platform } from '../common/enums/platform.enum';
import { Page, PageCursor } from '../domain';
import { FetchedComment, FetchedReply, ReplyInput } from './platform-comment';

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
   * Fetch one page of a published post's comments, newest paging semantics
   * defined by the adapter. `cursor` is `undefined` for the first page and
   * otherwise the `nextCursor` from the previous page. Throws a
   * {@link PlatformError} on any platform failure.
   */
  getComments(
    externalPostId: string,
    cursor?: PageCursor,
  ): Promise<Page<FetchedComment>>;

  /**
   * Post a reply under `externalCommentId` and return the comment the platform
   * created for it. Throws a {@link PlatformError} on any platform failure; the
   * reply service (TASK-08) is responsible for at-most-once delivery via the
   * outbox, so this method just performs the send.
   */
  replyToComment(
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
