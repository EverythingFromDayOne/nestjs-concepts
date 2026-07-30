import { ExecutionContext } from '@nestjs/common';
import { firstValueFrom, of } from 'rxjs';
import { TinyCacheInterceptor } from './cache.interceptor';

describe('TinyCacheInterceptor', () => {
  const contextFor = (url: string, method = 'GET'): ExecutionContext =>
    ({
      switchToHttp: () => ({ getRequest: () => ({ originalUrl: url, method }) }),
    }) as unknown as ExecutionContext;

  it('does not invoke the handler on a cache hit', async () => {
    const interceptor = new TinyCacheInterceptor();
    let calls = 0;
    const next = { handle: () => { calls += 1; return of('value'); } };

    await firstValueFrom(interceptor.intercept(contextFor('/x'), next));
    await firstValueFrom(interceptor.intercept(contextFor('/x'), next));

    expect(calls).toBe(1);          // ← the deferral, asserted
  });
});
