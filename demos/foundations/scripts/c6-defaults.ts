async function main(): Promise<void> {
  delete process.env.FEATURE_FLAG;
  delete process.env.OBJECT_DEFAULT;

  const { NestFactory } = await import('@nestjs/core');
  const { ContextIdFactory } = await import('@nestjs/core');
  const { TenantContextIdStrategy } = await import('../src/audit/tenant.strategy');
  ContextIdFactory.apply(new TenantContextIdStrategy());

  // Import AppModule only after clearing env keys so forRoot assignVariablesToProcess can write defaults.
  const { AppModule } = await import('../src/app.module');
  const app = await NestFactory.create(AppModule, { logger: false });
  console.log('process.env.FEATURE_FLAG', process.env.FEATURE_FLAG);
  console.log('process.env.OBJECT_DEFAULT', process.env.OBJECT_DEFAULT);
  await app.close();
}

void main();
