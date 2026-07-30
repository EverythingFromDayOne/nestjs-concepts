import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { BillingService } from './billing.service';

@Module({
  imports: [LedgerModule],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
