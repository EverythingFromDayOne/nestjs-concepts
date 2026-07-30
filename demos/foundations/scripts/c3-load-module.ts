try {
  // Force evaluation of AppModule (and ConfigModule.forRoot) under current cwd.
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  require('../src/app.module');
  console.log('MODULE_LOADED');
} catch (error) {
  console.log('C3_ERROR_NAME', error instanceof Error ? error.constructor.name : typeof error);
  console.log('C3_ERROR_MESSAGE');
  console.log(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
}
