import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, of, tap } from 'rxjs';

@Injectable()
export class TinyCacheInterceptor implements NestInterceptor {
  private readonly store = new Map<string, unknown>();

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.method !== 'GET') {
      return next.handle();
    }

    const key = request.originalUrl;
    if (this.store.has(key)) {
      return of(this.store.get(key));       // ← handle() never called
    }

    return next.handle().pipe(tap((value) => this.store.set(key, value)));
  }
}
