import { ContextIdFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AuditService } from '../src/audit/audit.service';

async function main(): Promise<void> {
  const moduleRef = await Test.createTestingModule({
    providers: [AuditService],
  }).compile();

  try {
    const value = moduleRef.get(AuditService);
    console.log('GET_UNEXPECTED', value);
  } catch (error) {
    console.log('GET_ERROR', error instanceof Error ? error.message : String(error));
  }

  const contextId = ContextIdFactory.create();
  const resolved = await moduleRef.resolve(AuditService, contextId);
  resolved.record('ok');
  console.log('RESOLVE_OK', resolved.flush());
}

void main();
