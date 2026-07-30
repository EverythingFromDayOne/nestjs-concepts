import { ContextIdFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  it('gives each context its own instance', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [AuditService],
    }).compile();

    const first = ContextIdFactory.create();
    const second = ContextIdFactory.create();

    const a = await moduleRef.resolve(AuditService, first);
    const b = await moduleRef.resolve(AuditService, second);
    const aAgain = await moduleRef.resolve(AuditService, first);

    a.record('one');

    expect(a).not.toBe(b);
    expect(aAgain).toBe(a); // same context → same instance
    expect(b.flush()).toEqual([]); // no leakage across contexts
  });
});
