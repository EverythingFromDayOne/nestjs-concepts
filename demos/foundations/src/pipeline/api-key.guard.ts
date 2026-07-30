import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers['x-api-key'];

    if (typeof provided !== 'string') {
      throw new UnauthorizedException('Missing API key');
    }
    if (provided !== this.config.getOrThrow<string>('API_KEY')) {
      throw new ForbiddenException('API key not permitted here');
    }
    return true;
  }
}
