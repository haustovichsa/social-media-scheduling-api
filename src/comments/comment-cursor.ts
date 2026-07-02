import { Types } from 'mongoose';

import { decodeCursor, encodeCursor, PageCursor } from '../domain';

/**
 * The read service's local-store paging cursor — not a platform's paging token
 * (each adapter owns its own). This encodes a position in our own `comments`
 * collection so `GET /posts/:id/comments` can page the local copy stably.
 *
 * We use keyset paging on the read index's sort key
 * (`{ platformCreatedAt, _id }`), not skip/offset: keyset stays stable when a
 * background refresh inserts rows (a new comment can't shift rows across a page
 * boundary) and stays O(page) instead of O(offset). The `_id` tiebreaker makes
 * the sort total, so comments sharing a `platformCreatedAt` (common with
 * second-granularity timestamps) never straddle or repeat across pages.
 *
 * Like every {@link PageCursor} it's opaque to the caller: base64url-encoded so
 * it fits in a query string, and only decoded here.
 */
interface LocalCursorPayload {
  /** `platformCreatedAt` of the last item on the previous page, epoch millis. */
  readonly t: number;
  /** `_id` of that last item — the tiebreaker for equal timestamps. */
  readonly id: string;
}

/** A decoded cursor position: the exclusive lower bound for the next page. */
export interface LocalCursorPosition {
  readonly createdAt: Date;
  readonly id: Types.ObjectId;
}

/** Encode the last item of a page into the cursor that fetches the next one. */
export function encodeCommentCursor(createdAt: Date, id: string): PageCursor {
  const payload: LocalCursorPayload = { t: createdAt.getTime(), id };
  return encodeCursor(payload);
}

/**
 * Decode a cursor produced by {@link encodeCommentCursor}. A malformed or
 * tampered cursor is the caller's bad request, not a server fault — the shared
 * {@link decodeCursor} throws a plain `Error` the API maps to 400, never a
 * `PlatformError`. We also validate every field (including that `id` is a real
 * ObjectId) so a hand-crafted cursor can't reach a query as an invalid value.
 */
export function decodeCommentCursor(cursor: PageCursor): LocalCursorPosition {
  const payload = decodeCursor<LocalCursorPayload>(cursor);

  if (
    typeof payload?.t !== 'number' ||
    !Number.isFinite(payload.t) ||
    typeof payload?.id !== 'string' ||
    !Types.ObjectId.isValid(payload.id)
  ) {
    throw new Error('Invalid pagination cursor');
  }

  return {
    createdAt: new Date(payload.t),
    id: new Types.ObjectId(payload.id),
  };
}
