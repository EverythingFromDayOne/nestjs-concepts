import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { LedgerModule } from '../ledger/ledger.module';
import { OrdersService } from './orders.service';

@Module({
  imports: [LedgerModule, BillingModule],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
