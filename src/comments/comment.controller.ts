import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBadRequestResponse,
  ApiBearerAuth,
  ApiConflictResponse,
  ApiCreatedResponse,
  ApiNotFoundResponse,
  ApiOkResponse,
  ApiOperation,
  ApiParam,
  ApiResponse,
  ApiTags,
  ApiUnauthorizedResponse,
} from '@nestjs/swagger';

import { AuthGuard } from '../auth';
import { ApiErrorResponse, CurrentOrgId } from '../common/http';
import { CommentService } from './comment.service';
import {
  CommentPageResponseDto,
  CommentResponseDto,
  CreateReplyDto,
  ListCommentsQueryDto,
} from './dto';

/**
 * The REST edge for the comment feature (FR-4). It does three small things and
 * nothing else: read the caller's org from the request (resolved by
 * {@link AuthGuard} and injected via {@link CurrentOrgId}), delegate to
 * {@link CommentService}, and map the canonical result up to the wire DTOs. All
 * error translation lives in the global {@link DomainExceptionFilter};
 * controllers never catch or shape errors, so a platform failure and a
 * not-found both flow out as the documented {@link ApiErrorResponse} envelope
 * (AC-5). Only canonical shapes cross this boundary — never a raw platform
 * payload.
 *
 * `@UseGuards(AuthGuard)` protects both routes (AC-4): an unauthenticated
 * request is rejected with 401 before any handler runs, and the resolved org
 * scopes every downstream query so cross-tenant access surfaces as a 404.
 */
@ApiTags('comments')
@ApiBearerAuth()
@UseGuards(AuthGuard)
@ApiUnauthorizedResponse({
  description: 'Missing or invalid credentials.',
  type: ApiErrorResponse,
})
@ApiBadRequestResponse({
  description: 'Request validation failed.',
  type: ApiErrorResponse,
})
@ApiResponse({
  status: HttpStatus.TOO_MANY_REQUESTS,
  description: 'The platform throttled the request; see `Retry-After`.',
  type: ApiErrorResponse,
})
@ApiResponse({
  status: HttpStatus.BAD_GATEWAY,
  description:
    'An upstream platform failure (unavailable, expired token, or unclassified).',
  type: ApiErrorResponse,
})
@Controller()
export class CommentController {
  constructor(private readonly comments: CommentService) {}

  @Get('posts/:postId/comments')
  @ApiOperation({
    summary: 'List a published post’s comments',
    description:
      'Returns one page of comments in the canonical shape with an opaque ' +
      '`nextCursor` and a `syncedAt` freshness stamp. Served from our local ' +
      'copy, refreshed from the platform on demand when stale (A-4).',
  })
  @ApiParam({ name: 'postId', description: 'Our internal post id.' })
  @ApiOkResponse({ type: CommentPageResponseDto })
  @ApiNotFoundResponse({
    description: 'No such published post owned by the caller.',
    type: ApiErrorResponse,
  })
  async listComments(
    @CurrentOrgId() orgId: string,
    @Param('postId') postId: string,
    @Query() query: ListCommentsQueryDto,
  ): Promise<CommentPageResponseDto> {
    const { page, syncedAt } = await this.comments.getComments({
      orgId,
      postId,
      cursor: query.cursor,
      limit: query.limit,
    });
    return CommentPageResponseDto.fromDomain(page, syncedAt);
  }

  @Post('comments/:commentId/replies')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Reply to a comment',
    description:
      'Posts a reply to the platform, then persists and returns it in the ' +
      'canonical shape (FR-2). The body carries an `idempotencyKey`: retrying ' +
      'the same key never posts twice (RK-4) — it replays the stored reply, or ' +
      'returns 409 while a first attempt is still settling.',
  })
  @ApiParam({
    name: 'commentId',
    description: 'Our internal id of the comment being replied to.',
  })
  @ApiCreatedResponse({ type: CommentResponseDto })
  @ApiNotFoundResponse({
    description: 'No such comment owned by the caller.',
    type: ApiErrorResponse,
  })
  @ApiConflictResponse({
    description:
      'A reply for this idempotency key is still in progress; retry the same key later.',
    type: ApiErrorResponse,
  })
  async replyToComment(
    @CurrentOrgId() orgId: string,
    @Param('commentId') commentId: string,
    @Body() body: CreateReplyDto,
  ): Promise<CommentResponseDto> {
    const reply = await this.comments.replyToComment({
      orgId,
      commentId,
      text: body.text,
      idempotencyKey: body.idempotencyKey,
    });
    return CommentResponseDto.fromDomain(reply);
  }
}
