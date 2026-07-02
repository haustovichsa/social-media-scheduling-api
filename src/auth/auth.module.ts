import { Module } from '@nestjs/common';

import { AuthGuard } from './auth.guard';
import { CALLER_RESOLVER } from './caller-resolver';
import { EnvCallerResolver } from './env-caller-resolver';

/**
 * Owns request authentication (NFR-4, AC-4). Binds the {@link CallerResolver}
 * seam to the env-backed dev stub and exposes the {@link AuthGuard} that feature
 * modules put in front of their routes with `@UseGuards`. Swap
 * {@link EnvCallerResolver} for a real authenticator here and nothing upstream
 * changes.
 *
 * Deliberately database-free — like {@link CredentialsModule} — so any module
 * that guards its routes can be unit-tested without a Mongo connection.
 */
@Module({
  providers: [
    { provide: CALLER_RESOLVER, useClass: EnvCallerResolver },
    AuthGuard,
  ],
  exports: [AuthGuard],
})
export class AuthModule {}
