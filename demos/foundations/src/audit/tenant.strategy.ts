import {
  ContextId,
  ContextIdFactory,
  ContextIdStrategy,
  HostComponentInfo,
} from '@nestjs/core';
import type { Request } from 'express';

const tenants = new Map<string, ContextId>();

export class TenantContextIdStrategy implements ContextIdStrategy<Request> {
  attach(contextId: ContextId, request: Request) {
    const tenantId = (request.headers['x-tenant-id'] as string) ?? 'public';

    let tenantSubTreeId = tenants.get(tenantId);
    if (!tenantSubTreeId) {
      tenantSubTreeId = ContextIdFactory.create();
      tenants.set(tenantId, tenantSubTreeId);
    }

    return {
      payload: { tenantId },
      // durable sub-trees resolve into the tenant's shared context;
      // everything else stays per-request
      resolve: (info: HostComponentInfo) =>
        info.isTreeDurable ? tenantSubTreeId! : contextId,
    };
  }
}
