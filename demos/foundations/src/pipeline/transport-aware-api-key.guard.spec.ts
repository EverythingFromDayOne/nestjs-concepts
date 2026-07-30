import { TransportAwareApiKeyGuard } from './transport-aware-api-key.guard';
import { httpContext } from './context-double';

describe('TransportAwareApiKeyGuard', () => {
  const guard = new TransportAwareApiKeyGuard();

  it('accepts an http request with the header', () => {
    const context = httpContext({ request: { headers: { 'x-api-key': 'k' } } });
    expect(guard.canActivate(context)).toBe(true);
  });

  it('denies an unknown transport rather than assuming http', () => {
    const context = httpContext({ request: {}, type: 'rpc' });
    expect(() => guard.canActivate(context)).toThrow();
  });
});
