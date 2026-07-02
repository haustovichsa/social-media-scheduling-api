/**
 * The one way any adapter obtains a platform token. Callers pass our
 * `platformAccountId`; the provider resolves it to a usable access token.
 * Adapters depend only on this interface via {@link TOKEN_PROVIDER} and never read
 * a secret directly, so this is the single seam where a real secret manager,
 * token caching, rotation, refresh-on-expiry, and a leak-proof wrapper would plug
 * in (designed but not built; see DESIGN.md). {@link EnvTokenProvider} is the
 * env-backed reference implementation.
 */
export interface TokenProvider {
  /** A usable access token for the account. */
  getToken(platformAccountId: string): Promise<string>;
}

/** DI token so consumers depend on the {@link TokenProvider} interface. */
export const TOKEN_PROVIDER = Symbol('TOKEN_PROVIDER');

const ENV_PREFIX = 'SOCIAL_ACCESS_TOKEN_';

/** Env var names allow only word characters; normalise an account id to that. */
function envKey(platformAccountId: string): string {
  return `${ENV_PREFIX}${platformAccountId.replace(/[^A-Za-z0-9]/g, '_').toUpperCase()}`;
}

/**
 * Reference {@link TokenProvider} backed by env vars — the local/dev seam a real
 * credential store replaces. Each account's token lives in
 * `SOCIAL_ACCESS_TOKEN_<ACCOUNT_ID>` (id upper-cased, non-word chars → `_`).
 * Throws when no credential is on file rather than returning an empty token.
 */
export class EnvTokenProvider implements TokenProvider {
  getToken(platformAccountId: string): Promise<string> {
    const token = process.env[envKey(platformAccountId)];
    if (!token) {
      throw new Error(
        `No credential on file for platform account "${platformAccountId}"`,
      );
    }
    return Promise.resolve(token);
  }
}
