import { Injectable } from '@nestjs/common';
import { LedgerService } from '../ledger/ledger.service';

@Injectable()
export class OrdersService {
  constructor(private readonly ledger: LedgerService) {}

  place(account: string, amount: number): void {
    this.ledger.record(account, amount);
  }
}
