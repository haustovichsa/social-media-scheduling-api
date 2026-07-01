import { Inject, Injectable } from '@nestjs/common';

import { Platform } from '../../../common/enums/platform.enum';
import { Page, PageCursor } from '../../../domain';
import { decodeCursor } from '../../cursor';
import {
  PlatformAdapter,
  PlatformCapabilities,
} from '../../platform-adapter.interface';
import {
  FetchedComment,
  FetchedReply,
  ReplyInput,
} from '../../platform-comment';
import { enforceThreadDepth } from '../../thread-depth';
import {
  FACEBOOK_GRAPH_CLIENT,
  FacebookGraphClient,
} from './facebook-graph.client';
import { FacebookCursor, mapComment, mapNextCursor } from './facebook.mapper';

/**
 * Facebook Graph API adapter (partial, realistic sketch). It owns everything
 * Facebook-specific and speaks the shared {@link PlatformAdapter} contract, so
 * the rest of the system never knows Graph exists. Its two jobs are
 * orchestration and normalization: drive the {@link FacebookGraphClient}, then
 * hand the raw payloads to the mapper. Auth, transport, and error translation
 * live in the client behind the DI token.
 *
 * Threading: Facebook collapses reply-to-a-reply onto the top-level comment, so
 * `maxThreadDepth` is 1 and every fetched page is run through
 * {@link enforceThreadDepth} to guarantee that shape even if the stream ever
 * returns a deeper chain.
 */
@Injectable()
export class FacebookAdapter implements PlatformAdapter {
  readonly platform = Platform.Facebook;
  readonly capabilities: PlatformCapabilities = {
    maxThreadDepth: 1,
    supportsWebhooks: true,
  };

  constructor(
    @Inject(FACEBOOK_GRAPH_CLIENT)
    private readonly client: FacebookGraphClient,
  ) {}

  async getComments(
    externalPostId: string,
    cursor?: PageCursor,
  ): Promise<Page<FetchedComment>> {
    const after = cursor
      ? decodeCursor<FacebookCursor>(cursor).after
      : undefined;

    const response = await this.client.listComments(externalPostId, after);

    const items = enforceThreadDepth(
      response.data.map(mapComment),
      this.capabilities.maxThreadDepth,
    );

    return { items, nextCursor: mapNextCursor(response.paging) };
  }

  async replyToComment(
    externalCommentId: string,
    body: ReplyInput,
  ): Promise<FetchedReply> {
    const created = await this.client.createReply(externalCommentId, body.text);

    // The created comment's `parent` may be elided by Graph on the write
    // response, so pin the parent to the comment we replied to — which is the
    // reply's parent by definition (and satisfies FetchedReply's non-null rule).
    return {
      ...mapComment(created),
      externalParentCommentId: externalCommentId,
    };
  }
}
