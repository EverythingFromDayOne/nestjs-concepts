import { NestFactory } from '@nestjs/core';
import { ContextIdFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { TenantContextIdStrategy } from './audit/tenant.strategy';

async function bootstrap(): Promise<void> {
  ContextIdFactory.apply(new TenantContextIdStrategy());
  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  app.enableShutdownHooks();
  await app.listen(3000);
}

void bootstrap();
