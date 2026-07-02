import { PageCursor } from './page';

/**
 * Encodes a small payload into an opaque, URL-safe {@link PageCursor}. It lives at
 * the domain level (not in any one feature) because every paginated boundary
 * needs the same black-box cursor and none should re-implement or depend on
 * another's codec. What each payload means stays with its owner; only the
 * encoding lives here. base64url keeps the result safe in a query string.
 */
export function encodeCursor(payload: object): PageCursor {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Decode a cursor produced by {@link encodeCursor}. A malformed cursor is a bad
 * request (the caller tampered with an opaque token), not a server fault — a
 * plain error the API layer maps to 400. Callers should still validate the
 * decoded fields before use.
 */
export function decodeCursor<T>(cursor: PageCursor): T {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
  } catch {
    throw new Error('Invalid pagination cursor');
  }
}
