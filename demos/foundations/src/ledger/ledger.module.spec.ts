import { Test } from '@nestjs/testing';
import { BillingService } from '../billing/billing.service';
import { OrdersService } from '../orders/orders.service';
import { BillingModule } from '../billing/billing.module';
import { OrdersModule } from '../orders/orders.module';

describe('module graph', () => {
  it('shares one LedgerService across importing modules', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [OrdersModule, BillingModule],
    }).compile();

    moduleRef.get(OrdersService).place('acme', 250);

    expect(moduleRef.get(BillingService).balanceFor('acme')).toBe(250);
  });
});
