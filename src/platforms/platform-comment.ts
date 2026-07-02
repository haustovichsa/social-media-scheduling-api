/**
 * The shapes an adapter exchanges with the core, keyed by the platform's own ids.
 * Deliberately not the canonical {@link Comment} domain type: that carries our
 * internal Mongo ids (`id`, `postId`), which only exist once the service has
 * persisted the row. An adapter never sees our ids — it maps a raw platform
 * payload to these external-keyed structs, and the service upserts them (keyed by
 * `{ platform, externalCommentId }`) and assigns our ids.
 *
 * This boundary is what stops platform-native fields from leaking upward: the
 * adapter's job ends at producing a `FetchedComment`.
 */

/** A comment author as the platform reports it, reduced to portable fields. */
export interface FetchedAuthor {
  /** The author's id on the platform (stable per platform, not global). */
  readonly externalAuthorId: string;
  readonly displayName: string;
  readonly avatarUrl?: string;
}

/**
 * A comment mapped from a platform payload. `externalParentCommentId` is `null`
 * for a top-level comment and the parent's external id for a reply — the same
 * threading model as storage, in the platform's id space so the service can
 * resolve it to our internal `parentCommentId` on upsert.
 */
export interface FetchedComment {
  readonly externalCommentId: string;
  /** Parent's external id, or `null` for a top-level comment. */
  readonly externalParentCommentId: string | null;
  readonly author: FetchedAuthor;
  readonly text: string;
  /** When the platform says the comment was created (the paging sort key). */
  readonly platformCreatedAt: Date;
}

/**
 * The comment a platform created in response to a reply. Structurally a
 * {@link FetchedComment}, but its parent is always the comment we replied to, so
 * `externalParentCommentId` is a non-null string — mirroring the canonical
 * {@link Reply}'s non-null-parent invariant.
 */
export interface FetchedReply extends FetchedComment {
  readonly externalParentCommentId: string;
}

/** What the caller wants to post. The only field a reply body carries today. */
export interface ReplyInput {
  readonly text: string;
}
