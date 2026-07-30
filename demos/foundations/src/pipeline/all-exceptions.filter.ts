import {
  ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

// ✓ own the response and own the logging explicitly
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request & { correlationId?: string }>();

    if (response.headersSent) {
      response.end();
      return;
    }

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl} cid=${request.correlationId ?? '-'}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    response.status(status).json({
      statusCode: status,
      message: exception instanceof HttpException ? exception.getResponse() : 'Internal server error',
      correlationId: request.correlationId,
    });
  }
}
