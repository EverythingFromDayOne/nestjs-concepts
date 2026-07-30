import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { TraceService } from './trace.service';

@Injectable()
export class TraceInterceptor implements NestInterceptor {
  constructor(private readonly trace: TraceService) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    this.trace.mark('interceptor:before');
    const startedAt = Date.now();

    return next.handle().pipe(
      tap(() => this.trace.mark(`interceptor:after (${Date.now() - startedAt}ms)`)),
      catchError((error) => {
        this.trace.mark(`interceptor:caught ${error.constructor.name}`);
        return throwError(() => error);
      }),
    );
  }
}
