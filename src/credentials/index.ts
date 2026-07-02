/**
 * Credential handling — the one place tokens are resolved and the one seam where
 * a real secret manager plugs in (NFR-4, RK-6). Adapters depend on the
 * {@link TokenProvider} interface via the {@link TOKEN_PROVIDER} token; they
 * never read secrets directly. The `PlatformAccount` stores only an opaque
 * `tokenRef`, never the token itself — see DESIGN.md §9 for the token caching,
 * rotation, and leak-proof wrapping left as a designed-not-built seam here.
 */
export { CredentialsModule } from './credentials.module';
export {
  EnvTokenProvider,
  TOKEN_PROVIDER,
  TokenProvider,
} from './token-provider';
