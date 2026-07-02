import { Module } from '@nestjs/common';

import { EnvTokenProvider, TOKEN_PROVIDER } from './token-provider';

/**
 * Owns credential handling so every adapter resolves tokens the same way, in one
 * place. Exports only the {@link TOKEN_PROVIDER} token.
 *
 * Database-free: the provider keys on `platformAccountId` directly, so this
 * module (and any that imports it) can be unit-tested without a Mongo connection.
 * Swap {@link EnvTokenProvider} for a real secret-manager-backed provider here and
 * nothing upstream changes.
 */
@Module({
  providers: [{ provide: TOKEN_PROVIDER, useClass: EnvTokenProvider }],
  exports: [TOKEN_PROVIDER],
})
export class CredentialsModule {}
