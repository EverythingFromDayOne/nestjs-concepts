import { NestFactory } from '@nestjs/core';
import { ContextIdFactory } from '@nestjs/core';
import { ConfigService } from '@nestjs/config';
import { AppModule } from '../src/app.module';
import { TenantContextIdStrategy } from '../src/audit/tenant.strategy';

async function main(): Promise<void> {
  ContextIdFactory.apply(new TenantContextIdStrategy());
  const app = await NestFactory.create(AppModule, { logger: false });
  const config = app.get(ConfigService);
  try {
    config.getOrThrow('THIS_KEY_DOES_NOT_EXIST');
  } catch (error) {
    console.log('C7_ERROR', error instanceof Error ? error.message : String(error));
  }
  await app.close();
}

void main();
