/**
 * Typed domain errors the comment services throw. Like {@link MissingCredentialError}
 * and the {@link PlatformError} taxonomy, these stay transport-agnostic: the
 * service layer signals *what* went wrong, and the API edge (TASK-09's exception
 * filter) owns the HTTP mapping. Keeping HTTP concerns out of the service is what
 * lets it be reused and unit-tested without the web layer.
 */

/**
 * The requested post doesn't exist, isn't published, or isn't owned by the
 * caller's org (A-6). The three are deliberately indistinguishable so a caller
 * can't probe for posts it doesn't own — the edge maps this to a single 404.
 */
export class PostNotFoundError extends Error {
  constructor(readonly postId: string) {
    super(`Post "${postId}" not found`);
    this.name = 'PostNotFoundError';
  }
}

/**
 * The comment being replied to doesn't exist, its post isn't published, or
 * neither is owned by the caller's org (A-6). As with {@link PostNotFoundError}
 * the causes are deliberately indistinguishable — the edge maps this to a single
 * 404 so a caller can't probe for comments it doesn't own.
 */
export class CommentNotFoundError extends Error {
  constructor(readonly commentId: string) {
    super(`Comment "${commentId}" not found`);
    this.name = 'CommentNotFoundError';
  }
}

/**
 * A reply with this idempotency key is already in flight (a prior attempt
 * claimed the outbox row but we never recorded its outcome). Re-sending could
 * double-post (RK-4), so we refuse rather than guess: the send is indeterminate,
 * not known-failed. The edge maps this to a 409 so the caller can retry the
 * *same* key later (once the first attempt settles) or poll for the result.
 */
export class ReplyInProgressError extends Error {
  constructor(readonly idempotencyKey: string) {
    super(
      `A reply for idempotency key "${idempotencyKey}" is already in progress`,
    );
    this.name = 'ReplyInProgressError';
  }
}
