/**
 * The auth feature's public surface (NFR-4, AC-4). Feature modules import
 * {@link AuthModule} and guard routes with {@link AuthGuard}; the resolver seam
 * is exposed for tests and for swapping in a real authenticator.
 */
export { AuthModule } from './auth.module';
export { AuthGuard } from './auth.guard';
export { Caller, CallerResolver, CALLER_RESOLVER } from './caller-resolver';
// The env-backed resolver stub is an internal detail bound behind
// CALLER_RESOLVER — not exported, matching CredentialsModule's stubs.
