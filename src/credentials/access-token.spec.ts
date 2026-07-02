import { AccessToken, REDACTED } from './access-token';

describe('AccessToken', () => {
  const make = (value = 'super-secret', offsetMs = 3_600_000) =>
    new AccessToken(value, new Date(Date.now() + offsetMs));

  it('reveals the raw secret only through reveal()', () => {
    expect(make('super-secret').reveal()).toBe('super-secret');
  });

  it('redacts on every implicit stringification path', () => {
    const token = make('super-secret');

    // toString() — the path a template literal / String() takes. (Interpolating
    // the object directly is itself a lint error, which is the safety net working.)
    expect(token.toString()).toBe(REDACTED);
    expect(String(token)).toBe(REDACTED);
    // JSON.stringify, directly and when nested on an object (e.g. a log line)
    expect(JSON.stringify(token)).toBe(`"${REDACTED}"`);
    expect(JSON.stringify({ auth: token })).toBe(`{"auth":"${REDACTED}"}`);
  });

  it('never exposes the secret through enumeration or console inspection', () => {
    const token = make('super-secret');

    // The raw value lives in a true-private field: not an own enumerable key.
    expect(JSON.stringify({ ...token })).not.toContain('super-secret');
    const inspected = (
      token as unknown as {
        [k: symbol]: () => string;
      }
    )[Symbol.for('nodejs.util.inspect.custom')]();
    expect(inspected).toBe(REDACTED);
  });

  it('reports expiry relative to a supplied clock', () => {
    const token = make('secret', 1000);
    expect(token.hasExpired(new Date(Date.now()))).toBe(false);
    expect(token.hasExpired(new Date(Date.now() + 2000))).toBe(true);
  });
});
