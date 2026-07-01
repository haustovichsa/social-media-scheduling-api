import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { HydratedDocument } from 'mongoose';

import { Platform } from '../../common/enums/platform.enum';

/**
 * A connected social account belonging to one org. This is the unit that owns
 * OAuth credentials on a platform. We never store the token itself here — only
 * `tokenRef`, an opaque handle the {@link TokenProvider} (TASK-06) resolves to a
 * live secret out of a secret store, so tokens never land in Mongo, logs, or
 * API responses (RK-6).
 */
@Schema({ collection: 'platform_accounts', timestamps: true })
export class PlatformAccount {
  // No standalone index: platform-only lookups are served by the leftmost
  // prefix of the { platform, externalAccountId } compound index below.
  @Prop({ required: true, enum: Platform })
  platform!: Platform;

  /** The account id as the platform knows it (e.g. a Facebook Page id). */
  @Prop({ required: true })
  externalAccountId!: string;

  /** Tenant that owns this account; every read/write is scoped by it (A-6). */
  @Prop({ required: true, index: true })
  orgId!: string;

  /** Opaque pointer into the secret store — resolved lazily, never the token. */
  @Prop({ required: true })
  tokenRef!: string;
}

export type PlatformAccountDocument = HydratedDocument<PlatformAccount>;
export const PlatformAccountSchema =
  SchemaFactory.createForClass(PlatformAccount);

// One connected account per (platform, external id): prevents duplicate links.
PlatformAccountSchema.index(
  { platform: 1, externalAccountId: 1 },
  { unique: true },
);
