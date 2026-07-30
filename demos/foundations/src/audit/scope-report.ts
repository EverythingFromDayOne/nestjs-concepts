import { Injectable, OnApplicationBootstrap } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AuditService } from './audit.service';
import { CatalogService } from '../catalog/catalog.service';

@Injectable()
export class ScopeReport implements OnApplicationBootstrap {
  constructor(private readonly moduleRef: ModuleRef) {}

  onApplicationBootstrap(): void {
    // Article 06 loops `[AuditService, CatalogService]` into `introspect(token)`;
    // under strict that union is not assignable to `Type<T>`. Split calls.
    console.log('AuditService', this.moduleRef.introspect(AuditService).scope);
    console.log('CatalogService', this.moduleRef.introspect(CatalogService).scope);
  }
}
