/**
 * An opaque forward-paging cursor. Callers must treat it as a black box: pass
 * the `nextCursor` from one page straight back to request the next one, and
 * never parse or construct it. Keeping it opaque lets each adapter back it with
 * whatever the platform uses (a page token, an offset, a `created_before`
 * timestamp) without that choice leaking into the shared model (NFR-1).
 */
export type PageCursor = string;

/**
 * A single page of results in the shared cursor-paging shape. `nextCursor` is
 * `null` when there are no more items — that is the end-of-list signal, not an
 * empty `items` array (a page can be empty yet still have more behind it).
 */
export interface Page<T> {
  readonly items: readonly T[];
  readonly nextCursor: PageCursor | null;
}
