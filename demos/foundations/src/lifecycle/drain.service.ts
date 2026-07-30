import {
  BeforeApplicationShutdown,
  Injectable,
  OnApplicationShutdown,
  OnModuleDestroy,
} from '@nestjs/common';

@Injectable()
export class DrainService
  implements OnModuleDestroy, BeforeApplicationShutdown, OnApplicationShutdown
{
  onModuleDestroy(): void {
    // eslint-disable-next-line no-console
    console.log('DrainService onModuleDestroy');
  }

  beforeApplicationShutdown(signal?: string): void {
    // eslint-disable-next-line no-console
    console.log(`DrainService beforeApplicationShutdown signal=${signal ?? '-'}`);
  }

  onApplicationShutdown(signal?: string): void {
    // eslint-disable-next-line no-console
    console.log(`DrainService onApplicationShutdown signal=${signal ?? '-'}`);
  }
}
