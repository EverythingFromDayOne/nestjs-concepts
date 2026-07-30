import { Injectable, OnModuleInit } from '@nestjs/common';
import { loadSchemaFrom } from './load-schema';

@Injectable()
export class SchemaCache implements OnModuleInit {
  private schema: { ok: true } | undefined;

  async onModuleInit(): Promise<void> {
    this.schema = await loadSchemaFrom('local://schema');
    // eslint-disable-next-line no-console
    console.log('SchemaCache ready');
  }

  get(): { ok: true } {
    if (!this.schema) {
      throw new Error('SchemaCache not initialized');
    }
    return this.schema;
  }
}
