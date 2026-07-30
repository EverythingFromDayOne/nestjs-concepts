import { NestFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { ContextIdFactory } from '@nestjs/core';
import { TenantContextIdStrategy } from '../src/audit/tenant.strategy';

async function main(): Promise<void> {
  ContextIdFactory.apply(new TenantContextIdStrategy());
  const t0 = Date.now();
  const app = await NestFactory.create(AppModule, { logger: false });
  const ms = Date.now() - t0;
  console.log(`NestFactory.create_ms=${ms}`);
  await app.close();
}

void main();
