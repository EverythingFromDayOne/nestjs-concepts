import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { TraceService } from './trace.service';

@Injectable()
export class TraceGuard implements CanActivate {
  constructor(private readonly trace: TraceService) {}

  canActivate(context: ExecutionContext): boolean {
    this.trace.mark('guard');
    const request = context.switchToHttp().getRequest<Request>();
    if (request.query.deny === '1') {
      throw new ForbiddenException('denied by TraceGuard');
    }
    return true;
  }
}
