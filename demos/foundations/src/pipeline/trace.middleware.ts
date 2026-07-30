import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TraceService } from './trace.service';

@Injectable()
export class TraceMiddleware implements NestMiddleware {
  constructor(private readonly trace: TraceService) {}

  use(_req: Request, _res: Response, next: NextFunction): void {
    this.trace.mark('middleware');
    next();
  }
}
