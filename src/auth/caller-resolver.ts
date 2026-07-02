/**
 * The authenticated caller. Just the tenant today — every ownership-scoped query
 * is keyed on `orgId` — but an object so a `userId`, scopes, or roles can be
 * added later without changing the guard's contract.
 */
export interface Caller {
  /** The caller's tenant. Copied onto the request for {@link CurrentOrgId}. */
  readonly orgId: string;
}

/**
 * The seam between {@link AuthGuard} and wherever caller identity lives. Given the
 * opaque credential on a request, returns the {@link Caller} or `null` if it's
 * unknown/invalid. Consumers depend on this interface via {@link CALLER_RESOLVER},
 * so swapping the env stub for a real validator (a JWT verifier, an API-key
 * service) is a one-provider change and nothing upstream moves.
 */
export interface CallerResolver {
  /** Resolve a credential to its caller, or `null` when it isn't recognised. */
  resolve(credential: string): Promise<Caller | null>;
}

/** DI token so consumers depend on the {@link CallerResolver} interface, not a class. */
export const CALLER_RESOLVER = Symbol('CALLER_RESOLVER');
