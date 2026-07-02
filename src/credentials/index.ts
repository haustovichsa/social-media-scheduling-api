/**
 * Credential handling — the one place tokens are resolved and the one place a
 * real secret manager plugs in (TASK-06, NFR-4, RK-6). Adapters depend on the
 * {@link TokenProvider} interface via the {@link TOKEN_PROVIDER} token; they
 * never read secrets directly. {@link AccessToken} keeps the raw value from ever
 * reaching a log or a response.
 */
export { AccessToken, REDACTED } from './access-token';
export { CredentialsModule } from './credentials.module';
export {
  MissingCredentialError,
  TOKEN_PROVIDER,
  TokenProvider,
} from './token-provider';
export { SECRET_STORE, SecretStore, StoredSecret } from './secret-store';
