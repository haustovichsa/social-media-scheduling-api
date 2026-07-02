import { PageCursor } from '../../../domain';
import { AdapterContext } from '../../platform-adapter.interface';
import { ResourceNotFoundError } from '../../platform-errors';
import { FetchedComment } from '../../platform-comment';
import { MockAdapter } from './mock.adapter';

/** The mock ignores the account context, but the contract still requires one. */
const CTX: AdapterContext = { platformAccountId: 'acc-1' };

/**
 * Exercises the MockAdapter against the behaviours every adapter must honour
 * (the contract TASK-12 formalises): opaque cursor round-tripping, full
 * traversal without gaps or repeats, a null cursor at end-of-list, and typed
 * failures. A fresh adapter per test keeps the in-memory store deterministic.
 */
describe('MockAdapter', () => {
  let adapter: MockAdapter;

  beforeEach(() => {
    adapter = new MockAdapter();
  });

  /** Drain every page for a post, returning the flattened item list. */
  async function drain(postId: string): Promise<FetchedComment[]> {
    const all: FetchedComment[] = [];
    let cursor: PageCursor | undefined;
    do {
      const page = await adapter.getComments(CTX, postId, cursor);
      all.push(...page.items);
      cursor = page.nextCursor ?? undefined;
    } while (cursor);
    return all;
  }

  it('reports itself as the mock platform', () => {
    expect(adapter.platform).toBe('mock');
  });

  it('pages through all comments exactly once, then ends with a null cursor', async () => {
    const first = await adapter.getComments(CTX, 'post-1');
    expect(first.items).toHaveLength(2);
    expect(first.nextCursor).not.toBeNull();

    const all = await drain('post-1');
    expect(all.map((c) => c.externalCommentId)).toEqual([
      'm-c1',
      'm-c2',
      'm-r1',
      'm-r2',
      'm-c3',
    ]);
  });

  it('round-trips the opaque cursor to fetch the next page', async () => {
    const first = await adapter.getComments(CTX, 'post-1');
    const second = await adapter.getComments(
      CTX,
      'post-1',
      first.nextCursor ?? undefined,
    );

    expect(second.items.map((c) => c.externalCommentId)).toEqual([
      'm-r1',
      'm-r2',
    ]);
    // The cursor is opaque — a base64url token, not a readable offset.
    expect(first.nextCursor).toMatch(/^[\w-]+$/);
  });

  it('preserves threading: a reply points at its parent', async () => {
    const all = await drain('post-1');
    const reply = all.find((c) => c.externalCommentId === 'm-r1');
    const nested = all.find((c) => c.externalCommentId === 'm-r2');

    expect(reply?.externalParentCommentId).toBe('m-c1');
    expect(nested?.externalParentCommentId).toBe('m-r1');
  });

  it('returns an empty, terminal page for an unknown post', async () => {
    const page = await adapter.getComments(CTX, 'no-such-post');
    expect(page.items).toEqual([]);
    expect(page.nextCursor).toBeNull();
  });

  it('creates a reply threaded under its parent and reads it back', async () => {
    const reply = await adapter.replyToComment(CTX, 'm-c2', {
      text: 'well said',
    });

    expect(reply.externalParentCommentId).toBe('m-c2');
    expect(reply.text).toBe('well said');

    const all = await drain('post-1');
    expect(all.map((c) => c.externalCommentId)).toContain(
      reply.externalCommentId,
    );
  });

  it('flattens a reply that would exceed max depth onto the allowed ancestor', async () => {
    // m-r2 is already at depth 2 (the cap); replying to it must not create a
    // depth-3 comment — it re-parents onto m-r2's parent, m-r1.
    const reply = await adapter.replyToComment(CTX, 'm-r2', {
      text: 'still here',
    });
    expect(reply.externalParentCommentId).toBe('m-r1');
  });

  it('throws a typed ResourceNotFoundError when replying to a missing comment', async () => {
    await expect(
      adapter.replyToComment(CTX, 'nope', { text: 'hi' }),
    ).rejects.toBeInstanceOf(ResourceNotFoundError);
  });
});
