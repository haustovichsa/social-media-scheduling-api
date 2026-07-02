import { Caller, CallerResolver } from './caller-resolver';

/**
 * Env var holding the dev API keys as a comma-separated list of `key:orgId`
 * pairs, e.g. `SOCIAL_API_KEYS="devkey-abc:org-1,devkey-xyz:org-2"`.
 */
const ENV_VAR = 'SOCIAL_API_KEYS';

/**
 * Stub {@link CallerResolver} backed by an env var — the local/dev seam a real
 * authenticator replaces (exactly like `EnvTokenProvider` for tokens). It
 * treats the presented credential as an opaque API key and maps it to a tenant
 * from {@link ENV_VAR}; an unknown key resolves to `null` and the guard turns
 * that into a 401.
 *
 * The map is parsed once at construction. A real implementation would instead
 * verify a signed token (so there's nothing to look up) or call an auth service;
 * a plain string-equality key lookup like this leaks timing and is for local use
 * only — hence it stays behind this swappable seam.
 */
export class EnvCallerResolver implements CallerResolver {
  private readonly orgByKey: ReadonlyMap<string, string>;

  constructor(rawConfig: string | undefined = process.env[ENV_VAR]) {
    this.orgByKey = new Map(
      (rawConfig ?? '')
        .split(',')
        .map((pair): [string, string] => {
          // Split on the first colon only, so an org id may itself contain
          // colons. A blank/malformed entry yields empty parts and is dropped
          // by the filter below.
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
