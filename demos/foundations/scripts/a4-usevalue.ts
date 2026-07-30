import { Inject, Injectable, Optional } from '@nestjs/common';
import { Test } from '@nestjs/testing';

const T1 = Symbol('T1');

@Injectable()
class Probe {
  constructor(@Optional() @Inject(T1) readonly t1: unknown) {}
}

async function main(): Promise<void> {
  const moduleRef = await Test.createTestingModule({
    providers: [Probe, { provide: T1, useValue: undefined }],
  }).compile();
  const probe = moduleRef.get(Probe);
  console.log('useValue_undefined_injected', probe.t1 === undefined, probe.t1);
}

void main();
