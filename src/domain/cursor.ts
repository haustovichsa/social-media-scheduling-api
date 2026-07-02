import { PageCursor } from './page';

/**
 * The opaque {@link PageCursor} transport primitive: serialize a small payload to
 * a URL-safe token and back. It is intentionally domain-level (not owned by any
 * one feature) because every paginated boundary needs the same black-box cursor
 * — platform adapters encode their platform paging token, the comment read path
 * encodes a local-store position — and none of them should re-implement or
 * depend on another's codec. What each payload *means* stays with its owner; only
 * the encoding lives here.
 *
 * base64url keeps the result safe to drop straight into a query string.
 */
export function encodeCursor(payload: object): PageCursor {
  return Buffer.from(JSON.stringify(payload), 'utf8').toString('base64url');
}

/**
 * Decode a cursor previously produced by {@link encodeCursor}. A malformed cursor
 * is a bad request (the caller tampered with an opaque token), not a server
 * fault — hence a plain error the API layer maps to 400. Callers that carry
 * structured payloads should still validate the decoded fields before use.
 */
export function decodeCursor<T>(cursor: PageCursor): T {
  try {
    return JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as T;
  } catch {
    throw new Error('Invalid pagination cursor');
  }
}
