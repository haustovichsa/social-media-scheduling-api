import { FetchedComment } from './platform-comment';
import { enforceThreadDepth } from './thread-depth';

/** Terse builder for a comment with just the fields threading cares about. */
function comment(id: string, parentId: string | null): FetchedComment {
  return {
    externalCommentId: id,
    externalParentCommentId: parentId,
    author: { externalAuthorId: 'a', displayName: 'A' },
    text: id,
    platformCreatedAt: new Date('2026-01-01T00:00:00Z'),
  };
}

const parentOf = (result: FetchedComment[], id: string): string | null =>
  result.find((c) => c.externalCommentId === id)!.externalParentCommentId;

describe('enforceThreadDepth', () => {
  it('leaves a tree already within the limit untouched', () => {
    const input = [comment('c1', null), comment('r1', 'c1')];
    const result = enforceThreadDepth(input, 1);
    expect(result).toEqual(input);
  });

  it('re-parents a too-deep reply onto its deepest allowed ancestor (maxDepth 1)', () => {
    // c1 (0) → r1 (1) → r2 (2): with a cap of 1, r2 collapses onto top-level c1.
    const result = enforceThreadDepth(
      [comment('c1', null), comment('r1', 'c1'), comment('r2', 'r1')],
      1,
    );
    expect(parentOf(result, 'r1')).toBe('c1');
    expect(parentOf(result, 'r2')).toBe('c1');
  });

  it('collapses only past the cap, keeping intermediate levels (maxDepth 2)', () => {
    // c1 (0) → r1 (1) → r2 (2) → r3 (3): cap 2 keeps r2, collapses r3 onto r1.
    const result = enforceThreadDepth(
      [
        comment('c1', null),
        comment('r1', 'c1'),
        comment('r2', 'r1'),
        comment('r3', 'r2'),
      ],
      2,
    );
    expect(parentOf(result, 'r2')).toBe('r1');
    expect(parentOf(result, 'r3')).toBe('r1');
  });

  it('treats a comment whose parent is absent (page split) as a root', () => {
    // r1's parent c1 isn't in this batch, so r1 counts as depth 0 and is kept.
    const result = enforceThreadDepth([comment('r1', 'c1')], 1);
    expect(parentOf(result, 'r1')).toBe('c1');
  });

  it('does not loop forever on a cyclic parent chain', () => {
    const result = enforceThreadDepth(
      [comment('a', 'b'), comment('b', 'a')],
      1,
    );
    expect(result).toHaveLength(2);
  });
});
