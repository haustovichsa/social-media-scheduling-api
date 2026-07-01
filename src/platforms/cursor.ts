import { PageCursor } from '../domain';

/**
 * Opaque cursor codec shared by adapters. A {@link PageCursor} is a black box to
 * callers (NFR-1): each adapter stuffs whatever *it* pages by — an offset, a
 * Graph API `after` token, a `created_before` timestamp — into a small payload
 * and encodes it here. base64url keeps the result URL-safe so it drops straight
 * into a query string. Nothing outside the adapter ever parses it; callers only
 * round-trip the `nextCursor` verbatim.
 */
export function encodeCursor(payload: object): PageCursor {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Decode a cursor previously produced by {@link encodeCursor}. A malformed
 * cursor is a bad request (the caller tampered with an opaque token), not a
 * platform failure — hence a plain error the API layer maps to 400, never a
 * {@link PlatformError}.
 */
export function decodeCursor<T>(cursor: PageCursor): T {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
  } catch {
    throw new Error('Invalid pagination cursor');
  }
}
