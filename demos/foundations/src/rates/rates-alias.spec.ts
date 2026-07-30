import { Inject, Injectable } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { EXCHANGE_RATES, RATE_TABLE, RateTable } from './rates.tokens';

@Injectable()
class AliasProbe {
  constructor(
    @Inject(EXCHANGE_RATES) readonly exchangeRates: RateTable,
    @Inject(RATE_TABLE) readonly rateTable: RateTable,
  ) {}
}

describe('RATE_TABLE useExisting alias', () => {
  it('resolves both tokens to the same instance', async () => {
    const table = { USD: 1, EUR: 0.92 };
    const moduleRef = await Test.createTestingModule({
      providers: [
        AliasProbe,
        { provide: EXCHANGE_RATES, useValue: table },
        { provide: RATE_TABLE, useExisting: EXCHANGE_RATES },
      ],
    }).compile();

    const probe = moduleRef.get(AliasProbe);
    expect(probe.rateTable).toBe(probe.exchangeRates);
  });
});
