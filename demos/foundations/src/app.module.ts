import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { AuditModule } from './audit/audit.module';
import { BillingModule } from './billing/billing.module';
import { CatalogModule } from './catalog/catalog.module';
import { CatsController } from './cats/cats.controller';
import { CatsService } from './cats/cats.service';
import { validateEnv } from './config/env.validation';
import notificationsConfig from './config/notifications.config';
import { LifecycleModule } from './lifecycle/lifecycle.module';
import { NotificationsModule } from './notifications/notifications.module';
import { OrdersController } from './orders/orders.controller';
import { OrdersModule } from './orders/orders.module';
import { PipelineModule } from './pipeline/pipeline.module';
import { RatesModule } from './rates/rates.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: ['.env.local', '.env'],
      cache: true,
      validate: validateEnv,
      load: [notificationsConfig],
    }),
    NotificationsModule,
    OrdersModule,
    BillingModule,
    CatalogModule,
    RatesModule,
    AuditModule,
    LifecycleModule,
    PipelineModule,
  ],
  controllers: [CatsController, OrdersController],
  providers: [CatsService],
})
export class AppModule {}
