/**
 * Credential handling — the one place tokens are resolved and the one seam where
 * a real secret manager plugs in. Adapters depend on the {@link TokenProvider}
 * interface via the {@link TOKEN_PROVIDER} token; they never read secrets
 * directly. `PlatformAccount` stores only an opaque `tokenRef`, never the token.
 * Token caching, rotation, and leak-proof wrapping are designed but not built
 * here (see DESIGN.md).
 */
export { CredentialsModule } from './credentials.module';
export {
  EnvTokenProvider,
  TOKEN_PROVIDER,
  TokenProvider,
} from './token-provider';
