import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

@Catch(BadRequestException)
export class RouteOnlyFilter implements ExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Response>()
      .status(400)
      .json({ handledBy: 'RouteOnlyFilter' });
  }
}
