import 'reflect-metadata';
import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const valid = {
    NOTIFY_MODE: 'console',
    PORT: '3000',
    DATABASE_PASSWORD: 'hunter2',
    RATES_URL: 'http://localhost:9000/rates',
    API_KEY: 'demo-key',
  };

  it('coerces and accepts a valid environment', () => {
    expect(validateEnv(valid).PORT).toBe(3000); // string → number
  });

  it('rejects a missing required variable', () => {
    const { DATABASE_PASSWORD, ...incomplete } = valid;
    expect(() => validateEnv(incomplete)).toThrow(/DATABASE_PASSWORD/);
  });

  it('rejects an out-of-range port', () => {
    expect(() => validateEnv({ ...valid, PORT: '70000' })).toThrow(/PORT/);
  });
});
