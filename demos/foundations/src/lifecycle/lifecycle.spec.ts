import { Test } from '@nestjs/testing';
import { FirstService } from './first.service';
import { LifecycleModule } from './lifecycle.module';
import { SecondService } from './second.service';

describe('lifecycle hooks', () => {
  it('does not run onModuleInit until init()', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [LifecycleModule],
    }).compile();

    expect(moduleRef.get(FirstService).isReady()).toBe(false);

    await moduleRef.init();
    expect(moduleRef.get(FirstService).isReady()).toBe(true);
    await moduleRef.get(FirstService).whenReady();
    expect(moduleRef.get(SecondService)).toBeDefined();
    await moduleRef.close();
  });
});
