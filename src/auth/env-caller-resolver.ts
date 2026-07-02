import { Caller, CallerResolver } from './caller-resolver';

/**
 * Env var holding the dev API keys as a comma-separated list of `key:orgId`
 * pairs, e.g. `SOCIAL_API_KEYS="devkey-abc:org-1,devkey-xyz:org-2"`.
 */
const ENV_VAR = 'SOCIAL_API_KEYS';

/**
 * Stub {@link CallerResolver} backed by an env var — the local/dev seam a real
 * authenticator replaces. Treats the credential as an opaque API key and maps it
 * to a tenant from {@link ENV_VAR}; an unknown key resolves to `null` (a 401).
 *
 * The map is parsed once at construction. This plain string-equality lookup
 * leaks timing and is for local use only, which is why it stays behind a
 * swappable seam; a real version would verify a signed token or call an auth
 * service.
 */
export class EnvCallerResolver implements CallerResolver {
  private readonly orgByKey: ReadonlyMap<string, string>;

  constructor(rawConfig: string | undefined = process.env[ENV_VAR]) {
    this.orgByKey = new Map(
      (rawConfig ?? '')
        .split(',')
        .map((pair): [string, string] => {
          // Split on the first colon only, so an org id may contain colons.
          // Blank/malformed entries yield empty parts and are dropped below.
          const trimmed = pair.trim();
          const separator = trimmed.indexOf(':');
          return [trimmed.slice(0, separator), trimmed.slice(separator + 1)];
        })
        .filter(([key, orgId]) => key.length > 0 && orgId.length > 0),
    );
  }

  resolve(credential: string): Promise<Caller | null> {
    const orgId = this.orgByKey.get(credential);
    return Promise.resolve(orgId ? { orgId } : null);
  }
}
