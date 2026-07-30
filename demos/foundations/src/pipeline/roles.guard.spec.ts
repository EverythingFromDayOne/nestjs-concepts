import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { Roles } from './public.decorator';

function contextFor(handler: () => void, user?: { id: string; roles: string[] }): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => class Dummy {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows a handler with no roles declared', () => {
    const handler = (): void => {};
    expect(guard.canActivate(contextFor(handler))).toBe(true);
  });

  it('refuses when the user lacks the role', () => {
    class Controller {
      @Roles(['admin'])
      handler(): void {}
    }
    const handler = Controller.prototype.handler;
    expect(() => guard.canActivate(contextFor(handler, { id: '1', roles: ['viewer'] }))).toThrow();
  });
});
