import { NestFactory } from '@nestjs/core';
import { ContextIdFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../src/app.module';
import { TenantContextIdStrategy } from '../src/audit/tenant.strategy';

async function main(): Promise<void> {
  ContextIdFactory.apply(new TenantContextIdStrategy());
  const app = await NestFactory.create(AppModule, { logger: false });
  const config = app.get(ConfigService);
  console.log('NOTIFY_MODE', config.get('NOTIFY_MODE'));
  console.log('PORT', config.get('PORT'));
  console.log('DATABASE_PASSWORD_SET', !!config.get('DATABASE_PASSWORD'));
  await app.close();
}

void main();
