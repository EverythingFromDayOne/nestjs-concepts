import { NestFactory } from '@nestjs/core';
import { ContextIdFactory } from '@nestjs/core';
import { AppModule } from '../src/app.module';
import { TenantContextIdStrategy } from '../src/audit/tenant.strategy';

async function main(): Promise<void> {
  ContextIdFactory.apply(new TenantContextIdStrategy());
  try {
    const app = await NestFactory.create(AppModule);
    console.log('STARTED_UNEXPECTEDLY');
    await app.close();
  } catch (error) {
    console.log('CAUGHT_TYPE', error instanceof Error ? error.constructor.name : typeof error);
    console.log('CAUGHT_MESSAGE', error instanceof Error ? error.message : String(error));
    console.log('CAUGHT_STACK_HEAD', error instanceof Error ? error.stack?.split('\n').slice(0, 8).join('\n') : '');
    process.exitCode = 1;
  }
}

void main();
