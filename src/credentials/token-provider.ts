import { AccessToken } from './access-token';

/**
 * No credential is on file for the account. Platform-agnostic on purpose — the
 * provider doesn't know which platform the account belongs to. The calling
 * adapter maps this onto a {@link TokenExpiredError} for *its* platform so the
 * core still only ever sees the shared error taxonomy (AC-5).
 */
export class MissingCredentialError extends Error {
  constructor(readonly platformAccountId: string) {
    // Never interpolate the secret (there is none) — only the account id.
    super(`No credential on file for platform account "${platformAccountId}"`);
    this.name = 'MissingCredentialError';
  }
}

/**
 * The one way any adapter obtains a platform token (NFR-4, RK-6). Callers pass
 * our `platformAccountId`; the provider resolves it to a live {@link AccessToken}
 * out of a {@link SecretStore}, caching until expiry. Tokens are only ever read
 * through this interface, so there is a single place to add rotation, auditing,
 * or a real secret manager later.
 */
export interface TokenProvider {
  /**
   * A valid token for the account, minting or reusing a cached one. Throws
   * {@link MissingCredentialError} if the account has no credential on file.
   */
  getToken(platformAccountId: string): Promise<AccessToken>;

  /**
   * Force a fresh token, bypassing any cache — the hook an adapter calls after a
   * platform rejects the current token as expired, before retrying once.
   */
  refreshToken(platformAccountId: string): Promise<AccessToken>;
}

/** DI token so consumers depend on the {@link TokenProvider} interface. */
export const TOKEN_PROVIDER = Symbol('TOKEN_PROVIDER');
