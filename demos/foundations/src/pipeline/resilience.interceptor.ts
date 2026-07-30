import {
  CallHandler, ExecutionContext, Injectable, NestInterceptor, RequestTimeoutException,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, TimeoutError, catchError, identity, retry, throwError, timeout } from 'rxjs';

@Injectable()
export class ResilienceInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const isIdempotent = request.method === 'GET' || request.method === 'HEAD';

    return next.handle().pipe(
      timeout(5_000),
      isIdempotent ? retry({ count: 2, delay: 200 }) : identity,
      catchError((error) =>
        throwError(() =>
          error instanceof TimeoutError ? new RequestTimeoutException() : error,
        ),
      ),
    );
  }
}
