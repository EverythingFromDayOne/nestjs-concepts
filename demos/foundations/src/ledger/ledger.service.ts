import { Injectable } from '@nestjs/common';

@Injectable()
export class LedgerService {
  private readonly entries: Array<{ account: string; amount: number }> = [];

  record(account: string, amount: number): void {
    this.entries.push({ account, amount });
  }

  balance(account: string): number {
    return this.entries
      .filter((entry) => entry.account === account)
      .reduce((total, entry) => total + entry.amount, 0);
  }
}
