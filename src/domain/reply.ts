import { Comment } from './comment';

/**
 * Canonical view of a reply we posted to the platform and then saved.
 *
 * A reply is structurally a comment — same collection, same shape. It's a
 * separate type only to make one invariant explicit: a reply is always threaded
 * under a parent, so `parentCommentId` is a non-null string. That lets callers of
 * the reply flow rely on the parent id without a runtime null check.
 */
export interface Reply extends Omit<Comment, 'parentCommentId'> {
  /** The comment this reply is threaded under — never null for a reply. */
  readonly parentCommentId: string;
}
