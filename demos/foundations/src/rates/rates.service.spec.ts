import { Test } from '@nestjs/testing';
import { RatesService } from './rates.service';
import { EXCHANGE_RATES } from './rates.tokens';

describe('RatesService', () => {
  it('converts using the injected table', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RatesService,
        { provide: EXCHANGE_RATES, useValue: { EUR: 0.5 } },
      ],
    }).compile();

    expect(moduleRef.get(RatesService).convert(100, 'EUR')).toBe(50);
  });
});
