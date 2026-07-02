/**
 * Adapter-facing view of the opaque cursor codec. The codec itself lives in the
 * domain layer ({@link encodeCursor}/{@link decodeCursor}) so adapters and the
 * comment read path share one implementation; this just re-exports it under the
 * platforms barrel adapters already import from.
 *
 * The contract for adapters: a {@link PageCursor} is a black box to callers.
 * Each adapter encodes whatever it pages by — an offset, a Graph API `after`
 * token, a `created_before` timestamp — into a small payload here. Nothing
 * outside the adapter parses it; callers only round-trip the `nextCursor`
 * verbatim, which keeps that choice out of the shared model.
 */
export { decodeCursor, encodeCursor } from '../domain/cursor';
