import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Public, Roles } from './public.decorator';

interface AuthenticatedRequest extends Request {
  user?: { id: string; roles: string[] };
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride(Public, targets)) {
      return true;                                   // ← the escape hatch
    }

    const required = this.reflector.getAllAndOverride(Roles, targets);
    if (!required?.length) {
      return true;                                   // no roles declared → no restriction
    }

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user) {
      throw new ForbiddenException('Not authenticated');
    }
    if (!required.some((role) => user.roles.includes(role))) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
