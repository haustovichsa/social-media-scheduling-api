import { Module } from '@nestjs/common';
import { MongooseModule } from '@nestjs/mongoose';

import { Comment, CommentSchema } from './schemas/comment.schema';
import {
  PlatformAccount,
  PlatformAccountSchema,
} from './schemas/platform-account.schema';
import { Post, PostSchema } from './schemas/post.schema';

/**
 * Registers every collection's model with Mongoose and re-exports
 * `MongooseModule` so feature modules can inject the models they need via
 * `@InjectModel(...)` without re-declaring the schema definitions. The model
 * names match the schema class names (and the `ref` strings used across
 * schemas), so `ref` population resolves without extra configuration.
 */
const models = MongooseModule.forFeature([
  { name: PlatformAccount.name, schema: PlatformAccountSchema },
  { name: Post.name, schema: PostSchema },
  { name: Comment.name, schema: CommentSchema },
]);

@Module({
  imports: [models],
  exports: [models],
})
export class PersistenceModule {}
