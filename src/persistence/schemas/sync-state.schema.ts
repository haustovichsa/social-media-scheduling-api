import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * Per-post bookmark for the background/on-demand refresh (A-4). It records how
 * far we got paging the platform's comment list so the next sync resumes from
 * the platform's own cursor instead of re-reading from the top, and it holds
 * `lastSyncedAt` so the read service can decide whether the local copy is stale.
 *
 * One document per post (see the unique index below).
 *
 * Unlike the other domain collections, this carries no `orgId`: sync state is
 * infrastructure, not tenant data, and is scoped transitively through its
 * `postId` (see {@link Post}.orgId). Ownership is always resolved via the post,
 * so duplicating the tenant here would only risk it drifting out of sync.
 */
@Schema({ collection: 'sync_states', timestamps: true })
export class SyncState {
  @Prop({ required: true, type: Types.ObjectId, ref: 'Post' })
  postId!: Types.ObjectId;

  /**
   * The platform's opaque pagination cursor for the next page of comments, or
   * `null` when we have caught up to the end of the list.
   */
  @Prop({ type: String, default: null })
  cursor!: string | null;

  @Prop({ required: true, default: () => new Date() })
  lastSyncedAt!: Date;
}

export type SyncStateDocument = HydratedDocument<SyncState>;
export const SyncStateSchema = SchemaFactory.createForClass(SyncState);

// Exactly one sync bookmark per post.
SyncStateSchema.index({ postId: 1 }, { unique: true });
