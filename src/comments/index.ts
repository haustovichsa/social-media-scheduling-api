/**
 * The comment feature's public surface (FR-1/FR-2). The API layer (TASK-09)
 * depends on {@link CommentService} and its result/param types from here;
 * everything else (the repository, the cursor codec) is an internal detail.
 */
export { CommentsModule } from './comments.module';
export { PostNotFoundError } from './comment-errors';
export {
  COMMENT_STALE_AFTER_MS,
  CommentListResult,
  CommentService,
  GetCommentsParams,
} from './comment.service';
