/**
 * The comment feature's public surface. The API layer depends on
 * {@link CommentService} and its result/param types from here; everything else
 * (the repository, the cursor codec) is internal.
 */
export { CommentsModule } from './comments.module';
export { CommentNotFoundError, PostNotFoundError } from './comment-errors';
export {
  CommentListResult,
  CommentService,
  GetCommentsParams,
  ReplyToCommentParams,
} from './comment.service';
