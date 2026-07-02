import { Injectable } from '@nestjs/common';

import { Platform } from '../../../common/enums/platform.enum';
import { Page, PageCursor } from '../../../domain';
import { decodeCursor, encodeCursor } from '../../cursor';
import {
  AdapterContext,
  PlatformAdapter,
  PlatformCapabilities,
} from '../../platform-adapter.interface';
import {
  FetchedAuthor,
  FetchedComment,
  FetchedReply,
  ReplyInput,
} from '../../platform-comment';
import { ResourceNotFoundError } from '../../platform-errors';
import { ancestorAtDepth, enforceThreadDepth } from '../../thread-depth';

/** How the mock cursor encodes its position: a simple offset into the list. */
interface MockCursor {
  readonly offset: number;
}

/** One stored comment. `FetchedComment` plus the post it belongs to. */
interface MockComment extends FetchedComment {
  readonly externalPostId: string;
}

/** Small on purpose so tests hit paging. */
const MOCK_PAGE_SIZE = 2;

/** Start point for seed timestamps: one comment per minute from here. */
const SEED_EPOCH = Date.UTC(2026, 0, 1, 0, 0, 0);

/** The account this adapter posts replies as. */
const MOCK_SELF: FetchedAuthor = {
  externalAuthorId: 'mock-self',
  displayName: 'Mock Account',
};

function seedComment(
  index: number,
  externalCommentId: string,
  externalPostId: string,
  externalParentCommentId: string | null,
  author: FetchedAuthor,
  text: string,
): MockComment {
  return {
    externalCommentId,
    externalPostId,
    externalParentCommentId,
    author,
    text,
    platformCreatedAt: new Date(SEED_EPOCH + index * 60_000),
  };
}

/**
 * In-memory {@link PlatformAdapter} for tests and local demos. No network,
 * tokens, or config, so it's the default way to run the whole read/reply flow.
 * A fresh instance always starts from the same seed, so tests are repeatable.
 *
 * The `post-1` seed covers the tricky cases: several top-level comments, a
 * nested reply, and a reply-to-a-reply (depth 2). Posting a reply mutates the
 * store, so a demo can read its own reply back on the next page.
 */
@Injectable()
export class MockAdapter implements PlatformAdapter {
  readonly platform = Platform.Mock;
  readonly capabilities: PlatformCapabilities = {
    maxThreadDepth: 2,
    supportsWebhooks: false,
  };

  /** Oldest-first, like a platform streams comment history. */
  private readonly comments: MockComment[];
  private replyCounter = 0;

  constructor() {
    const post = 'post-1';
    const ada: FetchedAuthor = { externalAuthorId: 'ada', displayName: 'Ada' };
    const linus: FetchedAuthor = {
      externalAuthorId: 'linus',
      displayName: 'Linus',
    };
    const grace: FetchedAuthor = {
      externalAuthorId: 'grace',
      displayName: 'Grace',
      avatarUrl: 'https://example.test/grace.png',
    };
    const edsger: FetchedAuthor = {
      externalAuthorId: 'edsger',
      displayName: 'Edsger',
    };

    this.comments = [
      seedComment(0, 'm-c1', post, null, ada, 'First!'),
      seedComment(1, 'm-c2', post, null, linus, 'Nice post'),
      seedComment(2, 'm-r1', post, 'm-c1', grace, 'Agreed'),
      seedComment(3, 'm-r2', post, 'm-r1', ada, 'Thanks, Grace'),
      seedComment(4, 'm-c3', post, null, edsger, 'Interesting'),
    ];
  }

  // The store is in-memory, so there's no real async work. Methods return
  // resolved/rejected promises to honor the async contract (a failure is a
  // rejection, never a synchronous throw). `_ctx` is ignored: the mock needs
  // no token.
  getComments(
    _ctx: AdapterContext,
    externalPostId: string,
    cursor?: PageCursor,
  ): Promise<Page<FetchedComment>> {
    const offset = cursor ? decodeCursor<MockCursor>(cursor).offset : 0;

    const forPost = this.comments.filter(
      (c) => c.externalPostId === externalPostId,
    );
    const slice = forPost.slice(offset, offset + MOCK_PAGE_SIZE);
    const nextOffset = offset + slice.length;

    const items = enforceThreadDepth(
      slice.map(toFetchedComment),
      this.capabilities.maxThreadDepth,
    );

    return Promise.resolve({
      items,
      nextCursor:
        nextOffset < forPost.length
          ? encodeCursor({ offset: nextOffset })
          : null,
    });
  }

  replyToComment(
    _ctx: AdapterContext,
    externalCommentId: string,
    body: ReplyInput,
  ): Promise<FetchedReply> {
    const parent = this.findById(externalCommentId);
    if (!parent) {
      return Promise.reject(
        new ResourceNotFoundError(this.platform, externalCommentId),
      );
    }

    // Mirror platform flattening: a reply sits one level below its parent. If
    // that would exceed the cap, attach it to the deepest allowed ancestor
    // instead — the same rule the read path applies via enforceThreadDepth.
    const parentId = ancestorAtDepth(
      parent,
      this.capabilities.maxThreadDepth - 1,
      (c) => this.parentOf(c),
    ).externalCommentId;

    this.replyCounter += 1;
    const reply: MockComment = {
      externalCommentId: `m-reply-${this.replyCounter}`,
      externalPostId: parent.externalPostId,
      externalParentCommentId: parentId,
      author: MOCK_SELF,
      text: body.text,
      platformCreatedAt: new Date(
        SEED_EPOCH + (100 + this.replyCounter) * 60_000,
      ),
    };
    this.comments.push(reply);

    return Promise.resolve({
      ...toFetchedComment(reply),
      externalParentCommentId: parentId,
    });
  }

  private findById(externalCommentId: string): MockComment | undefined {
    return this.comments.find((c) => c.externalCommentId === externalCommentId);
  }

  /** Find a comment's parent in the store, used by the depth walk. */
  private parentOf(comment: MockComment): MockComment | undefined {
    return comment.externalParentCommentId === null
      ? undefined
      : this.findById(comment.externalParentCommentId);
  }
}

/** Drop the storage-only `externalPostId` to get the wire shape. */
function toFetchedComment(comment: MockComment): FetchedComment {
  return {
    externalCommentId: comment.externalCommentId,
    externalParentCommentId: comment.externalParentCommentId,
    author: comment.author,
    text: comment.text,
    platformCreatedAt: comment.platformCreatedAt,
  };
}
