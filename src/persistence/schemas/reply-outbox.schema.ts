import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument, Types } from 'mongoose';

/**
 * Lifecycle of a reply we are trying to send to a platform.
 * `pending` → we intend to send · `sent` → the platform accepted it and gave us
 * an id · `failed` → the platform rejected it (terminal for that attempt).
 */
export enum ReplyStatus {
  Pending = 'pending',
  Sent = 'sent',
  Failed = 'failed',
}

/**
 * Write-side guard that makes replying safe to retry (RK-4). Before calling the
 * platform, the reply service claims a row keyed by the caller's
 * `idempotencyKey`; the unique index means a retry with the same key can never
 * create a second send, so a reply is posted to the platform at most once even
 * if the client (or a network retry) fires the request twice.
 *
 * This is the "outbox" the reply flow (TASK-08) checks first and updates with
 * the platform's `externalReplyId` once the send succeeds.
 */
@Schema({ collection: 'reply_outbox', timestamps: true })
export class ReplyOutbox {
  /** Caller-supplied idempotency key — the dedupe key for the whole send. */
  @Prop({ required: true })
  idempotencyKey!: string;

  /** The comment being replied to (our local {@link Comment} id). */
  @Prop({ required: true, type: Types.ObjectId, ref: 'Comment' })
  commentId!: Types.ObjectId;

  @Prop({ required: true, enum: ReplyStatus, default: ReplyStatus.Pending })
  status!: ReplyStatus;

  /** Set once the platform accepts the reply; the id it assigned. */
  @Prop({ type: String, default: null })
  externalReplyId!: string | null;

  /** Tenant scope for ownership checks (A-6). */
  @Prop({ required: true, index: true })
  orgId!: string;
}

export type ReplyOutboxDocument = HydratedDocument<ReplyOutbox>;
export const ReplyOutboxSchema = SchemaFactory.createForClass(ReplyOutbox);

// The idempotency guarantee: one send per key (RK-4).
ReplyOutboxSchema.index({ idempotencyKey: 1 }, { unique: true });
