import {
  createParamDecorator,
  ExecutionContext,
  InternalServerErrorException,
} from '@nestjs/common';
import { Request } from 'express';

/**
 * Shape the auth layer attaches to the request. Kept here (not on the global
 * Express types) so the contract between the guard and the controllers is
 * explicit and local.
 */
export interface AuthenticatedRequest extends Request {
  /** The caller's resolved tenant. Set by the auth/ownership guard (TASK-10). */
  orgId?: string;
}

/**
 * Injects the caller's org id (A-6). The auth guard (TASK-10) authenticates the
 * request and sets `request.orgId`; every ownership-scoped query then reads it
 * through this decorator instead of parsing headers in each controller.
 *
 * If it is missing, a route was exposed without the guard in front of it — a
 * wiring bug, not a client error — so we fail loudly with a 500 rather than
 * silently querying with `undefined` and leaking across tenants.
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
