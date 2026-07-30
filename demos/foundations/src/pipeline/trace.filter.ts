import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { TraceService } from './trace.service';

@Catch(HttpException)
export class TraceFilter implements ExceptionFilter {
  constructor(private readonly trace: TraceService) {}

  catch(exception: HttpException, host: ArgumentsHost): void {
    this.trace.mark('filter');
    const response = host.switchToHttp().getResponse<Response>();
    response.status(exception.getStatus()).json({
      message: exception.message,
      trace: this.trace.drain(),
    });
  }
}
