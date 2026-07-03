import mongoose from 'mongoose';
import { Platform } from '../src/common/enums/platform.enum';

const MONGODB_URI =
  process.env.MONGODB_URI ||
  'mongodb://localhost:27017/social-media-scheduling';
const ORG_ID = 'org-1';

async function seed() {
  try {
    await mongoose.connect(MONGODB_URI);
    console.log('✓ Connected to MongoDB');

    const db = mongoose.connection.db;
    if (!db) throw new Error('Database connection failed');

    // Clear existing collections
    await db.collection('platform_accounts').deleteMany({});
    await db.collection('posts').deleteMany({});
    await db.collection('comments').deleteMany({});
    console.log('✓ Cleared existing data');

    // Create a platform account (Mock)
    const accountResult = await db.collection('platform_accounts').insertOne({
      platform: Platform.Mock,
      externalAccountId: 'mock-account',
      orgId: ORG_ID,
      tokenRef: 'mock-token-ref', // Mock adapter doesn't use tokens
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const accountId = accountResult.insertedId.toString();
    console.log(`✓ Created platform account: ${accountId}`);

    // Create a published post
    const postResult = await db.collection('posts').insertOne({
      platformAccountId: accountId,
      platform: Platform.Mock,
      externalPostId: 'post-1',
      status: 'published',
      orgId: ORG_ID,
      createdAt: new Date(),
      updatedAt: new Date(),
    });
    const postId = postResult.insertedId.toString();
    console.log(`✓ Created post: ${postId}`);

    // Create seeded comments (matching MockAdapter seeds)
    const SEED_EPOCH = Date.UTC(2026, 0, 1, 0, 0, 0);
    const now = new Date();

    const ada = { externalAuthorId: 'ada', displayName: 'Ada' };
    const linus = { externalAuthorId: 'linus', displayName: 'Linus' };
    const grace = {
      externalAuthorId: 'grace',
      displayName: 'Grace',
      avatarUrl: 'https://example.test/grace.png',
    };
    const edsger = { externalAuthorId: 'edsger', displayName: 'Edsger' };

    const commentDocs = [
      {
        postId,
        platform: Platform.Mock,
        externalCommentId: 'm-c1',
        parentCommentId: null,
        author: ada,
        text: 'First!',
        platformCreatedAt: new Date(SEED_EPOCH + 0 * 60_000),
        ingestedAt: now,
        syncedAt: now,
        orgId: ORG_ID,
      },
      {
        postId,
        platform: Platform.Mock,
        externalCommentId: 'm-c2',
        parentCommentId: null,
        author: linus,
        text: 'Nice post',
        platformCreatedAt: new Date(SEED_EPOCH + 1 * 60_000),
        ingestedAt: now,
        syncedAt: now,
        orgId: ORG_ID,
      },
      {
        postId,
        platform: Platform.Mock,
        externalCommentId: 'm-r1',
        // Will be set after m-c1 is inserted
        parentCommentId: null,
        author: grace,
        text: 'Agreed',
        platformCreatedAt: new Date(SEED_EPOCH + 2 * 60_000),
        ingestedAt: now,
        syncedAt: now,
        orgId: ORG_ID,
      },
      {
        postId,
        platform: Platform.Mock,
        externalCommentId: 'm-r2',
        // Will be set after m-r1 is inserted
        parentCommentId: null,
        author: ada,
        text: 'Thanks, Grace',
        platformCreatedAt: new Date(SEED_EPOCH + 3 * 60_000),
        ingestedAt: now,
        syncedAt: now,
        orgId: ORG_ID,
      },
      {
        postId,
        platform: Platform.Mock,
        externalCommentId: 'm-c3',
        parentCommentId: null,
        author: edsger,
        text: 'Interesting',
        platformCreatedAt: new Date(SEED_EPOCH + 4 * 60_000),
        ingestedAt: now,
        syncedAt: now,
        orgId: ORG_ID,
      },
    ];

    // Insert comments and track their IDs for threading
    const commentIdMap = new Map<string, mongoose.Types.ObjectId>();
    for (const doc of commentDocs) {
      const result = await db.collection('comments').insertOne(doc);
      commentIdMap.set(doc.externalCommentId, result.insertedId);
    }
    console.log(`✓ Created ${commentDocs.length} comments`);

    // Update replies with correct parent references
    await db
      .collection('comments')
      .updateOne(
        { externalCommentId: 'm-r1' },
        { $set: { parentCommentId: commentIdMap.get('m-c1') } },
      );
    await db
      .collection('comments')
      .updateOne(
        { externalCommentId: 'm-r2' },
        { $set: { parentCommentId: commentIdMap.get('m-r1') } },
      );
    console.log('✓ Linked replies to parent comments');

    console.log('\n✓ Seed complete! You can now test the API:');
    console.log('\n  curl -H "Authorization: Bearer devkey-org1" \\');
    console.log(`    "http://localhost:3000/posts/${postId}/comments"`);
    console.log(`\n  Or in Swagger: use this postId value: ${postId}`);

    await mongoose.disconnect();
  } catch (error) {
    console.error('✗ Seed failed:', error);
    process.exit(1);
  }
}

seed();
