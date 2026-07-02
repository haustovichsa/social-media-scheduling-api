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
