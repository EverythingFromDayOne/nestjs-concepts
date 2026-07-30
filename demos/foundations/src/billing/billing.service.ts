import { Injectable } from '@nestjs/common';
import { LedgerService } from '../ledger/ledger.service';

@Injectable()
export class BillingService {
  constructor(private readonly ledger: LedgerService) {}

  balanceFor(account: string): number {
    return this.ledger.balance(account);
  }
}
