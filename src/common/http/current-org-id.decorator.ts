import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import { Request } from 'express';

/**
 * Shape the auth layer attaches to the request. Kept here (not on global Express
 * types) so the guard-to-controller contract stays explicit and local.
 */
export interface AuthenticatedRequest extends Request {
  /** The caller's resolved tenant. Set by {@link AuthGuard}. */
  orgId?: string;
}

/**
 * Injects the caller's org id. {@link AuthGuard} authenticates the request and
 * sets `request.orgId`; ownership-scoped queries read it through this decorator
 * instead of parsing headers in each controller.
 *
 * A missing value means the route was exposed without the guard — a wiring bug,
 * not a client error — so we fail loudly with a 500 rather than silently querying
 * with `undefined` and leaking across tenants.
 */
export const CurrentOrgId = createParamDecorator(
  (_data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!request.orgId) {
      throw new InternalServerErrorException(
        'Missing org context: route is not protected by the auth guard.',
      );
    }
    return request.orgId;
  },
);
