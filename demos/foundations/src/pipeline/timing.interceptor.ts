import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, finalize } from 'rxjs';

@Injectable()
export class TimingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('timing');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const startedAt = Date.now();
    const handler = `${context.getClass().name}.${context.getHandler().name}`;

    return next.handle().pipe(
      finalize(() => this.logger.log(`${handler} ${Date.now() - startedAt}ms`)),
    );
  }
}
