import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

export const CORRELATION_HEADER = 'x-correlation-id';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[CORRELATION_HEADER];
    const correlationId = typeof incoming === 'string' && incoming.length > 0
      ? incoming
      : randomUUID();

    (req as Request & { correlationId?: string }).correlationId = correlationId;
    res.setHeader(CORRELATION_HEADER, correlationId);
    next();
  }
}
