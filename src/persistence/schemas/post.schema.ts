import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { Platform } from '../../common/enums/platform.enum';

/**
 * Lifecycle of a post in the scheduling system. The comment feature only ever
 * operates on posts that are already `published` — that is the precondition for
 * reading comments and replying (FR-1/FR-2, A-2).
 */
export enum PostStatus {
  Draft = 'draft',
  Scheduled = 'scheduled',
  Published = 'published',
}

/**
 * A post the scheduler has (or will have) published to a platform. We keep a
 * local record so comments can point at it by our own `_id` while still
 * carrying the `externalPostId` the adapter needs to call the platform API.
 */
@Schema({ collection: 'posts', timestamps: true })
export class Post {
  /** Owning connected account (see {@link PlatformAccount}). */
  @Prop({ required: true, type: Types.ObjectId, ref: 'PlatformAccount' })
  platformAccountId!: Types.ObjectId;

  /** Denormalised from the account so adapter routing needs no extra lookup. */
  @Prop({ required: true, enum: Platform })
  platform!: Platform;

  /** The post id as the platform knows it — the key for all adapter calls. */
  @Prop({ required: true })
  externalPostId!: string;

  @Prop({ required: true, enum: PostStatus, default: PostStatus.Draft })
  status!: PostStatus;

  /** Tenant scope for ownership checks (A-6). */
  @Prop({ required: true, index: true })
  orgId!: string;
}

export type PostDocument = HydratedDocument<Post>;
export const PostSchema = SchemaFactory.createForClass(Post);

// A published post maps to exactly one external post per platform; this both
// enforces that and speeds up the lookup adapters do before fetching comments.
PostSchema.index({ platform: 1, externalPostId: 1 }, { unique: true });
