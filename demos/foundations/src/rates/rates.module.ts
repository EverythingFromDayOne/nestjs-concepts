import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { EXCHANGE_RATES, RATE_TABLE, RateTable } from './rates.tokens';
import { RatesService } from './rates.service';

const STATIC_TABLES: Record<string, RateTable> = {
  test: { USD: 1, EUR: 1, VND: 1 },
  default: { USD: 1, EUR: 0.92, VND: 26150 },
};

@Module({
  imports: [ConfigModule],
  providers: [
    RatesService,
    {
      provide: EXCHANGE_RATES,
      useFactory: async (config: ConfigService): Promise<RateTable> => {
        const url = config.get('RATES_URL');
        if (!url) {
          return STATIC_TABLES.default;
        }
        const response = await fetch(url);
        return (await response.json()) as RateTable;
      },
      inject: [ConfigService],
    },
    { provide: RATE_TABLE, useExisting: EXCHANGE_RATES }, // ← alias, same instance
  ],
  exports: [RatesService, EXCHANGE_RATES, RATE_TABLE],
})
export class RatesModule {}
