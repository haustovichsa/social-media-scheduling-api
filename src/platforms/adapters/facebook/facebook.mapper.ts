import { PageCursor } from '../../../domain';
import { encodeCursor } from '../../cursor';
import { FetchedAuthor, FetchedComment } from '../../platform-comment';
import { FacebookComment, FacebookPaging } from './facebook-graph.types';

/** How the Facebook cursor encodes its position: the Graph `after` token. */
export interface FacebookCursor {
  readonly after: string;
}

/** Author shown when Facebook withholds `from` (the commenter's privacy setting). */
const UNKNOWN_AUTHOR: FetchedAuthor = {
  externalAuthorId: 'unknown',
  displayName: 'Unknown',
};

/**
 * Map one raw Graph comment to the canonical {@link FetchedComment}. This is the
 * whole point of the adapter: Graph's `from`/`parent`/`created_time` shape stops
 * here and only platform-free fields continue upward (NFR-1). A missing `from`
 * (withheld by privacy) degrades to a placeholder author rather than throwing.
 */
export function mapComment(raw: FacebookComment): FetchedComment {
  return {
    externalCommentId: raw.id,
    externalParentCommentId: raw.parent?.id ?? null,
    author: mapAuthor(raw.from),
    text: raw.message,
    platformCreatedAt: new Date(raw.created_time),
  };
}

function mapAuthor(from: FacebookComment['from']): FetchedAuthor {
  if (!from) {
    return UNKNOWN_AUTHOR;
  }
  const avatarUrl = from.picture?.data?.url;
  return {
    externalAuthorId: from.id,
    displayName: from.name,
    ...(avatarUrl ? { avatarUrl } : {}),
  };
}

/**
 * Turn Graph paging into our opaque `nextCursor`. Graph signals end-of-list by
 * *omitting* `paging.next`, so we only emit a cursor when both `next` and an
 * `after` token are present; otherwise `null`. The `after` token is wrapped so
 * the Graph-specific shape never leaks past the adapter.
 */
export function mapNextCursor(paging?: FacebookPaging): PageCursor | null {
  const after = paging?.cursors?.after;
  return paging?.next && after
    ? encodeCursor({ after } satisfies FacebookCursor)
    : null;
}
