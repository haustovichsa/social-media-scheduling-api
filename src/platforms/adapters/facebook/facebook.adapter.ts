import { Inject, Injectable } from '@nestjs/common';

import { Platform } from '../../../common/enums/platform.enum';
import { TOKEN_PROVIDER, TokenProvider } from '../../../credentials';
import { Page, PageCursor } from '../../../domain';
import { decodeCursor } from '../../cursor';
import {
  AdapterContext,
  PlatformAdapter,
  PlatformCapabilities,
} from '../../platform-adapter.interface';
import {
  FetchedComment,
  FetchedReply,
  ReplyInput,
} from '../../platform-comment';
import { enforceThreadDepth } from '../../thread-depth';
import { withPlatformToken } from '../../with-platform-token';
import {
  FACEBOOK_GRAPH_CLIENT,
  FacebookGraphClient,
} from './facebook-graph.client';
import { FacebookCursor, mapComment, mapNextCursor } from './facebook.mapper';

/**
 * Facebook Graph API adapter (partial sketch). It owns everything
 * Facebook-specific and speaks the shared {@link PlatformAdapter} contract, so
 * the rest of the system never knows Graph exists. Two jobs: drive the
 * {@link FacebookGraphClient}, then hand raw payloads to the mapper. Auth,
 * transport, and error translation live in the client behind the DI token.
 *
 * Threading: Facebook collapses reply-to-a-reply onto the top-level comment, so
 * `maxThreadDepth` is 1 and every page runs through {@link enforceThreadDepth}
 * to guarantee that shape even if the stream returns a deeper chain.
 *
 * Auth: token lookup and the failure-to-{@link TokenExpiredError} mapping live
 * in {@link withPlatformToken}, which the adapter calls per request — it never
 * reads a token directly.
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
    @Inject(TOKEN_PROVIDER)
    private readonly tokens: TokenProvider,
  ) {}

  async getComments(
    ctx: AdapterContext,
    externalPostId: string,
    cursor?: PageCursor,
  ): Promise<Page<FetchedComment>> {
    const after = cursor
      ? decodeCursor<FacebookCursor>(cursor).after
      : undefined;

    const response = await withPlatformToken(
      this.tokens,
      this.platform,
      ctx,
      (token) => this.client.listComments(externalPostId, token, after),
    );

    const items = enforceThreadDepth(
      response.data.map(mapComment),
      this.capabilities.maxThreadDepth,
    );

    return { items, nextCursor: mapNextCursor(response.paging) };
  }

  async replyToComment(
    ctx: AdapterContext,
    externalCommentId: string,
    body: ReplyInput,
  ): Promise<FetchedReply> {
    const created = await withPlatformToken(
      this.tokens,
      this.platform,
      ctx,
      (token) => this.client.createReply(externalCommentId, token, body.text),
    );

    // Graph may drop `parent` on the write response, so pin the parent to the
    // comment we replied to — which is the reply's parent by definition (and
    // satisfies FetchedReply's non-null rule).
    return {
      ...mapComment(created),
      externalParentCommentId: externalCommentId,
    };
  }
}
