import { Platform } from '../common/enums/platform.enum';
import { TokenProvider } from '../credentials';
import { AdapterContext } from './platform-adapter.interface';
import { TokenExpiredError } from './platform-errors';

/**
 * Resolve the acting account's platform token and run `call` with it, in one
 * place so every credentialed adapter obtains a token the same way rather than
 * re-implementing the lookup. A failure to resolve a token is normalised to a
 * {@link TokenExpiredError} for `platform`, so an adapter only ever surfaces the
 * shared error taxonomy (AC-5).
 *
 * Refresh-on-expiry and token caching are a designed-not-built seam behind the
 * {@link TokenProvider} (see DESIGN.md §9): they would live here and in the
 * provider without changing any adapter call site.
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
