import { Platform } from '../../../common/enums/platform.enum';
import {
  PlatformUnavailableError,
  RateLimitError,
  ResourceNotFoundError,
  TokenExpiredError,
  UnknownPlatformError,
} from '../../platform-errors';
import {
  FacebookComment,
  FacebookCommentsResponse,
} from './facebook-graph.types';

/**
 * The transport seam between {@link FacebookAdapter} and the Graph API. Keeping
 * it an interface lets the adapter be unit-tested with a fake (no network) and
 * lets the real HTTP/auth concerns evolve independently — per-account tokens
 * arrive with the TokenProvider (TASK-06) and retry/backoff with TASK-11, both
 * behind this same contract. Its one job at this boundary: return raw Graph
 * payloads or throw a typed {@link PlatformError}, never a bare HTTP failure.
 */
export interface FacebookGraphClient {
  listComments(
    externalPostId: string,
    after?: string,
  ): Promise<FacebookCommentsResponse>;
  createReply(
    externalCommentId: string,
    message: string,
  ): Promise<FacebookComment>;
}

/** DI token for the Graph client, so the adapter depends on the interface. */
export const FACEBOOK_GRAPH_CLIENT = Symbol('FACEBOOK_GRAPH_CLIENT');

const GRAPH_BASE_URL = 'https://graph.facebook.com/v19.0';
const COMMENT_FIELDS =
  'id,message,created_time,from{id,name,picture},parent{id}';

/**
 * Real Graph API client (a partial, realistic sketch). It builds Graph requests,
 * and — the part that matters for the contract — maps every HTTP failure onto
 * the typed error taxonomy so no raw Graph response ever leaves the adapter
 * layer (AC-5). Network transport is wired but the tests drive the adapter with
 * a fake client, so this class is the integration seam rather than the unit
 * under test.
 *
 * Auth is a deliberate placeholder: it reads a single app token from the
 * environment. The TokenProvider (TASK-06) replaces this with per-account
 * credentials behind the same method signatures.
 */
export class HttpFacebookGraphClient implements FacebookGraphClient {
  private accessToken(): string {
    // TASK-06: resolve the owning account's token via the TokenProvider.
    return process.env.FACEBOOK_ACCESS_TOKEN ?? '';
  }

  async listComments(
    externalPostId: string,
    after?: string,
  ): Promise<FacebookCommentsResponse> {
    const params = new URLSearchParams({
      fields: COMMENT_FIELDS,
      filter: 'stream',
      access_token: this.accessToken(),
    });
    if (after) {
      params.set('after', after);
    }
    return this.request<FacebookCommentsResponse>(
      `${GRAPH_BASE_URL}/${encodeURIComponent(externalPostId)}/comments?${params}`,
      { method: 'GET' },
      externalPostId,
    );
  }

  async createReply(
    externalCommentId: string,
    message: string,
  ): Promise<FacebookComment> {
    const params = new URLSearchParams({
      // Ask for the created comment's fields back so we can return a full reply
      // without a second round-trip.
      fields: COMMENT_FIELDS,
      access_token: this.accessToken(),
    });
    return this.request<FacebookComment>(
      `${GRAPH_BASE_URL}/${encodeURIComponent(externalCommentId)}/comments?${params}`,
      {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ message }),
      },
      externalCommentId,
    );
  }

  /** Perform the call and translate any failure into a {@link PlatformError}. */
  private async request<T>(
    url: string,
    init: RequestInit,
    externalId: string,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(url, init);
    } catch (cause) {
      // Network error, DNS, timeout — the platform is effectively unreachable.
      throw new PlatformUnavailableError(Platform.Facebook, undefined, {
        cause,
      });
    }

    if (!response.ok) {
      throw this.toPlatformError(response, externalId);
    }
    return (await response.json()) as T;
  }

  private toPlatformError(response: Response, externalId: string): Error {
    switch (response.status) {
      case 429:
        return new RateLimitError(
          Platform.Facebook,
          retryAfterMs(response.headers.get('retry-after')),
        );
      case 401:
      case 403:
        return new TokenExpiredError(Platform.Facebook);
      case 404:
        return new ResourceNotFoundError(Platform.Facebook, externalId);
      default:
        return response.status >= 500
          ? new PlatformUnavailableError(
              Platform.Facebook,
              `Facebook returned ${response.status}`,
            )
          : new UnknownPlatformError(
              Platform.Facebook,
              `Facebook returned ${response.status}`,
            );
    }
  }
}

/** Parse a `Retry-After` header (seconds) into milliseconds, if present. */
function retryAfterMs(header: string | null): number | undefined {
  if (!header) {
    return undefined;
  }
  const seconds = Number(header);
  return Number.isFinite(seconds) ? seconds * 1000 : undefined;
}
