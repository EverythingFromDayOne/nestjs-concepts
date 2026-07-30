import { Module, OnModuleInit } from '@nestjs/common';
import { DrainService } from './drain.service';
import { FirstService } from './first.service';
import { SchemaCache } from './schema-cache';
import { SecondService } from './second.service';

@Module({
  providers: [SchemaCache, FirstService, SecondService, DrainService],
  exports: [FirstService, SecondService, DrainService, SchemaCache],
})
export class LifecycleModule implements OnModuleInit {
  onModuleInit(): void {
    // eslint-disable-next-line no-console
    console.log('LifecycleModule init');
  }
}
