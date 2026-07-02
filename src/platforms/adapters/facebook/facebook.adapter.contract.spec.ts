import { Platform } from '../../../common/enums/platform.enum';
import { TokenProvider } from '../../../credentials';
import { runAdapterContractTests } from '../../adapter-contract.shared-spec';
import { ResourceNotFoundError } from '../../platform-errors';
import { FacebookAdapter } from './facebook.adapter';
import { FacebookGraphClient } from './facebook-graph.client';
import {
  FacebookComment,
  FacebookCommentsResponse,
} from './facebook-graph.types';

/**
 * Runs the same reusable contract against the FacebookAdapter, backed by a
 * seeded fake Graph client (no network). Proving the *identical* suite passes
 * for a second, structurally different adapter is the point of the contract
 * (AC-3, RK-7): the read/reply guarantees hold regardless of the platform behind
 * them. Facebook-specific mapping and depth-flattening are unit-tested in
 * `facebook.adapter.spec.ts`; this file only asserts the shared behaviour.
 */

const rawComment = (
  id: string,
  message: string,
  parentId?: string,
): FacebookComment => ({
  id,
  message,
  created_time: '2026-01-02T03:04:05+0000',
  from: { id: 'u1', name: 'Ada' },
  ...(parentId ? { parent: { id: parentId } } : {}),
});

/** A two-page comment stream plus a not-found reply target, all in memory. */
class SeededGraphClient implements FacebookGraphClient {
  constructor(private readonly missingCommentId: string) {}

  listComments(
    _externalPostId: string,
    _accessToken: string,
    after?: string,
  ): Promise<FacebookCommentsResponse> {
    if (!after) {
      // First page: two top-level comments, `next` present → not the last page.
      return Promise.resolve({
        data: [rawComment('c1', 'first'), rawComment('c2', 'second')],
        paging: { cursors: { after: 'PAGE_2' }, next: 'https://graph/next' },
      });
    }
    // Second page: a reply, no `next` → end of list.
    return Promise.resolve({
      data: [rawComment('r1', 'a reply', 'c1')],
      paging: { cursors: { after: 'END' } },
    });
  }

  createReply(
    externalCommentId: string,
    _accessToken: string,
    message: string,
  ): Promise<FacebookComment> {
    if (externalCommentId === this.missingCommentId) {
      return Promise.reject(
        new ResourceNotFoundError(Platform.Facebook, externalCommentId),
      );
    }
    return Promise.resolve(rawComment('new-reply', message));
  }
}

/** Hands out a predictable token; the contract never inspects auth. */
class StubTokenProvider implements TokenProvider {
  getToken(): Promise<string> {
    return Promise.resolve('access-token');
  }
}

const MISSING = 'no-such-comment';

runAdapterContractTests({
  description: 'FacebookAdapter (seeded fake Graph client)',
  createAdapter: () =>
    new FacebookAdapter(
      new SeededGraphClient(MISSING),
      new StubTokenProvider(),
    ),
  ctx: { platformAccountId: 'acc-1' },
  postId: 'post-1',
  replyToCommentId: 'c1',
  missingCommentId: MISSING,
});
