import { Platform } from '../common/enums/platform.enum';
import { TokenProvider } from '../credentials';
import { AdapterContext } from './platform-adapter.interface';
import { TokenExpiredError } from './platform-errors';

/**
 * Resolve the acting account's platform token and run `call` with it, in one
 * place so every credentialed adapter gets its token the same way. A failure to
 * resolve a token becomes a {@link TokenExpiredError} for `platform`, so adapters
 * only ever surface the shared error types.
 *
 * Refresh-on-expiry and token caching are a designed-not-built seam behind the
 * {@link TokenProvider} (see DESIGN.md): they would live here and in the provider
 * without changing any adapter call site.
 */
export async function withPlatformToken<T>(
  tokens: TokenProvider,
  platform: Platform,
  ctx: AdapterContext,
  call: (token: string) => Promise<T>,
): Promise<T> {
  let token: string;
  try {
    token = await tokens.getToken(ctx.platformAccountId);
  } catch (cause) {
    throw new TokenExpiredError(platform, { cause });
  }
  return call(token);
}
