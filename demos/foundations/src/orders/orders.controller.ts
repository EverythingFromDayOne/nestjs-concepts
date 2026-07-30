import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { BillingService } from '../billing/billing.service';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly billing: BillingService,
  ) {}

  @Post()
  place(@Body() body: { account: string; amount: number }): void {
    this.orders.place(body.account, body.amount);
  }

  @Get(':account/balance')
  balance(@Param('account') account: string): { balance: number } {
    return { balance: this.billing.balanceFor(account) };
  }
}
