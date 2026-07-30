import { NestFactory } from '@nestjs/core';
import { ContextIdFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { TenantContextIdStrategy } from '../src/audit/tenant.strategy';
import { FirstService } from '../src/lifecycle/first.service';

async function main(): Promise<void> {
  ContextIdFactory.apply(new TenantContextIdStrategy());
  const app = await NestFactory.create(AppModule, { bufferLogs: true, logger: ['error', 'warn', 'log'] });
  const first = app.get(FirstService);
  console.log('L1_before_listen_ready', first.isReady());
  await app.listen(0);
  console.log('L1_after_listen_ready', first.isReady());
  await app.close();
}

void main();
