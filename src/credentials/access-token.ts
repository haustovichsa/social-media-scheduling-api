/** The single string every redaction path collapses a secret to. */
export const REDACTED = '[REDACTED]';

/**
 * A platform access token wrapped so it cannot leak (RK-6, NFR-4). The raw
 * secret is held in a true-private field and is only reachable through
 * {@link reveal}, which the transport layer calls at the exact moment it
 * authenticates an outbound request. Every implicit stringification path —
 * template literals, `String()`, `JSON.stringify`, and Node's
 * `console.log`/`util.inspect` — is overridden to emit {@link REDACTED}, so a
 * stray log line or a token accidentally placed on a DTO can never expose the
 * credential. Passing this value object around instead of a bare `string` makes
 * "don't log the token" the default rather than a rule everyone must remember.
 */
export class AccessToken {
  readonly #value: string;

  constructor(
    value: string,
    /** When the token stops being valid; the provider refreshes past this. */
    readonly expiresAt: Date,
  ) {
    this.#value = value;
  }

  /**
   * The raw secret. Call this only to authenticate an outbound platform request;
   * never pass the result to a logger or a response body.
   */
  reveal(): string {
    return this.#value;
  }

  /** Whether the token is at or past its expiry (drives provider refresh). */
  hasExpired(now: Date = new Date()): boolean {
    return this.expiresAt.getTime() <= now.getTime();
  }

  toString(): string {
    return REDACTED;
  }

  toJSON(): string {
    return REDACTED;
  }

  // Honoured by console.log / util.inspect ahead of the object's own fields.
  [Symbol.for('nodejs.util.inspect.custom')](): string {
    return REDACTED;
  }
}
