import { Platform } from '../common/enums/platform.enum';
import {
  AccessToken,
  MissingCredentialError,
  TokenProvider,
} from '../credentials';
import { AdapterContext } from './platform-adapter.interface';
import { RateLimitError, TokenExpiredError } from './platform-errors';
import { withPlatformToken } from './with-platform-token';

const CTX: AdapterContext = { platformAccountId: 'acc-1' };

/** Hands out predictable tokens and counts how often each path is taken. */
class FakeTokenProvider implements TokenProvider {
  getCalls = 0;
  refreshCalls = 0;
  missing = false;

  getToken(id: string): Promise<AccessToken> {
    this.getCalls += 1;
    return this.mint(id, 'access');
  }

  refreshToken(id: string): Promise<AccessToken> {
    this.refreshCalls += 1;
    return this.mint(id, 'refreshed');
  }

  private mint(id: string, kind: string): Promise<AccessToken> {
    if (this.missing) {
      return Promise.reject(new MissingCredentialError(id));
    }
    return Promise.resolve(
      new AccessToken(`${kind}-token`, new Date(Date.now() + 3_600_000)),
    );
  }
}

describe('withPlatformToken', () => {
  let tokens: FakeTokenProvider;

  beforeEach(() => {
    tokens = new FakeTokenProvider();
  });

  const run = <T>(call: (token: AccessToken) => Promise<T>) =>
    withPlatformToken(tokens, Platform.Facebook, CTX, call);

  it('resolves a token and passes it to the call', async () => {
    const seen: string[] = [];
    const result = await run((token) => {
      seen.push(token.reveal());
      return Promise.resolve('ok');
    });

    expect(result).toBe('ok');
    expect(seen).toEqual(['access-token']);
    expect(tokens.getCalls).toBe(1);
    expect(tokens.refreshCalls).toBe(0);
  });

  it('refreshes once and retries when the token is rejected as expired', async () => {
    let attempt = 0;
    const seen: string[] = [];

    const result = await run((token) => {
      attempt += 1;
      seen.push(token.reveal());
      if (attempt === 1) {
        return Promise.reject(new TokenExpiredError(Platform.Facebook));
      }
      return Promise.resolve('ok');
    });

    expect(result).toBe('ok');
    expect(seen).toEqual(['access-token', 'refreshed-token']);
    expect(tokens.refreshCalls).toBe(1);
  });

  it('gives up after one refresh if the fresh token is also rejected', async () => {
    await expect(
      run(() => Promise.reject(new TokenExpiredError(Platform.Facebook))),
    ).rejects.toBeInstanceOf(TokenExpiredError);
    expect(tokens.refreshCalls).toBe(1);
  });

  it('normalises a missing credential to a TokenExpiredError for the platform', async () => {
    tokens.missing = true;
    await expect(run(() => Promise.resolve('unused'))).rejects.toBeInstanceOf(
      TokenExpiredError,
    );
  });

  it('lets other typed platform errors propagate without a retry', async () => {
    await expect(
      run(() => Promise.reject(new RateLimitError(Platform.Facebook))),
    ).rejects.toBeInstanceOf(RateLimitError);
    expect(tokens.refreshCalls).toBe(0);
  });
});
