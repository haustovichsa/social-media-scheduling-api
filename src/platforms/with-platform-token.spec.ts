import { Platform } from '../common/enums/platform.enum';
import { TokenProvider } from '../credentials';
import { AdapterContext } from './platform-adapter.interface';
import { RateLimitError, TokenExpiredError } from './platform-errors';
import { withPlatformToken } from './with-platform-token';

const CTX: AdapterContext = { platformAccountId: 'acc-1' };

/** Hands out a predictable token and counts how often it is asked. */
class FakeTokenProvider implements TokenProvider {
  getCalls = 0;
  missing = false;

  getToken(id: string): Promise<string> {
    this.getCalls += 1;
    if (this.missing) {
      return Promise.reject(new Error(`no credential for ${id}`));
    }
    return Promise.resolve('access-token');
  }
}

describe('withPlatformToken', () => {
  let tokens: FakeTokenProvider;

  beforeEach(() => {
    tokens = new FakeTokenProvider();
  });

  const run = <T>(call: (token: string) => Promise<T>) =>
    withPlatformToken(tokens, Platform.Facebook, CTX, call);

  it('resolves a token and passes it to the call', async () => {
    const seen: string[] = [];
    const result = await run((token) => {
      seen.push(token);
      return Promise.resolve('ok');
    });

    expect(result).toBe('ok');
    expect(seen).toEqual(['access-token']);
    expect(tokens.getCalls).toBe(1);
  });

  it('normalises a failure to resolve a token into a TokenExpiredError', async () => {
    tokens.missing = true;
    await expect(run(() => Promise.resolve('unused'))).rejects.toBeInstanceOf(
      TokenExpiredError,
    );
  });

  it('lets a typed platform error from the call propagate unchanged', async () => {
    await expect(
      run(() => Promise.reject(new RateLimitError(Platform.Facebook))),
    ).rejects.toBeInstanceOf(RateLimitError);
  });
});
