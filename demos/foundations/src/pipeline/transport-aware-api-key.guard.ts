import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class TransportAwareApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const key = this.extractKey(context);
    if (!key) {
      throw new UnauthorizedException('Missing API key');
    }
    return true;
  }

  private extractKey(context: ExecutionContext): string | undefined {
    switch (context.getType()) {
      case 'http': {
        const request = context.switchToHttp().getRequest<Request>();
        const header = request.headers['x-api-key'];
        return typeof header === 'string' ? header : undefined;
      }
      case 'ws': {
        const data = context.switchToWs().getData<{ apiKey?: string }>();
        return data?.apiKey;
      }
      default:
        return undefined;      // ← unknown transport: deny, don't guess
    }
  }
}
