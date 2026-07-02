import { Module } from '@nestjs/common';

import { EnvSecretStore, SECRET_STORE } from './secret-store';
import { StubTokenProvider } from './stub-token-provider';
import { TOKEN_PROVIDER } from './token-provider';

/**
 * Owns credential handling so every adapter resolves tokens the same way and in
 * one place (NFR-4, RK-6). Exports only the {@link TOKEN_PROVIDER} token — the
 * secret store is an internal implementation detail nothing outside should reach.
 *
 * Deliberately free of any database dependency: the {@link SecretStore} keys on
 * `platformAccountId` directly, so this module (and any module that imports it)
 * can be unit-tested without a Mongo connection. Swap {@link EnvSecretStore} or
 * {@link StubTokenProvider} for real implementations here and nothing upstream
 * changes.
 */
@Module({
  providers: [
    { provide: SECRET_STORE, useClass: EnvSecretStore },
    { provide: TOKEN_PROVIDER, useClass: StubTokenProvider },
  ],
  exports: [TOKEN_PROVIDER],
})
export class CredentialsModule {}
