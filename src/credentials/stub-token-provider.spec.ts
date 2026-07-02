import { SecretStore, StoredSecret } from './secret-store';
import { StubTokenProvider } from './stub-token-provider';
import { MissingCredentialError } from './token-provider';

/** Programmable secret store that records how often it is read. */
class FakeSecretStore implements SecretStore {
  reads = 0;
  lastAccountId?: string;
  secret: StoredSecret | null = { accessToken: 'secret-1' };

  read(platformAccountId: string): Promise<StoredSecret | null> {
    this.reads += 1;
    this.lastAccountId = platformAccountId;
    return Promise.resolve(this.secret);
  }
}

describe('StubTokenProvider', () => {
  let store: FakeSecretStore;
  let provider: StubTokenProvider;

  beforeEach(() => {
    store = new FakeSecretStore();
    provider = new StubTokenProvider(store);
  });

  it('mints a token from the stored secret', async () => {
    const token = await provider.getToken('acc-1');
    expect(token.reveal()).toBe('secret-1');
    expect(token.hasExpired()).toBe(false);
  });

  it('serves a cached token without re-reading the store while it is valid', async () => {
    const first = await provider.getToken('acc-1');
    const second = await provider.getToken('acc-1');

    expect(second).toBe(first);
    expect(store.reads).toBe(1);
  });

  it('re-resolves once the cached token has expired', async () => {
    jest.useFakeTimers();
    try {
      // Default TTL is 1h; advance past it so the cached token is stale.
      await provider.getToken('acc-1');
      jest.setSystemTime(Date.now() + 3_600_001);
      store.secret = { accessToken: 'secret-2' };

      const refreshed = await provider.getToken('acc-1');
      expect(refreshed.reveal()).toBe('secret-2');
      expect(store.reads).toBe(2);
    } finally {
      jest.useRealTimers();
    }
  });

  it('honours the store TTL when it supplies one', async () => {
    store.secret = { accessToken: 'short', expiresInSeconds: 60 };
    const token = await provider.getToken('acc-1');
    expect(token.hasExpired(new Date(Date.now() + 61_000))).toBe(true);
  });

  it('refreshToken bypasses the cache and replaces it', async () => {
    const original = await provider.getToken('acc-1');
    store.secret = { accessToken: 'rotated' };

    const refreshed = await provider.refreshToken('acc-1');
    expect(refreshed.reveal()).toBe('rotated');
    expect(refreshed).not.toBe(original);
    expect(store.reads).toBe(2);

    // Subsequent getToken serves the refreshed token from cache.
    const next = await provider.getToken('acc-1');
    expect(next).toBe(refreshed);
    expect(store.reads).toBe(2);
  });

  it('throws MissingCredentialError when the store has no secret', async () => {
    store.secret = null;
    await expect(provider.getToken('acc-1')).rejects.toBeInstanceOf(
      MissingCredentialError,
    );
  });
});
