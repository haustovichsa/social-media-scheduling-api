import { Platform } from '../common/enums/platform.enum';
import {
  AccessToken,
  MissingCredentialError,
  TokenProvider,
} from '../credentials';
import { AdapterContext } from './platform-adapter.interface';
import { TokenExpiredError } from './platform-errors';

/**
 * The token-injection-plus-refresh policy every credentialed adapter needs, in
 * one place. Resolves the acting account's token via the {@link TokenProvider},
 * runs `call` with it, and — if the platform rejects the token as expired —
 * refreshes once and retries exactly once (a fresh token still rejected is a
 * real {@link TokenExpiredError}, not a transient). A {@link MissingCredentialError}
 * from the provider is normalised to a {@link TokenExpiredError} for `platform`,
 * so an adapter only ever surfaces the shared error taxonomy (AC-5).
 *
 * This has to sit at the adapter boundary — the token is injected into the
 * platform call, which the adapter owns — but it is deliberately not a private
 * method: keeping it a shared helper means a new platform adapter delegates
 * rather than re-implements the dance, and TASK-11 has a single seam to add
 * backoff/rate-limiting to instead of a copy per adapter.
 */
export async function withPlatformToken<T>(
  tokens: TokenProvider,
  platform: Platform,
  ctx: AdapterContext,
  call: (token: AccessToken) => Promise<T>,
): Promise<T> {
  try {
    const token = await tokens.getToken(ctx.platformAccountId);
    try {
      return await call(token);
    } catch (error) {
      if (!(error instanceof TokenExpiredError)) {
        throw error;
      }
      const refreshed = await tokens.refreshToken(ctx.platformAccountId);
      return await call(refreshed);
    }
  } catch (error) {
    if (error instanceof MissingCredentialError) {
      throw new TokenExpiredError(platform, { cause: error });
    }
    throw error;
  }
}
