import { Inject, Injectable } from '@nestjs/common';
import { EXCHANGE_RATES, RateTable } from './rates.tokens';

@Injectable()
export class RatesService {
  constructor(@Inject(EXCHANGE_RATES) private readonly rates: RateTable) {}

  convert(amount: number, currency: string): number {
    const rate = this.rates[currency];
    if (rate === undefined) {
      throw new Error(`No rate for ${currency}`);
    }
    return amount * rate;
  }
}
