import { NestFactory } from '@nestjs/core';
import { ContextIdFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { TenantContextIdStrategy } from '../src/audit/tenant.strategy';

async function main(): Promise<void> {
  ContextIdFactory.apply(new TenantContextIdStrategy());
  const withHooks = process.env.WITH_SHUTDOWN_HOOKS !== '0';
  const app = await NestFactory.create(AppModule, { bufferLogs: true, logger: ['log', 'error', 'warn'] });
  if (withHooks) {
    app.enableShutdownHooks();
  }
  await app.listen(0);
  console.log('L5_closing withHooks=', withHooks);
  await app.close();
  console.log('L5_closed');
}

void main();
