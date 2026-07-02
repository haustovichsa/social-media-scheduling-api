/**
 * Adapter-facing view of the opaque cursor codec. The primitive itself lives in
 * the domain layer ({@link encodeCursor}/{@link decodeCursor}) so adapters and
 * the comment read path share one implementation; this module just re-exports it
 * under the platforms barrel adapters already import from.
 *
 * The contract for adapters: a {@link PageCursor} is a black box to callers.
 * Each adapter stuffs whatever *it* pages by — an offset, a Graph API `after`
 * token, a `created_before` timestamp — into a small payload and encodes it here.
 * Nothing outside the adapter ever parses it; callers only round-trip the
 * `nextCursor` verbatim, which is what keeps that choice from leaking into the
 * shared model (NFR-1).
 */
export { decodeCursor, encodeCursor } from '../domain/cursor';
