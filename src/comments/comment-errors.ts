/**
 * Typed errors the comment services throw. Like the {@link PlatformError}
 * family, they stay transport-agnostic: the service says what went wrong, and the
 * API edge (the exception filter) owns the HTTP mapping. Keeping HTTP out of the
 * service lets it be reused and unit-tested without the web layer.
 */

/**
 * The post doesn't exist, isn't published, or isn't owned by the caller's org.
 * The three are kept indistinguishable so callers can't probe for posts they
 * don't own — the edge maps this to one 404.
 */
export class PostNotFoundError extends Error {
  constructor(readonly postId: string) {
    super(`Post "${postId}" not found`);
    this.name = 'PostNotFoundError';
  }
}

/**
 * The comment being replied to doesn't exist, its post isn't published, or
 * neither is owned by the caller's org. As with {@link PostNotFoundError} the
 * causes are kept indistinguishable — the edge maps this to one 404 so callers
 * can't probe for comments they don't own.
 */
export class CommentNotFoundError extends Error {
  constructor(readonly commentId: string) {
    super(`Comment "${commentId}" not found`);
    this.name = 'CommentNotFoundError';
  }
}
