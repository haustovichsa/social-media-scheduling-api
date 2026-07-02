/**
 * The authenticated caller. Just the tenant today (A-6) — every ownership-scoped
 * query is keyed on `orgId` — but kept as an object so a `userId`, scopes, or
 * roles can be added later without changing the guard's contract.
 */
export interface Caller {
  /** The caller's tenant. Copied onto the request for {@link CurrentOrgId}. */
  readonly orgId: string;
}

/**
 * The seam between {@link AuthGuard} and wherever caller identity actually lives.
 * Given the opaque credential presented on a request, it returns the resolved
 * {@link Caller} or `null` if the credential is unknown/invalid. Mirrors the
 * {@link SecretStore}/{@link TokenProvider} pattern: consumers depend on this
 * interface via {@link CALLER_RESOLVER}, so swapping the env stub for a real
 * validator (a signed-JWT verifier, an API-key service) is a one-provider change
 * and nothing upstream moves (NFR-1).
 */
export interface CallerResolver {
  /** Resolve a credential to its caller, or `null` when it isn't recognised. */
  resolve(credential: string): Promise<Caller | null>;
}

/** DI token so consumers depend on the {@link CallerResolver} interface, not a class. */
export const CALLER_RESOLVER = Symbol('CALLER_RESOLVER');
