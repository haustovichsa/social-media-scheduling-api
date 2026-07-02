import { Inject, Injectable } from '@nestjs/common';

import { AccessToken } from './access-token';
import { SECRET_STORE, SecretStore } from './secret-store';
import { MissingCredentialError, TokenProvider } from './token-provider';

/** TTL used when the secret store does not tell us how long a token lives. */
const DEFAULT_TTL_SECONDS = 3600;

/**
 * Reference {@link TokenProvider}: resolves credentials through a
 * {@link SecretStore} and caches the minted {@link AccessToken} per account until
 * it expires. It stands in for a full OAuth client while keeping the exact seam a
 * real one would use — nothing upstream changes when the store or the refresh
 * mechanism becomes real.
 *
 * Refresh model: {@link getToken} returns the cached token while it is still
 * valid and transparently re-resolves once it has expired; {@link refreshToken}
 * always re-resolves, modelling the OAuth refresh a platform forces when it
 * rejects a token early. The stub re-reads the store rather than calling a live
 * token endpoint, but the caching, expiry, and cache-replacement behaviour is
 * exactly what the real provider exposes.
 */
@Injectable()
export class StubTokenProvider implements TokenProvider {
  // accountId → last minted token; overwritten on refresh, and a real provider
  // handling many transient accounts would add TTL-based eviction here.
  private readonly cache = new Map<string, AccessToken>();

  constructor(@Inject(SECRET_STORE) private readonly secrets: SecretStore) {}

  async getToken(platformAccountId: string): Promise<AccessToken> {
    const cached = this.cache.get(platformAccountId);
    if (cached && !cached.hasExpired()) {
      return cached;
    }
    return this.resolve(platformAccountId);
  }

  async refreshToken(platformAccountId: string): Promise<AccessToken> {
    return this.resolve(platformAccountId);
  }

  /** Read the store, mint a fresh token, and replace whatever the cache held. */
  private async resolve(platformAccountId: string): Promise<AccessToken> {
    const secret = await this.secrets.read(platformAccountId);
    if (!secret) {
      throw new MissingCredentialError(platformAccountId);
    }
    const ttlSeconds = secret.expiresInSeconds ?? DEFAULT_TTL_SECONDS;
    const token = new AccessToken(
      secret.accessToken,
      new Date(Date.now() + ttlSeconds * 1000),
    );
    this.cache.set(platformAccountId, token);
    return token;
  }
}
