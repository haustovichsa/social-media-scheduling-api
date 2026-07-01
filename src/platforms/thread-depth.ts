import { FetchedComment } from './platform-comment';

/** Minimal shape the depth helpers need: a stable id for cycle detection. */
type Threaded = { readonly externalCommentId: string };

/**
 * Number of ancestors reachable from `node` via `parentOf`. Depth 0 is a root —
 * no parent, or a parent `parentOf` cannot resolve (e.g. split across a page
 * boundary, or missing from the batch). Cycle-safe: a malformed chain that loops
 * back on itself stops rather than spinning forever.
 *
 * `parentOf` is the seam that lets the same walk serve different backings — an
 * in-batch `Map` for the read path, the live store for the mock's reply path.
 */
export function depthOf<T extends Threaded>(
  node: T,
  parentOf: (n: T) => T | undefined,
): number {
  const seen = new Set<string>([node.externalCommentId]);
  let depth = 0;
  for (let p = parentOf(node); p && !seen.has(p.externalCommentId);) {
    seen.add(p.externalCommentId);
    depth += 1;
    p = parentOf(p);
  }
  return depth;
}

/**
 * The ancestor of `node` sitting at `targetDepth`, walking up from `node`. The
 * number of hops is `depth(node) - targetDepth`, computed once, so the chain is
 * walked a single time (no re-measuring per step). If the chain ends early
 * (missing or looping parent) the highest reached node is returned.
 */
export function ancestorAtDepth<T extends Threaded>(
  node: T,
  targetDepth: number,
  parentOf: (n: T) => T | undefined,
): T {
  let hops = depthOf(node, parentOf) - targetDepth;
  let current = node;
  while (hops > 0) {
    const parent = parentOf(current);
    if (!parent) {
      break;
    }
    current = parent;
    hops -= 1;
  }
  return current;
}

/**
 * Enforce a platform's maximum reply-nesting depth on a batch of fetched
 * comments (A-5). Platforms cap threading at different depths — Facebook, for
 * instance, collapses a reply-to-a-reply onto the top-level comment — so an
 * adapter runs its page through here to match that behaviour in our flat,
 * pointer-based model: a comment deeper than `maxDepth` is *re-parented* onto
 * its deepest still-allowed ancestor rather than dropped, so no comment is lost.
 *
 * Depth is measured only against ancestors present in this batch, so a comment
 * whose parent isn't in the batch counts as a root and is left untouched; the
 * service resolves its real parent later by external id.
 *
 * Pure and non-mutating: returns new {@link FetchedComment}s with adjusted
 * `externalParentCommentId`, computing every depth against the original links.
 * `maxDepth` is assumed to be at least 1.
 */
export function enforceThreadDepth(
  comments: readonly FetchedComment[],
  maxDepth: number,
): FetchedComment[] {
  const byId = new Map(comments.map((c) => [c.externalCommentId, c]));
  const parentOf = (c: FetchedComment): FetchedComment | undefined =>
    c.externalParentCommentId === null
      ? undefined
      : byId.get(c.externalParentCommentId);

  return comments.map((comment) =>
    depthOf(comment, parentOf) > maxDepth
      ? {
          ...comment,
          externalParentCommentId: ancestorAtDepth(
            comment,
            maxDepth - 1,
            parentOf,
          ).externalCommentId,
        }
      : comment,
  );
}
