export const EXCHANGE_RATES = Symbol('EXCHANGE_RATES');
/** @deprecated use EXCHANGE_RATES — removal planned for the next release */
export const RATE_TABLE = Symbol('RATE_TABLE');

export interface RateTable {
  // `| undefined` is load-bearing under `strict`: without it, `rates[x]` is
  // typed `number` and the missing-key guard below is a compile error.
  readonly [currency: string]: number | undefined;
}

export const RATE_SOURCE = Symbol('RATE_SOURCE');

export abstract class RateSource {
  abstract load(): Promise<RateTable>;
}
