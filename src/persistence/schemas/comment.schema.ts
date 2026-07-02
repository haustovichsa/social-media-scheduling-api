import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

import { Platform } from '../../common/enums/platform.enum';

/**
 * The comment author as reported by the platform. Embedded (no own `_id`) because
 * it has no identity in our system — just a snapshot of what the platform
 * returned at ingest. Stores only public display data, never our credentials.
 */
@Schema({ _id: false })
export class CommentAuthor {
  /** Author id on the platform (stable per platform, not globally unique). */
  @Prop({ required: true })
  externalAuthorId!: string;

  @Prop({ required: true })
  displayName!: string;

  @Prop()
  avatarUrl?: string;
}

export const CommentAuthorSchema = SchemaFactory.createForClass(CommentAuthor);

/**
 * Our local copy of a platform comment. The platform owns the truth; this is a
 * cache we refresh on demand, which lets us page stably and gives replies a
 * stable id to target.
 *
 * Threading: replies are separate documents pointing at their parent via
 * `parentCommentId` (a self-reference), not nested inside it. Nesting would grow
 * unbounded arrays and eventually hit Mongo's 16 MB document limit; referencing
 * keeps every comment a flat, independently pageable row. A top-level comment has
 * `parentCommentId = null`. Each adapter enforces its platform's max nesting
 * depth on ingest.
 */
@Schema({ collection: 'comments', timestamps: true })
export class Comment {
  /** Our local post this comment belongs to (see {@link Post}). */
  @Prop({ required: true, type: Types.ObjectId, ref: 'Post' })
  postId!: Types.ObjectId;

  @Prop({ required: true, enum: Platform })
  platform!: Platform;

  /** The comment id as the platform knows it. */
  @Prop({ required: true })
  externalCommentId!: string;

  /** Parent comment, or `null` for a top-level comment. See threading note above. */
  @Prop({ type: Types.ObjectId, ref: 'Comment', default: null })
  parentCommentId!: Types.ObjectId | null;

  @Prop({ required: true, type: CommentAuthorSchema })
  author!: CommentAuthor;

  @Prop({ required: true })
  text!: string;

  /** When the platform says the comment was created — the sort key for paging. */
  @Prop({ required: true })
  platformCreatedAt!: Date;

  /** When we first pulled this comment into our store. */
  @Prop({ required: true, default: () => new Date() })
  ingestedAt!: Date;

  /** When we last reconciled this row with the platform (surfaced as freshness). */
  @Prop({ required: true, default: () => new Date() })
  syncedAt!: Date;

  /** Tenant scope for ownership checks. */
  @Prop({ required: true, index: true })
  orgId!: string;
}

export type CommentDocument = HydratedDocument<Comment>;
export const CommentSchema = SchemaFactory.createForClass(Comment);

// A comment's identity: the same platform comment maps to exactly one row. This
// is the upsert key adapters use on ingest, so a refresh updates the existing
// row instead of inserting a duplicate.
CommentSchema.index({ platform: 1, externalCommentId: 1 }, { unique: true });

// Primary read path: list a post's comments oldest-first for stable cursor
// paging on `platformCreatedAt`.
CommentSchema.index({ postId: 1, platformCreatedAt: 1 });

// Fetching the replies under a given comment when rendering a thread.
CommentSchema.index({ parentCommentId: 1, platformCreatedAt: 1 });
