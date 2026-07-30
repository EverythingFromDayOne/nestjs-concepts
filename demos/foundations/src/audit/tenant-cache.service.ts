import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';

@Injectable({ scope: Scope.REQUEST, durable: true })
export class TenantCacheService {
  // ✗ NOT the HTTP request — in a durable tree this is contextId.payload
  constructor(@Inject(REQUEST) private readonly payload: { tenantId: string }) {}

  get tenantId(): string {
    return this.payload.tenantId;
  }
}
