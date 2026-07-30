import { Module } from '@nestjs/common';
import { AuditController } from './audit.controller';
import { AuditService } from './audit.service';
import { ContextualLogger } from './contextual.logger';
import { ScopeReport } from './scope-report';
import { TenantCacheService } from './tenant-cache.service';

@Module({
  controllers: [AuditController],
  providers: [
    AuditService,
    ContextualLogger,
    TenantCacheService,
    ScopeReport,
  ],
})
export class AuditModule {}
