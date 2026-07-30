import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import { RawResponse } from './raw-response.decorator';

@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const raw = this.reflector.getAllAndOverride(RawResponse, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (raw) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => ({
        data,
        meta: { at: new Date().toISOString() },
      })),
    );
  }
}
