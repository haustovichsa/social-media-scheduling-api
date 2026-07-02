import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model, Types } from 'mongoose';

import { Platform } from '../common/enums/platform.enum';
import { PersistenceModule } from '../persistence/persistence.module';
import { Comment as CommentEntity } from '../persistence/schemas/comment.schema';
import {
  Post,
  PostDocument,
  PostStatus,
} from '../persistence/schemas/post.schema';
import { FetchedComment, FetchedReply } from '../platforms';
import { CommentRepository, ReplyTarget } from './comment.repository';

/**
 * Integration tests for storage the service can't exercise with a mock:
 * identity-keyed upserts, external→internal parent resolution, and keyset paging.
 * Runs against a real in-memory Mongo so indexes and the sort order are actually
 * enforced, not just declared.
 */
describe('CommentRepository (in-memory Mongo)', () => {
  let mongo: MongoMemoryServer;
  let moduleRef: TestingModule;
  let repository: CommentRepository;
  let commentModel: Model<CommentEntity>;
  let postModel: Model<Post>;

  const ORG = 'org-1';
  const EPOCH = Date.UTC(2026, 0, 1);

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();
    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(mongo.getUri()), PersistenceModule],
      providers: [CommentRepository],
    }).compile();

    repository = moduleRef.get(CommentRepository);
    commentModel = moduleRef.get(getModelToken(CommentEntity.name));
    postModel = moduleRef.get(getModelToken(Post.name));
    await commentModel.syncIndexes();
  }, 60_000);

  afterAll(async () => {
    await moduleRef?.close();
    await mongo?.stop();
  });

  afterEach(async () => {
    await Promise.all([commentModel.deleteMany({}), postModel.deleteMany({})]);
  });

  const createPost = (overrides: Partial<Post> = {}): Promise<PostDocument> =>
    postModel.create({
      platformAccountId: new Types.ObjectId(),
      platform: Platform.Mock,
      externalPostId: 'ext-post-1',
      status: PostStatus.Published,
      orgId: ORG,
      ...overrides,
    });

  const fetched = (
    externalCommentId: string,
    minute: number,
    externalParentCommentId: string | null = null,
  ): FetchedComment => ({
    externalCommentId,
    externalParentCommentId,
    author: { externalAuthorId: 'ada', displayName: 'Ada' },
    text: `text-${externalCommentId}`,
    platformCreatedAt: new Date(EPOCH + minute * 60_000),
  });

  describe('findPublishedPost', () => {
    it('finds a published post owned by the org', async () => {
      const post = await createPost();
      const found = await repository.findPublishedPost(
        post._id.toString(),
        ORG,
      );
      expect(found?._id.toString()).toBe(post._id.toString());
    });

    it('returns null for another org, a non-published post, or a bad id', async () => {
      const post = await createPost();
      const draft = await createPost({
        status: PostStatus.Draft,
        externalPostId: 'ext-draft',
      });

      expect(
        await repository.findPublishedPost(post._id.toString(), 'other-org'),
      ).toBeNull();
      expect(
        await repository.findPublishedPost(draft._id.toString(), ORG),
      ).toBeNull();
      expect(
        await repository.findPublishedPost('not-an-objectid', ORG),
      ).toBeNull();
    });
  });

  describe('upsertFetched', () => {
    it('is idempotent on { platform, externalCommentId } (refresh updates, not duplicates)', async () => {
      const post = await createPost();

      await repository.upsertFetched(post, [fetched('c1', 0)], new Date());
      await repository.upsertFetched(
        post,
        [{ ...fetched('c1', 0), text: 'edited' }],
        new Date(),
      );

      const rows = await commentModel.find({ externalCommentId: 'c1' });
      expect(rows).toHaveLength(1);
      expect(rows[0].text).toBe('edited');
    });

    it('threads a reply to a parent in the same batch', async () => {
      const post = await createPost();
      await repository.upsertFetched(
        post,
        [fetched('parent', 0), fetched('child', 1, 'parent')],
        new Date(),
      );

      const parent = await commentModel.findOne({
        externalCommentId: 'parent',
      });
      const child = await commentModel.findOne({ externalCommentId: 'child' });
      expect(child?.parentCommentId?.toString()).toBe(parent?._id.toString());
    });

    it('threads a reply to a parent ingested on an earlier page', async () => {
      const post = await createPost();
      await repository.upsertFetched(post, [fetched('parent', 0)], new Date());
      await repository.upsertFetched(
        post,
        [fetched('child', 1, 'parent')],
        new Date(),
      );

      const parent = await commentModel.findOne({
        externalCommentId: 'parent',
      });
      const child = await commentModel.findOne({ externalCommentId: 'child' });
      expect(child?.parentCommentId?.toString()).toBe(parent?._id.toString());
    });

    it('re-threads a reply whose parent arrives on a later refresh', async () => {
      const post = await createPost();
      // Parent not seen yet -> child lands top-level.
      await repository.upsertFetched(
        post,
        [fetched('child', 1, 'ghost')],
        new Date(),
      );
      let child = await commentModel.findOne({ externalCommentId: 'child' });
      expect(child?.parentCommentId).toBeNull();

      // Parent shows up, child re-upserted -> now threaded.
      await repository.upsertFetched(
        post,
        [fetched('ghost', 0), fetched('child', 1, 'ghost')],
        new Date(),
      );
      const parent = await commentModel.findOne({ externalCommentId: 'ghost' });
      child = await commentModel.findOne({ externalCommentId: 'child' });
      expect(child?.parentCommentId?.toString()).toBe(parent?._id.toString());
    });
  });

  describe('pageComments', () => {
    it('pages oldest-first end-to-end without gaps or repeats', async () => {
      const post = await createPost();
      await repository.upsertFetched(
        post,
        [0, 1, 2, 3, 4].map((m) => fetched(`c${m}`, m)),
        new Date(),
      );

      const seen: string[] = [];
      let cursor: string | undefined;
      // Small pages so the walk crosses several boundaries.
      for (let guard = 0; guard < 10; guard++) {
        const page = await repository.pageComments(post._id, cursor, 2);
        seen.push(...page.items.map((c) => c.text));
        if (page.nextCursor === null) break;
        cursor = page.nextCursor;
      }

      expect(seen).toEqual([
        'text-c0',
        'text-c1',
        'text-c2',
        'text-c3',
        'text-c4',
      ]);
    });

    it('breaks ties on _id so equal timestamps never straddle a page', async () => {
      const post = await createPost();
      // Three comments share the exact same platformCreatedAt.
      await repository.upsertFetched(
        post,
        [fetched('a', 0), fetched('b', 0), fetched('c', 0)],
        new Date(),
      );

      const first = await repository.pageComments(post._id, undefined, 2);
      expect(first.items).toHaveLength(2);
      expect(first.nextCursor).not.toBeNull();

      const second = await repository.pageComments(
        post._id,
        first.nextCursor!,
        2,
      );
      const ids = [...first.items, ...second.items].map((c) => c.id);
      expect(new Set(ids).size).toBe(3);
      expect(second.nextCursor).toBeNull();
    });

    it('maps documents to the canonical domain shape', async () => {
      const post = await createPost();
      await repository.upsertFetched(post, [fetched('c1', 0)], new Date());

      const page = await repository.pageComments(post._id, undefined, 25);
      const [comment] = page.items;
      expect(comment).toMatchObject({
        postId: post._id.toString(),
        platform: Platform.Mock,
        parentCommentId: null,
        author: { id: 'ada', displayName: 'Ada' },
        text: 'text-c1',
      });
      expect(comment.createdAt).toBeInstanceOf(Date);
      expect(comment.syncedAt).toBeInstanceOf(Date);
    });
  });

  describe('reply flow', () => {
    // Seed one stored comment on a published post and return the reply target —
    // the parent everything below threads under.
    const seedTarget = async (): Promise<ReplyTarget> => {
      const post = await createPost();
      await repository.upsertFetched(post, [fetched('parent', 0)], new Date());
      const comment = await commentModel.findOne({
        externalCommentId: 'parent',
      });
      return { comment: comment!, post };
    };

    const fetchedReply = (
      externalCommentId: string,
      parentExternalId: string,
    ): FetchedReply => ({
      externalCommentId,
      externalParentCommentId: parentExternalId,
      author: { externalAuthorId: 'me', displayName: 'Me' },
      text: `reply-${externalCommentId}`,
      platformCreatedAt: new Date(EPOCH + 60_000),
    });

    describe('findReplyTarget', () => {
      it('resolves the owned comment together with its published post', async () => {
        const { comment, post } = await seedTarget();

        const found = await repository.findReplyTarget(
          comment._id.toString(),
          ORG,
        );
        expect(found?.comment._id.toString()).toBe(comment._id.toString());
        expect(found?.post._id.toString()).toBe(post._id.toString());
      });

      it('returns null for another org, an unpublished post, or a bad id', async () => {
        const { comment, post } = await seedTarget();

        expect(
          await repository.findReplyTarget(comment._id.toString(), 'other-org'),
        ).toBeNull();
        expect(
          await repository.findReplyTarget('not-an-objectid', ORG),
        ).toBeNull();

        await postModel.updateOne(
          { _id: post._id },
          { $set: { status: PostStatus.Draft } },
        );
        expect(
          await repository.findReplyTarget(comment._id.toString(), ORG),
        ).toBeNull();
      });
    });

    describe('saveReply', () => {
      it('persists the reply as a first-class comment threaded under its parent', async () => {
        const { comment, post } = await seedTarget();

        const reply = await repository.saveReply(
          { comment, post },
          fetchedReply('r1', 'parent'),
          new Date(),
        );

        expect(reply.parentCommentId).toBe(comment._id.toString());
        expect(reply.text).toBe('reply-r1');

        // The reply is a first-class comment row in the same collection.
        const stored = await commentModel.findOne({ externalCommentId: 'r1' });
        expect(stored?.parentCommentId?.toString()).toBe(
          comment._id.toString(),
        );
      });

      it('is idempotent on { platform, externalCommentId } if the row already exists', async () => {
        const { comment, post } = await seedTarget();
        await repository.saveReply(
          { comment, post },
          fetchedReply('r1', 'parent'),
          new Date(),
        );

        // Same external reply id (e.g. a later refresh already ingested it).
        await repository.saveReply(
          { comment, post },
          { ...fetchedReply('r1', 'parent'), text: 'edited' },
          new Date(),
        );

        const rows = await commentModel.find({ externalCommentId: 'r1' });
        expect(rows).toHaveLength(1);
        expect(rows[0].text).toBe('edited');
      });
    });
  });
});
