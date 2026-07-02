/**
 * API request/response DTOs for the comment endpoints. Request DTOs are
 * validated by the global `ValidationPipe`; response DTOs are the published wire
 * contract and map from the canonical domain model via their `fromDomain`
 * factories. The controllers in TASK-09 consume these.
 */
export { CreateReplyDto, MAX_REPLY_LENGTH } from './create-reply.dto';
export {
  ListCommentsQueryDto,
  DEFAULT_PAGE_LIMIT,
  MAX_PAGE_LIMIT,
} from './list-comments.query.dto';
export { AuthorResponseDto } from './author.response.dto';
// A reply is structurally a comment, so the reply endpoint returns the same
// wire shape — there is no separate ReplyResponseDto. The domain `Reply` type
// still carries the non-null-parent invariant; it just maps through here.
export { CommentResponseDto } from './comment.response.dto';
export { CommentPageResponseDto } from './comment-page.response.dto';
