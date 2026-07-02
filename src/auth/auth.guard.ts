import {
  CanActivate,
  ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';

import { AuthenticatedRequest } from '../common/http/current-org-id.decorator';
import { CALLER_RESOLVER, CallerResolver } from './caller-resolver';

/**
 * Authenticates a request and pins the caller's tenant onto it (A-6, NFR-4). It
 * pulls the bearer credential from the `Authorization` header, resolves it via
 * the {@link CallerResolver}, and sets `request.orgId` — the value
 * {@link CurrentOrgId} hands the services, which then scope every query to that
 * org. Applied to both comment routes with `@UseGuards`.
 *
 * Split of responsibilities (and status codes):
 *  - *Authentication* is here: no/'bad' credential → 401. This guard only proves
 *    *who* the caller is; it does not load posts or comments.
 *  - *Ownership* is enforced downstream by the org-scoped repository queries: a
 *    resource in another tenant is indistinguishable from a missing one and maps
 *    to a single 404, so a caller can't probe for resources it doesn't own. We
 *    deliberately return 404 (not 403) for cross-tenant access to avoid leaking
 *    existence — the guard here never needs the resource to make that call.
 */
@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    @Inject(CALLER_RESOLVER) private readonly resolver: CallerResolver,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();

    const credential = bearerCredential(request.headers.authorization);
    if (!credential) {
      throw new UnauthorizedException(
        'Missing or malformed Authorization header.',
      );
    }

    const caller = await this.resolver.resolve(credential);
    if (!caller) {
      throw new UnauthorizedException('Invalid credentials.');
    }

    request.orgId = caller.orgId;
    return true;
  }
}

/** Extract the token from an `Authorization: Bearer <token>` header, or `null`. */
function bearerCredential(header: string | undefined): string | null {
  if (!header) {
    return null;
  }
  const [scheme, token] = header.split(' ');
  if (scheme?.toLowerCase() !== 'bearer' || !token) {
    return null;
  }
  return token;
}
