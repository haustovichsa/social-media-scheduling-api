import { Page, PageCursor } from '../domain';
import { AdapterContext, PlatformAdapter } from './platform-adapter.interface';
import { FetchedComment } from './platform-comment';
import { PlatformError, ResourceNotFoundError } from './platform-errors';
import { depthOf } from './thread-depth';

/**
 * The fixtures a platform must supply to run the shared contract. Everything the
 * suite needs to drive a real read/reply cycle, kept platform-agnostic: the
 * caller names a post that has comments and a comment that can be replied to,
 * and the suite asserts the *behaviour* around them — never the specific ids or
 * text, which differ per platform.
 */
export interface AdapterContractFixtures {
  /** Shown in the test name, e.g. the platform's own label. */
  readonly description: string;
  /** A fresh adapter per test, so in-memory adapters stay deterministic. */
  createAdapter(): PlatformAdapter;
  /** The account context to act as (ignored by adapters that need no token). */
  readonly ctx: AdapterContext;
  /** A post the adapter can page comments for — ideally spanning >1 page. */
  readonly postId: string;
  /** An existing comment under {@link postId} that a reply can target. */
  readonly replyToCommentId: string;
  /** An id guaranteed not to exist, to exercise the not-found path. */
  readonly missingCommentId: string;
}

/** Hard cap on pages drained, so a broken `nextCursor` fails loud, not forever. */
const MAX_PAGES = 100;

/**
 * The reusable adapter contract (TASK-12, RK-7). Every platform adapter is run
 * through this identical suite, so "add a platform = write an adapter" (AC-3)
 * stays honest: a new adapter that drifts from the shared behaviour fails here
 * before it can mislead the core. It encodes exactly the two guarantees the
 * {@link PlatformAdapter} interface documents — typed errors only, and an opaque
 * cursor that round-trips to `null` — plus the shared-shape and thread-depth
 * rules the read path relies on.
 *
 * Call it from a platform's own `*.spec.ts` with that platform's fixtures; the
 * file itself is not collected as a test (no `.spec.ts` suffix) and is excluded
 * from the build, so it ships nowhere and runs only when a real adapter invokes it.
 */
export function runAdapterContractTests(
  fixtures: AdapterContractFixtures,
): void {
  describe(`PlatformAdapter contract: ${fixtures.description}`, () => {
    let adapter: PlatformAdapter;

    beforeEach(() => {
      adapter = fixtures.createAdapter();
    });

    /** Drain every page for a post, returning each page in order (bounded). */
    async function eachPage(): Promise<Page<FetchedComment>[]> {
      const pages: Page<FetchedComment>[] = [];
      let cursor: PageCursor | undefined;
      for (let i = 0; i < MAX_PAGES; i++) {
        const page = await adapter.getComments(
          fixtures.ctx,
          fixtures.postId,
          cursor,
        );
        pages.push(page);
        if (page.nextCursor === null) {
          return pages;
        }
        cursor = page.nextCursor;
      }
      throw new Error(
        `getComments did not terminate within ${MAX_PAGES} pages — nextCursor never became null`,
      );
    }

    it('declares a platform and sane capabilities', () => {
      expect(adapter.platform).toBeTruthy();
      expect(adapter.capabilities.maxThreadDepth).toBeGreaterThanOrEqual(1);
      expect(typeof adapter.capabilities.supportsWebhooks).toBe('boolean');
    });

    it('returns well-formed, platform-free FetchedComments', async () => {
      const [first] = await eachPage();

      for (const comment of first.items) {
        expect(typeof comment.externalCommentId).toBe('string');
        expect(comment.externalCommentId.length).toBeGreaterThan(0);
        // Parent is a string (a reply) or null (top-level) — never undefined.
        expect(
          comment.externalParentCommentId === null ||
            typeof comment.externalParentCommentId === 'string',
        ).toBe(true);
        expect(typeof comment.author.externalAuthorId).toBe('string');
        expect(typeof comment.author.displayName).toBe('string');
        expect(typeof comment.text).toBe('string');
        expect(comment.platformCreatedAt).toBeInstanceOf(Date);
        expect(Number.isNaN(comment.platformCreatedAt.getTime())).toBe(false);
      }
    });

    it('round-trips the opaque cursor and terminates with a null cursor', async () => {
      const pages = await eachPage();

      // Last page (and only the last) signals end-of-list with a null cursor.
      expect(pages[pages.length - 1].nextCursor).toBeNull();
      for (const page of pages.slice(0, -1)) {
        expect(typeof page.nextCursor).toBe('string');
      }

      // A correct traversal visits each comment exactly once — no gaps, no repeats.
      const ids = pages.flatMap((p) => p.items.map((c) => c.externalCommentId));
      expect(new Set(ids).size).toBe(ids.length);
    });

    it('never exceeds the declared max thread depth within a page', async () => {
      const { maxThreadDepth } = adapter.capabilities;
      const pages = await eachPage();

      // Depth is enforced per page against ancestors present in that page (A-5),
      // which is exactly how the read path measures it — so we assert the same.
      for (const page of pages) {
        const byId = new Map(page.items.map((c) => [c.externalCommentId, c]));
        const parentOf = (c: FetchedComment): FetchedComment | undefined =>
          c.externalParentCommentId === null
            ? undefined
            : byId.get(c.externalParentCommentId);

        for (const comment of page.items) {
          expect(depthOf(comment, parentOf)).toBeLessThanOrEqual(
            maxThreadDepth,
          );
        }
      }
    });

    it('creates a reply whose parent is non-null and echoes the text', async () => {
      const reply = await adapter.replyToComment(
        fixtures.ctx,
        fixtures.replyToCommentId,
        { text: 'contract reply' },
      );

      expect(typeof reply.externalParentCommentId).toBe('string');
      expect(reply.externalParentCommentId.length).toBeGreaterThan(0);
      expect(reply.text).toBe('contract reply');
      expect(reply.externalCommentId).toBeTruthy();
    });

    it('throws a typed PlatformError (not a raw error) for a missing comment', async () => {
      const error = await adapter
        .replyToComment(fixtures.ctx, fixtures.missingCommentId, {
          text: 'to nowhere',
        })
        .then(
          () => {
            throw new Error('expected a rejection for a missing comment');
          },
          (caught: unknown) => caught,
        );

      // The interface's first rule: every failure is a PlatformError subclass,
      // so no vendor error shape can escape the adapter (RK-1, AC-5).
      expect(error).toBeInstanceOf(PlatformError);
      expect(error).toBeInstanceOf(ResourceNotFoundError);
    });
  });
}
