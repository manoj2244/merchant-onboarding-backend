import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Role } from '../../users/role.enum';
import { RolesGuard } from './roles.guard';

describe('RolesGuard', () => {
  const contextFor = (user: { role: Role } | undefined): ExecutionContext =>
    ({
      getHandler: () => undefined,
      getClass: () => undefined,
      switchToHttp: () => ({ getRequest: () => ({ user }) }),
    }) as unknown as ExecutionContext;

  const guardRequiring = (roles: Role[] | undefined) => {
    const reflector = { getAllAndOverride: jest.fn().mockReturnValue(roles) } as unknown as Reflector;
    return new RolesGuard(reflector);
  };

  it('allows any authenticated user when no roles are declared', () => {
    expect(guardRequiring(undefined).canActivate(contextFor({ role: Role.SALES }))).toBe(true);
  });

  it('allows a user whose role is listed', () => {
    expect(guardRequiring([Role.ADMIN, Role.SALES]).canActivate(contextFor({ role: Role.SALES }))).toBe(true);
  });

  it('forbids a user whose role is not listed', () => {
    expect(() => guardRequiring([Role.REVIEWER]).canActivate(contextFor({ role: Role.SALES }))).toThrow(ForbiddenException);
  });

  it('forbids when there is no user on the request', () => {
    expect(() => guardRequiring([Role.ADMIN]).canActivate(contextFor(undefined))).toThrow(ForbiddenException);
  });
});
