import { Module } from '@nestjs/common';

import { EnvTokenProvider, TOKEN_PROVIDER } from './token-provider';

/**
 * Owns credential handling so every adapter resolves tokens the same way and in
 * one place (NFR-4, RK-6). Exports only the {@link TOKEN_PROVIDER} token.
 *
 * Deliberately free of any database dependency: the provider keys on
 * `platformAccountId` directly, so this module (and any module that imports it)
 * can be unit-tested without a Mongo connection. Swap {@link EnvTokenProvider}
 * for a real secret-manager-backed provider here and nothing upstream changes.
 */
@Module({
  providers: [{ provide: TOKEN_PROVIDER, useClass: EnvTokenProvider }],
  exports: [TOKEN_PROVIDER],
})
export class CredentialsModule {}
