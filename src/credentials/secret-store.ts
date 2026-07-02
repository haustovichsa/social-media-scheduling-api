/**
 * The credential material a {@link SecretStore} returns for one account. Only
 * what the provider needs to mint an {@link AccessToken} — deliberately no more.
 */
export interface StoredSecret {
  /** The platform access token to present on outbound calls. */
  readonly accessToken: string;
  /**
   * Lifetime of `accessToken` in seconds, if the store knows it. The provider
   * defaults to a conservative TTL when this is absent.
   */
  readonly expiresInSeconds?: number;
}

/**
 * The seam between the {@link TokenProvider} and wherever secrets actually live.
 * Keyed on our own `platformAccountId` so the provider never has to know how a
 * given account's credential is stored. A production implementation resolves the
 * account's opaque `tokenRef` (see `PlatformAccount`) against a real secret
 * manager (Vault, AWS Secrets Manager, GCP Secret Manager); the stub reads from
 * the environment. Swapping stores is a one-provider change — nothing upstream
 * moves (NFR-1).
 */
export interface SecretStore {
  /** Return the account's stored secret, or `null` if none is on file. */
  read(platformAccountId: string): Promise<StoredSecret | null>;
}

/** DI token so consumers depend on the {@link SecretStore} interface, not a class. */
export const SECRET_STORE = Symbol('SECRET_STORE');

const ENV_PREFIX = 'SOCIAL_ACCESS_TOKEN_';

/** Env var names allow only word characters; normalise an account id to that. */
function envKey(platformAccountId: string): string {
  return `${ENV_PREFIX}${platformAccountId.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`;
}

/**
 * Stub secret store backed by environment variables — the local/dev seam that a
 * real secret manager replaces. Each account's token lives in
 * `SOCIAL_ACCESS_TOKEN_<ACCOUNT_ID>` (id upper-cased, non-word chars → `_`). It
 * never caches or logs the value; caching and expiry are the provider's job.
 */
export class EnvSecretStore implements SecretStore {
  read(platformAccountId: string): Promise<StoredSecret | null> {
    const accessToken = process.env[envKey(platformAccountId)];
    return Promise.resolve(accessToken ? { accessToken } : null);
  }
}
