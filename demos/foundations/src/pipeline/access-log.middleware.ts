import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

@Injectable()
export class AccessLogMiddleware implements NestMiddleware {
  private readonly logger = new Logger('access');

  use(req: Request, res: Response, next: NextFunction): void {
    const startedAt = Date.now();
    const { correlationId } = req as Request & { correlationId?: string };

    res.on('finish', () => {
      this.logger.log(
        `${req.method} ${req.originalUrl} ${res.statusCode} ` +
          `${Date.now() - startedAt}ms cid=${correlationId ?? '-'}`,
      );
    });

    next();
  }
}
