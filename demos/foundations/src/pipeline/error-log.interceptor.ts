import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, catchError, throwError } from 'rxjs';

@Injectable()
export class ErrorLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger('errors');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        const request = context.switchToHttp().getRequest<Request & { correlationId?: string }>();
        this.logger.error(
          `${request.method} ${request.originalUrl} cid=${request.correlationId ?? '-'}`,
          error instanceof Error ? error.stack : String(error),
        );
        return throwError(() => error);   // ← re-throw; do not swallow
      }),
    );
  }
}
