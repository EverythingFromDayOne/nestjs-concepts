import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';

@Module({
  providers: [LedgerService],
  exports: [LedgerService], // ← the module's public API
})
export class LedgerModule {}
