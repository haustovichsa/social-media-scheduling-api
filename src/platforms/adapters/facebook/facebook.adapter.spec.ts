import { Platform } from '../../../common/enums/platform.enum';
import { TokenProvider } from '../../../credentials';
import { decodeCursor } from '../../cursor';
import { AdapterContext } from '../../platform-adapter.interface';
import { RateLimitError } from '../../platform-errors';
import { FacebookAdapter } from './facebook.adapter';
import { FacebookGraphClient } from './facebook-graph.client';
import {
  FacebookComment,
  FacebookCommentsResponse,
} from './facebook-graph.types';
import { FacebookCursor } from './facebook.mapper';

const CTX: AdapterContext = { platformAccountId: 'acc-1' };

const rawComment = (
  overrides: Partial<FacebookComment> = {},
): FacebookComment => ({
  id: 'fb-1',
  message: 'hello',
  created_time: '2026-01-02T03:04:05+0000',
  from: { id: 'u1', name: 'Ada', picture: { data: { url: 'http://x/a.png' } } },
  ...overrides,
});

/** A programmable fake so the adapter is tested with no network or auth. */
class FakeGraphClient implements FacebookGraphClient {
  listCommentsResult: FacebookCommentsResponse = { data: [] };
  createReplyResult: FacebookComment = rawComment();
  lastAfter?: string;
  lastToken?: string;
  /** Thrown on every call — models a persistent failure. */
  error?: Error;

  listComments(
    _postId: string,
    accessToken: string,
    after?: string,
  ): Promise<FacebookCommentsResponse> {
    this.lastAfter = after;
    this.lastToken = accessToken;
    return this.error
      ? Promise.reject(this.error)
      : Promise.resolve(this.listCommentsResult);
  }

  createReply(
    _commentId: string,
    accessToken: string,
  ): Promise<FacebookComment> {
    this.lastToken = accessToken;
    return this.error
      ? Promise.reject(this.error)
      : Promise.resolve(this.createReplyResult);
  }
}

/** A token provider that hands out a predictable token and counts calls. */
class FakeTokenProvider implements TokenProvider {
  getCalls = 0;

  getToken(): Promise<string> {
    this.getCalls += 1;
    return Promise.resolve('access-token');
  }
}

describe('FacebookAdapter', () => {
  let client: FakeGraphClient;
  let tokens: FakeTokenProvider;
  let adapter: FacebookAdapter;

  beforeEach(() => {
    client = new FakeGraphClient();
    tokens = new FakeTokenProvider();
    adapter = new FacebookAdapter(client, tokens);
  });

  it('normalises Graph comments into the canonical shape', async () => {
    client.listCommentsResult = {
      data: [
        rawComment({ id: 'c1' }),
        rawComment({ id: 'r1', parent: { id: 'c1' }, from: undefined }),
      ],
    };

    const page = await adapter.getComments(CTX, 'post-1');

    expect(page.items[0]).toMatchObject({
      externalCommentId: 'c1',
      externalParentCommentId: null,
      author: { externalAuthorId: 'u1', displayName: 'Ada' },
      text: 'hello',
    });
    expect(page.items[0].platformCreatedAt.toISOString()).toBe(
      '2026-01-02T03:04:05.000Z',
    );
    // A reply keeps its parent; a withheld `from` degrades to a placeholder.
    expect(page.items[1].externalParentCommentId).toBe('c1');
    expect(page.items[1].author.displayName).toBe('Unknown');
  });

  it('authenticates the call with a token from the provider', async () => {
    await adapter.getComments(CTX, 'post-1');
    expect(tokens.getCalls).toBe(1);
    expect(client.lastToken).toBe('access-token');
  });

  it('emits an opaque cursor wrapping the Graph `after` token, and round-trips it', async () => {
    client.listCommentsResult = {
      data: [rawComment()],
      paging: { cursors: { after: 'AFTER_TOKEN' }, next: 'https://next' },
    };

    const page = await adapter.getComments(CTX, 'post-1');
    expect(page.nextCursor).not.toBeNull();
    expect(decodeCursor<FacebookCursor>(page.nextCursor!).after).toBe(
      'AFTER_TOKEN',
    );

    await adapter.getComments(CTX, 'post-1', page.nextCursor!);
    expect(client.lastAfter).toBe('AFTER_TOKEN');
  });

  it('reports end-of-list as a null cursor when Graph omits `next`', async () => {
    client.listCommentsResult = {
      data: [rawComment()],
      paging: { cursors: { after: 'AFTER_TOKEN' } }, // no `next`
    };
    const page = await adapter.getComments(CTX, 'post-1');
    expect(page.nextCursor).toBeNull();
  });

  it('flattens a deeper chain to Facebook depth (reply-to-reply → top level)', async () => {
    client.listCommentsResult = {
      data: [
        rawComment({ id: 'c1' }),
        rawComment({ id: 'r1', parent: { id: 'c1' } }),
        rawComment({ id: 'r2', parent: { id: 'r1' } }),
      ],
    };
    const page = await adapter.getComments(CTX, 'post-1');
    const r2 = page.items.find((c) => c.externalCommentId === 'r2');
    expect(r2?.externalParentCommentId).toBe('c1');
  });

  it('maps a created reply, pinning its parent to the replied-to comment', async () => {
    client.createReplyResult = rawComment({ id: 'new-reply' });
    const reply = await adapter.replyToComment(CTX, 'c1', { text: 'thanks' });

    expect(reply.externalCommentId).toBe('new-reply');
    expect(reply.externalParentCommentId).toBe('c1');
  });

  it('lets typed platform errors from the client propagate untouched', async () => {
    client.error = new RateLimitError(Platform.Facebook);
    await expect(adapter.getComments(CTX, 'post-1')).rejects.toBeInstanceOf(
      RateLimitError,
    );
  });
});
