import { Module } from '@nestjs/common';

import { AuthGuard } from './auth.guard';
import { CALLER_RESOLVER } from './caller-resolver';
import { EnvCallerResolver } from './env-caller-resolver';

/**
 * Owns request authentication. Binds the {@link CallerResolver} seam to the
 * env-backed dev stub and exposes the {@link AuthGuard} that feature modules put
 * in front of routes with `@UseGuards`. Swap {@link EnvCallerResolver} for a real
 * authenticator here and nothing upstream changes.
 *
 * Database-free (like {@link CredentialsModule}) so any module that guards its
 * routes can be unit-tested without a Mongo connection.
 */
@Module({
  providers: [
    { provide: CALLER_RESOLVER, useClass: EnvCallerResolver },
    AuthGuard,
  ],
  // Export CALLER_RESOLVER alongside AuthGuard: `@UseGuards(AuthGuard)`
  // instantiates the guard in the host controller's module (e.g. CommentsModule),
  // so the guard's dependency must be resolvable from there too.
  exports: [AuthGuard, CALLER_RESOLVER],
})
export class AuthModule {}
