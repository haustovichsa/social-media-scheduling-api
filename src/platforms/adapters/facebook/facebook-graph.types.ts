/**
 * The part of the Facebook Graph comment shape this adapter uses. These are the
 * raw platform types — they stay behind the adapter and never escape it; the
 * mapper turns them into the canonical `FetchedComment`. Fields mirror a
 * `GET /{post-id}/comments?fields=id,message,created_time,from{id,name,picture},
 * parent{id}&filter=stream` request, which returns every comment and reply in
 * one flat stream, each with an optional `parent` pointer.
 */

/** A commenter. May be absent when the user hasn't granted profile access. */
export interface FacebookUser {
  readonly id: string;
  readonly name: string;
  readonly picture?: { readonly data?: { readonly url?: string } };
}

export interface FacebookComment {
  readonly id: string;
  readonly message: string;
  /** ISO-8601 timestamp, e.g. `2026-01-02T03:04:05+0000`. */
  readonly created_time: string;
  readonly from?: FacebookUser;
  /** Present on replies; points at the parent comment. Absent on top-level. */
  readonly parent?: { readonly id: string };
}

/**
 * Graph cursor-based paging. `cursors.after` is the next-page token; `next` is
 * the full URL for it and is absent on the last page — that absence is our
 * end-of-list signal, not an empty `data` array.
 */
export interface FacebookPaging {
  readonly cursors?: { readonly before?: string; readonly after?: string };
  readonly next?: string;
}

export interface FacebookCommentsResponse {
  readonly data: readonly FacebookComment[];
  readonly paging?: FacebookPaging;
}
