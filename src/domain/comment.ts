import { Platform } from '../common/enums/platform.enum';
import { Author } from './author';

/**
 * Canonical, platform-free view of a comment — the single shared shape services
 * and controllers speak, whatever platform it came from. The adapter layer keeps
 * platform-native fields from ever reaching this type.
 *
 * Mirrors the {@link Comment} persistence model but is a plain domain object: ids
 * are strings, not Mongo `ObjectId`s, with no Mongoose concerns. The repository
 * maps `CommentDocument` → `Comment` on the way out.
 *
 * Threading matches storage: a top-level comment has `parentCommentId === null`;
 * a reply points at its parent's id.
 */
export interface Comment {
  /** Our own id for this comment (the persistence document id, as a string). */
  readonly id: string;
  /** Our own id for the post this comment belongs to. */
  readonly postId: string;
  readonly platform: Platform;
  /** Parent comment id, or `null` for a top-level comment. */
  readonly parentCommentId: string | null;
  readonly author: Author;
  readonly text: string;
  /** When the platform says the comment was created (the paging sort key). */
  readonly createdAt: Date;
  /** When we last reconciled this comment with the platform (freshness). */
  readonly syncedAt: Date;
}
