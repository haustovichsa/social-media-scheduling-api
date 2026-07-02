import { ExecutionContext, UnauthorizedException } from '@nestjs/common';

import { AuthenticatedRequest } from '../common/http/current-org-id.decorator';
import { AuthGuard } from './auth.guard';
import { Caller, CallerResolver } from './caller-resolver';

/**
 * Unit tests for the auth boundary. The {@link CallerResolver} is mocked, so
 * these assert only what the guard owns: extracting the bearer credential,
 * pinning the resolved org onto the request, and rejecting anything
 * unauthenticated with a 401. Ownership (the cross-tenant 404) is enforced and
 * tested downstream.
 */
describe('AuthGuard', () => {
  let resolve: jest.Mock<Promise<Caller | null>, [string]>;
  let guard: AuthGuard;

  beforeEach(() => {
    resolve = jest.fn<Promise<Caller | null>, [string]>();
    const resolver: CallerResolver = { resolve };
    guard = new AuthGuard(resolver);
  });

  function contextWith(authorization?: string): {
    ctx: ExecutionContext;
    request: AuthenticatedRequest;
  } {
    const request = { headers: { authorization } } as AuthenticatedRequest;
    const ctx = {
      switchToHttp: () => ({ getRequest: () => request }),
    } as unknown as ExecutionContext;
    return { ctx, request };
  }

  it('resolves a valid bearer credential and pins the org onto the request', async () => {
    resolve.mockResolvedValue({ orgId: 'org-1' });
    const { ctx, request } = contextWith('Bearer devkey-abc');

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(resolve).toHaveBeenCalledWith('devkey-abc');
    expect(request.orgId).toBe('org-1');
  });

  it('accepts a case-insensitive scheme', async () => {
    resolve.mockResolvedValue({ orgId: 'org-1' });
    const { ctx, request } = contextWith('bearer devkey-abc');

    await expect(guard.canActivate(ctx)).resolves.toBe(true);
    expect(request.orgId).toBe('org-1');
  });

  it('rejects a missing Authorization header with 401', async () => {
    const { ctx } = contextWith(undefined);
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects a non-bearer scheme without calling the resolver', async () => {
    const { ctx } = contextWith('Basic dXNlcjpwYXNz');
    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(resolve).not.toHaveBeenCalled();
  });

  it('rejects an unknown credential with 401 and leaves no org on the request', async () => {
    resolve.mockResolvedValue(null);
    const { ctx, request } = contextWith('Bearer nope');

    await expect(guard.canActivate(ctx)).rejects.toBeInstanceOf(
      UnauthorizedException,
    );
    expect(request.orgId).toBeUndefined();
  });
});
