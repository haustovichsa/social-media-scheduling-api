import { getModelToken, MongooseModule } from '@nestjs/mongoose';
import { Test, TestingModule } from '@nestjs/testing';
import { MongoMemoryServer } from 'mongodb-memory-server';
import { Model, Types } from 'mongoose';

import { Platform } from '../common/enums/platform.enum';
import { PersistenceModule } from './persistence.module';
import { Comment } from './schemas/comment.schema';

/**
 * Verifies the two guarantees the data model exists to provide (TASK-02 DoD):
 * comment identity/uniqueness and self-referential threading. Runs against a
 * real (in-memory) Mongo so the indexes are actually built and enforced, not
 * just declared.
 */
describe('PersistenceModule (in-memory Mongo)', () => {
  let mongo: MongoMemoryServer;
  let moduleRef: TestingModule;
  let commentModel: Model<Comment>;

  beforeAll(async () => {
    mongo = await MongoMemoryServer.create();

    moduleRef = await Test.createTestingModule({
      imports: [MongooseModule.forRoot(mongo.getUri()), PersistenceModule],
    }).compile();

    commentModel = moduleRef.get<Model<Comment>>(getModelToken(Comment.name));

    // Force declared indexes to be built before we assert on uniqueness.
    await commentModel.syncIndexes();
  }, 60_000);

  afterAll(async () => {
    await moduleRef?.close();
    await mongo?.stop();
  });

  const baseComment = (overrides: Partial<Comment> = {}) => ({
    postId: new Types.ObjectId(),
    platform: Platform.Facebook,
    externalCommentId: 'ext-1',
    author: { externalAuthorId: 'a1', displayName: 'Ada' },
    text: 'hello',
    platformCreatedAt: new Date(),
    orgId: 'org-1',
    ...overrides,
  });

  it('rejects a duplicate (platform, externalCommentId)', async () => {
    await commentModel.create(baseComment({ externalCommentId: 'dup' }));

    await expect(
      commentModel.create(
        baseComment({ externalCommentId: 'dup', text: 'second' }),
      ),
    ).rejects.toMatchObject({ code: 11000 });
  });

  it('allows the same externalCommentId on a different platform', async () => {
    await commentModel.create(
      baseComment({ platform: Platform.Facebook, externalCommentId: 'shared' }),
    );

    await expect(
      commentModel.create(
        baseComment({
          platform: Platform.Instagram,
          externalCommentId: 'shared',
        }),
      ),
    ).resolves.toBeDefined();
  });

  it('threads a reply to its parent via parentCommentId', async () => {
    const parent = await commentModel.create(
      baseComment({ externalCommentId: 'parent' }),
    );
    const child = await commentModel.create(
      baseComment({
        externalCommentId: 'child',
        parentCommentId: parent._id,
      }),
    );

    expect(child.parentCommentId?.toString()).toBe(parent._id.toString());

    const populated = await commentModel
      .findById(child._id)
      .populate<{ parentCommentId: Comment }>('parentCommentId');
    expect(populated?.parentCommentId).toMatchObject({
      externalCommentId: 'parent',
    });
  });

  it('defaults a top-level comment to a null parent', async () => {
    const top = await commentModel.create(
      baseComment({ externalCommentId: 'top' }),
    );
    expect(top.parentCommentId).toBeNull();
  });
});
