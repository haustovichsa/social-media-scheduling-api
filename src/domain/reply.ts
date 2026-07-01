import { Comment } from './comment';

/**
 * Canonical view of a reply we posted to the platform and then saved (FR-2).
 *
 * Structurally a reply *is* a comment — it lives in the same `comments`
 * collection and shares the same shape. It is kept as its own type only to make
 * one invariant explicit in the type system: a reply is always threaded under a
 * parent, so `parentCommentId` is a non-null string, never `null`. Modelling it
 * as a distinct type (rather than reusing {@link Comment}) means callers of the
 * reply flow can rely on that parent id without a runtime null check.
 */
export interface Reply extends Omit<Comment, 'parentCommentId'> {
  /** The comment this reply is threaded under — never null for a reply. */
  readonly parentCommentId: string;
}
