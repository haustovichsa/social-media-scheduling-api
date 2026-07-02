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
 * Authenticates a request and pins the caller's tenant onto it. Pulls the bearer
 * credential from the `Authorization` header, resolves it via the
 * {@link CallerResolver}, and sets `request.orgId` — the value {@link CurrentOrgId}
 * hands the services, which scope every query to that org.
 *
 * This guard only proves who the caller is (no/bad credential → 401); it doesn't
 * load posts or comments. Ownership is enforced downstream by org-scoped queries:
 * another tenant's resource looks the same as not found and maps to a 404 (not
 * 403), so a caller can't probe for existence of resources it doesn't own.
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
