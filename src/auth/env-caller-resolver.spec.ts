import { EnvCallerResolver } from './env-caller-resolver';

/**
 * Unit tests for the env-backed dev resolver. Config is passed to the constructor
 * rather than mutating `process.env`, so parsing and lookup run in isolation.
 */
describe('EnvCallerResolver', () => {
  it('resolves a known key to its tenant', async () => {
    const resolver = new EnvCallerResolver(
      'devkey-abc:org-1, devkey-xyz:org-2',
    );
    await expect(resolver.resolve('devkey-abc')).resolves.toEqual({
      orgId: 'org-1',
    });
    await expect(resolver.resolve('devkey-xyz')).resolves.toEqual({
      orgId: 'org-2',
    });
  });

  it('returns null for an unknown key', async () => {
    const resolver = new EnvCallerResolver('devkey-abc:org-1');
    await expect(resolver.resolve('devkey-other')).resolves.toBeNull();
  });

  it('resolves to null for every key when the env var is absent', async () => {
    const resolver = new EnvCallerResolver(undefined);
    await expect(resolver.resolve('devkey-abc')).resolves.toBeNull();
  });

  it('ignores blank entries and preserves colons inside the org id', async () => {
    const resolver = new EnvCallerResolver('devkey-abc:tenant:with:colons, , ');
    await expect(resolver.resolve('devkey-abc')).resolves.toEqual({
      orgId: 'tenant:with:colons',
    });
  });

  it('skips malformed pairs missing a key or org id', async () => {
    const resolver = new EnvCallerResolver(':org-1,devkey-nokey');
    await expect(resolver.resolve('')).resolves.toBeNull();
    await expect(resolver.resolve('devkey-nokey')).resolves.toBeNull();
  });
});
