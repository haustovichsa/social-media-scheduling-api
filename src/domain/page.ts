/**
 * An opaque forward-paging cursor. Treat it as a black box: pass a page's
 * `nextCursor` straight back to get the next page; never parse or build it.
 * Staying opaque lets each adapter back it with whatever the platform uses (a
 * page token, an offset, a `created_before` timestamp) without that leaking into
 * the shared model.
 */
export type PageCursor = string;

/**
 * A single page of results. `nextCursor` is `null` when there are no more items;
 * that (not an empty `items` array) is the end-of-list signal, since a page can
 * be empty yet still have more behind it.
 */
export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: PageCursor | null;
}
