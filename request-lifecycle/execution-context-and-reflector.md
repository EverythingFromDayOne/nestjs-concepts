---
article_id: execution-context-and-reflector
description: The execution context is a typed view over one arguments array, so switching it to the wrong transport fails silently
concept_folder: request-lifecycle
wave: 1
nest_baseline: "11.1.x"
node_baseline: "24"
related:
  - request-lifecycle/execution-order
  - request-lifecycle/guards
  - request-lifecycle/interceptors
  - request-lifecycle/exception-filters
  - foundations/decorators-and-metadata-reflection
  - recipes/request-lifecycle/getting-metadata-inside-a-filter
status:
  drafted: true
  reviewed: false
v12_watch: false
---

# Execution context and Reflector

> **Lead with this.** `ExecutionContext` reads like an abstraction over transports. It isn't. It's a **typed view over one array of arguments**, and `switchToHttp()` doesn't convert anything — it bolts three accessor methods onto the host object and hands the same object back. Two consequences follow immediately. Calling the *wrong* `switchTo*` succeeds silently: `switchToWs()` on an HTTP request returns the request from `getClient()` and the response from `getData()`, with no error and no clue. And the context you actually receive differs by layer in ways the type signatures only half-tell you — `getClass()` and `getHandler()` are declared non-null but back onto fields that default to `null`, so in a filter they don't fail to exist, they return `null` and crash on the next property access.

## What it is

Two interfaces, one narrower than the other:

```typescript
interface ArgumentsHost {
  getType<T extends string>(): T;
  getArgs<T extends Array<any>>(): T;
  getArgByIndex<T>(index: number): T;
  switchToRpc(): RpcArgumentsHost;
  switchToHttp(): HttpArgumentsHost;
  switchToWs(): WsArgumentsHost;
}

interface ExecutionContext extends ArgumentsHost {
  getClass<T>(): Type<T>;
  getHandler(): Function;
}
```

`ExecutionContext` adds the two methods that make metadata possible — the handler and the class are what `Reflector` reads from. Which layer gets which is not uniform:

| Layer | Receives | So it can |
| --- | --- | --- |
| middleware | nothing — plain `(req, res, next)` | read the request; **no** metadata, **no** transport abstraction |
| **guard** | `ExecutionContext` | everything: request, metadata, transport |
| **interceptor** | `ExecutionContext` | everything, on both sides of the handler |
| pipe | `ArgumentMetadata` — **not a context at all** | see one argument and its declared type |
| filter | `ArgumentsHost` | read the transport args; **no** metadata |

That table is the practical content of the whole `request-lifecycle/` folder in one place. If a cross-cutting concern needs handler metadata, it has exactly two homes: a guard or an interceptor.

`Reflector` is the other half. Its mechanics — `SetMetadata`, `createDecorator`, `getAllAndOverride` versus `getAllAndMerge`, the precedence trap — belong to [article 04](../foundations/decorators-and-metadata-reflection.md). What this article owns is where the *targets* come from, and what to do when you're in a layer that has none.

> **If you know Angular.** Angular splits this into two unrelated objects and Nest fuses them, which is why the mapping feels off. `ActivatedRouteSnapshot` gives a guard the route config and its `data` — the metadata half — and it's a tree you can walk upward through `parent`. `HttpContext` gives an interceptor a typed key-value bag attached to one request — the per-request-state half — and it's deliberately *not* the request object. Nest's `ExecutionContext` is both at once, and it is neither a tree nor a bag: it is positional access to the framework's raw call arguments. Nothing to walk upward, and no typed slots — if you want per-request state, you attach it to the request yourself ([article 10](./middleware.md#step-1--a-correlation-id-and-why-it-has-to-be-here)) or use `AsyncLocalStorage`.

## How it works under the hood

### The whole class is accessors over one array

```typescript
// paraphrased from packages/core/helpers/execution-context-host.ts
export class ExecutionContextHost implements ExecutionContext {
  private contextType = 'http';                      // ← the default

  constructor(
    private readonly args: any[],
    private readonly constructorRef: Type<any> | null = null,
    private readonly handler: Function | null = null,
  ) {}

  getClass<T>(): Type<T> { return this.constructorRef!; }   // ← non-null assertion
  getHandler(): Function { return this.handler!; }          // ← over a nullable field

  getArgByIndex<T>(index: number): T { return this.args[index] as T; }

  switchToHttp(): HttpArgumentsHost {
    return Object.assign(this, {
      getRequest: () => this.getArgByIndex(0),
      getResponse: () => this.getArgByIndex(1),
      getNext: () => this.getArgByIndex(2),
    });
  }

  switchToWs(): WsArgumentsHost {
    return Object.assign(this, {
      getClient: () => this.getArgByIndex(0),
      getData: () => this.getArgByIndex(1),
      getPattern: () => this.getArgByIndex(this.getArgs().length - 1),
    });
  }

  switchToRpc(): RpcArgumentsHost {
    return Object.assign(this, {
      getData: () => this.getArgByIndex(0),
      getContext: () => this.getArgByIndex(1),
    });
  }
}
```

Everything interesting is in those thirty lines.

### `switchTo*` renames, it doesn't convert

All three methods are the same shape: `Object.assign(this, { …accessors… })`. So:

- **They mutate the host** and return it. After `switchToHttp()`, the host object permanently carries `getRequest`/`getResponse`/`getNext`. Call `switchToWs()` afterwards and it carries both sets at once.
- **They're just index aliases.** Index 0 is the request in HTTP, the client in WebSockets, the payload in RPC. Same slot, three names.
- **Using the wrong one succeeds.** `context.switchToWs().getClient()` on an HTTP request hands you the Express request typed as a socket, and `getData()` hands you the response typed as a payload. Nothing throws. Your code then fails somewhere else entirely, on a property that doesn't exist.

| Index | `switchToHttp()` | `switchToWs()` | `switchToRpc()` |
| --- | --- | --- | --- |
| 0 | `getRequest()` | `getClient()` | `getData()` |
| 1 | `getResponse()` | `getData()` | `getContext()` |
| 2 | `getNext()` | — | — |

The only safe way to write an enhancer for more than one transport is to branch on `getType()` **first** and call the matching `switchTo*` inside that branch.

### `getType()` defaults to `'http'`

`contextType` is initialised to `'http'` and each consumer overwrites it with `context.setType(type)` — guards, interceptors, and pipes all do this. A host constructed without that call therefore reports `'http'` whether or not it is. That matters in two places: hand-built hosts in tests, and the host `RouterProxy` builds for filters, which never calls `setType`. Treat `getType()` as authoritative only on contexts the framework typed.

### `getClass()` and `getHandler()` return `null`, not `undefined`, and lie about it

Look at the signatures again: `return this.constructorRef!` over a field declared `Type<any> | null = null`. The non-null assertion is a promise the class can't keep. From [article 14](./exception-filters.md#the-handler-is-wrapped-in-a-trycatch-that-discards-the-context), the filter host is built as `new ExecutionContextHost([req, res, next])` — both optional arguments omitted.

So the workaround people reach for when they want metadata inside a filter:

```typescript
// ✗ compiles, then throws at runtime
catch(exception: unknown, host: ArgumentsHost): void {
  const context = host as ExecutionContext;
  const handler = context.getHandler();          // null
  const meta = this.reflector.get(SOME_KEY, handler);   // TypeError on the next access
}
```

`getHandler()` returns `null`, and `Reflector.get(key, null)` or `handler.name` blows up. The cast type-checks because `ExecutionContextHost` *does* implement `ExecutionContext` — it's the same object either way. What's missing isn't the method, it's the data. §Step 3 covers what to do instead.

## Minimal shapes

```typescript
// guard or interceptor — full context
const request = context.switchToHttp().getRequest<Request>();
const roles = this.reflector.getAllAndOverride(Roles, [context.getHandler(), context.getClass()]);

// filter — args only
const response = host.switchToHttp().getResponse<Response>();
const status = host.getArgByIndex<Response>(1).statusCode;   // same object, two ways

// transport-agnostic — branch first
switch (context.getType()) {
  case 'http': return context.switchToHttp().getRequest().headers['x-tenant'];
  case 'ws':   return context.switchToWs().getData().tenant;
  case 'rpc':  return context.switchToRpc().getData().tenant;
}
```

## Walkthrough — reading the layer you're in

We extend the `pipeline/` module from articles 09–14.

### Step 1 — prove the per-layer table

The fastest way to internalise which layer has what is to try to read the handler name from each:

```typescript
// src/pipeline/context-probe.ts
import { Logger } from '@nestjs/common';

export function describeHandler(label: string, ctx: unknown): void {
  const candidate = ctx as { getHandler?: () => Function | null; getClass?: () => Function | null };
  const handler = candidate.getHandler?.() ?? null;
  const cls = candidate.getClass?.() ?? null;

  new Logger('context').log(
    `${label}: class=${cls?.name ?? 'none'} handler=${handler?.name ?? 'none'}`,
  );
}
```

Call it from a guard, an interceptor, and a filter on the same route:

```
context  guard:       class=PipelineController handler=run
context  interceptor: class=PipelineController handler=run
context  filter:      class=none handler=none
```

The filter line is the whole point, and it's why article 14's advice — put error observability in an interceptor — is a structural consequence rather than a preference. The interceptor knows what it wrapped; the filter doesn't.

Note the `?.()` and `?? null` in the probe. Without them this helper crashes on the filter, because `getHandler()` returns `null` rather than being absent.

### Step 2 — a transport-agnostic guard, done both ways

The version that looks reasonable and is wrong:

```typescript
// ✗ assumes HTTP, silently misreads everything else
canActivate(context: ExecutionContext): boolean {
  const request = context.switchToHttp().getRequest<Request>();
  return typeof request.headers['x-api-key'] === 'string';
}
```

Bound to a WebSocket gateway, `getRequest()` returns the **client socket**. `socket.headers` is `undefined`, so `typeof undefined === 'string'` is false, so every connection is rejected — and the guard looks correct in review.

```typescript
// src/pipeline/transport-aware-api-key.guard.ts
// ✓ branch on getType() first
// (article 11's ApiKeyGuard, made transport-aware — kept under a separate name
//  so the demo can hold both and you can diff them)
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';

@Injectable()
export class TransportAwareApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const key = this.extractKey(context);
    if (!key) {
      throw new UnauthorizedException('Missing API key');
    }
    return true;
  }

  private extractKey(context: ExecutionContext): string | undefined {
    switch (context.getType()) {
      case 'http': {
        const request = context.switchToHttp().getRequest<Request>();
        const header = request.headers['x-api-key'];
        return typeof header === 'string' ? header : undefined;
      }
      case 'ws': {
        const data = context.switchToWs().getData<{ apiKey?: string }>();
        return data?.apiKey;
      }
      default:
        return undefined;      // ← unknown transport: deny, don't guess
    }
  }
}
```

The `default` arm matters. Returning `undefined` for a transport you haven't handled means the guard denies rather than falls through to an HTTP assumption. Given `getType()` defaults to `'http'`, a guard that only handles `case 'http'` and has no default is indistinguishable from one that assumes HTTP.

### Step 3 — metadata in a filter, without the cast

The requirement is legitimate: "format this route's errors differently." Three real options, in order of preference.

**1. Read the metadata upstream and attach it.** An interceptor has the full context; the request survives into the filter:

```typescript
// src/pipeline/error-shape.interceptor.ts
export const ErrorShape = Reflector.createDecorator<string>();

@Injectable()
export class ErrorShapeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const shape = this.reflector.getAllAndOverride(ErrorShape, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (shape) {
      const request = context.switchToHttp().getRequest<Request & { errorShape?: string }>();
      request.errorShape = shape;              // ← the channel into the filter
    }
    return next.handle();
  }
}
```

```typescript
// in the filter
const { errorShape } = host.switchToHttp().getRequest<Request & { errorShape?: string }>();
```

Same untyped-request-mutation cost as [middleware](./middleware.md#step-1--a-correlation-id-and-why-it-has-to-be-here) — augment the type once rather than casting at each site.

**2. Bind a filter to the route.** If only one route needs a different shape, `@UseFilters(ThatFilter)` on the handler expresses it directly and needs no metadata at all. Keep it narrow — `@Catch(SpecificError)` — or it shadows the global filter ([article 14](./exception-filters.md#step-4--the-route-filter-that-blinds-the-global-one)).

**3. Throw a richer exception.** Often the real answer. If the handler knows the error needs a particular shape, `throw new OrderLockedException(id)` carries it in `getResponse()` and no filter needs to decide anything.

What isn't an option is the cast. It compiles, and it returns `null`.

### Step 4 — the `Reflector` call, and its two traps

Recapping the two rules from [article 04](../foundations/decorators-and-metadata-reflection.md#how-it-works-under-the-hood), because this is where they get used:

```typescript
const targets = [context.getHandler(), context.getClass()];   // ← handler first

// policy: the more specific declaration wins
const roles = this.reflector.getAllAndOverride(Roles, targets);

// accumulation: collect from both levels
const tags = this.reflector.getAllAndMerge(Tags, targets);
```

- **`[handler, class]`, in that order.** `getAllAndOverride` takes the first non-`undefined`, so reversing the array silently makes the controller outrank the method.
- **`getAllAndMerge` inverts for objects.** Arrays concatenate as you'd expect; object values spread later-target-wins, so with `[handler, class]` the class wins colliding keys. Use override for policy, and reverse the targets if you need handler-wins merging.

### Step 5 — testing, and the minimal double

Because the context is accessors over an array, a test double is however many of those accessors the code under test calls — usually two or three:

```typescript
// src/pipeline/context-double.ts
import { ExecutionContext } from '@nestjs/common';

export function httpContext(options: {
  request?: unknown;
  response?: unknown;
  handler?: Function;
  cls?: Function;
  type?: string;
}): ExecutionContext {
  const { request = {}, response = {}, handler = () => undefined, cls = class {}, type = 'http' } = options;
  return {
    getType: () => type,
    getArgs: () => [request, response, () => undefined],
    getArgByIndex: (i: number) => [request, response, () => undefined][i],
    getHandler: () => handler,
    getClass: () => cls,
    switchToHttp: () => ({ getRequest: () => request, getResponse: () => response, getNext: () => () => undefined }),
    switchToWs: () => ({ getClient: () => request, getData: () => response, getPattern: () => '' }),
    switchToRpc: () => ({ getData: () => request, getContext: () => response }),
  } as unknown as ExecutionContext;
}
```

```typescript
// src/pipeline/transport-aware-api-key.guard.spec.ts
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
```

The second test is the one worth writing, because the failure it protects against — a guard that silently assumes HTTP — is invisible in review and only appears when someone adds a gateway.

Building this helper once per repository beats hand-rolling a cast in every spec, and it keeps the doubles honest: if a test needs a method the helper doesn't have, that's a signal the code under test reaches further into the context than it should.

## Real-world patterns

**Branch on `getType()` before any `switchTo*`.** The wrong switch doesn't fail, it lies.

**Handle the `default` arm.** With `'http'` as the initialised value, an unhandled transport looks like HTTP.

**Metadata belongs to guards and interceptors.** Those are the only two layers with a handler. Everything else has to be told.

**Attach, don't cast.** Read metadata where the context is complete and put what's needed on the request; type the extension once.

**One context-double helper per repository.** And treat "the double needs another method" as a design signal.

**Prefer a narrow accessor over passing the context around.** A service that takes `ExecutionContext` is coupled to the transport layer forever; one that takes `{ userId, tenantId }` isn't. Extract at the edge.

**`getArgByIndex` is an escape hatch, not an interface.** It's correct for custom transports and wrong for HTTP, where `switchToHttp()` says what you mean.

## API reference

| Symbol | Import | Purpose |
| --- | --- | --- |
| `ArgumentsHost` | `@nestjs/common` | transport args only — what filters get |
| `ExecutionContext` | `@nestjs/common` | adds `getClass()` and `getHandler()` — guards and interceptors |
| `host.getType<T>()` | — | `'http' \| 'ws' \| 'rpc'` or custom; **defaults to `'http'`** |
| `host.switchToHttp()` | — | `getRequest`/`getResponse`/`getNext` over indices 0/1/2 |
| `host.switchToWs()` | — | `getClient`/`getData`/`getPattern` |
| `host.switchToRpc()` | — | `getData`/`getContext` |
| `host.getArgs()` / `getArgByIndex(i)` | — | the raw array; for custom transports |
| `context.getHandler()` | — | the method — **`null` in a filter** |
| `context.getClass()` | — | the controller — **`null` in a filter** |
| `Reflector` | `@nestjs/core` | `get`, `getAll`, `getAllAndOverride`, `getAllAndMerge`, `createDecorator` |
| `HttpAdapterHost` | `@nestjs/core` | adapter-agnostic `reply`/`isHeadersSent`, useful in filters |

## Common mistakes

**1. Calling the wrong `switchTo*`.** It succeeds and returns the right objects under the wrong names. Branch on `getType()`.

**2. Assuming HTTP with no `default` arm.** `getType()` starts as `'http'`, so an unhandled transport is indistinguishable from HTTP.

**3. Casting `ArgumentsHost` to `ExecutionContext` in a filter.** It compiles; `getHandler()` returns `null` and the next property access throws.

**4. Expecting `getHandler()` to be `undefined` when absent.** It's `null`, declared non-null. Optional chaining on the *call* doesn't help; guard the result.

**5. Trusting `getType()` on a hand-built host.** Only contexts the framework typed have had `setType()` called.

**6. `[class, handler]` target order.** Reverses metadata precedence silently.

**7. `getAllAndMerge` with object metadata.** The later target wins colliding keys, so `[handler, class]` lets the class override the handler.

**8. Passing `ExecutionContext` into a service.** Couples domain code to the transport. Extract the two fields it needs.

**9. Expecting a pipe to have a context.** Pipes get `ArgumentMetadata` — no request, no handler, no transport.

**10. Relying on `switchTo*` being pure.** It mutates the host by assigning accessors onto it; after two different calls the object carries both sets.

## How this evolved

The context surface has been stable, and the interesting history is in what it deliberately does *not* provide. `ArgumentsHost` was split out from `ExecutionContext` so that filters — which the framework invokes without knowing what was running — could be typed honestly rather than handed a context with two `null` fields. That split is why the type signature is the documentation: if a layer's parameter is `ArgumentsHost`, there is no handler to be had, and no cast will produce one. `Reflector.createDecorator` later removed the string keys that used to make `Reflector` calls the least type-safe line in a guard.

## Exercises

**1. Prove the null.** In a filter, cast the host to `ExecutionContext`, call `getHandler()`, and log it before touching a property. *Hint: the log succeeds and tells you exactly why the cast is useless.*

**2. Misread a transport on purpose.** In an HTTP guard, call `switchToWs().getClient()` and log what you got. *Hint: it's a familiar object with an unfamiliar name, which is why this bug survives review.*

**3. Write the double once.** Build the `httpContext` helper, then rewrite one existing guard spec to use it. *Hint: count the methods your guard actually calls — that's the honest size of the double.*

## Summary

- `ExecutionContextHost` is thin accessors over **one args array** plus an optional class and handler.
- `switchTo*` **mutates the host** and returns it; the three variants are index aliases, so calling the wrong one succeeds and misnames the objects.
- `getType()` is initialised to `'http'` and set by each consumer — untyped hosts report HTTP regardless.
- `getClass()` and `getHandler()` are non-null assertions over nullable fields. In a filter both are **`null`**, which is why casting `ArgumentsHost` to `ExecutionContext` compiles and then throws.
- Layer by layer: middleware gets raw args, guards and interceptors get the full context, pipes get `ArgumentMetadata`, filters get `ArgumentsHost`.
- Metadata therefore lives in guards and interceptors. Other layers must be told — attach to the request, bind narrowly, or throw a richer exception.
- `[handler, class]` order decides precedence; `getAllAndOverride` for policy, `getAllAndMerge` for accumulation with the object caveat.

## See also

- [Execution order](./execution-order.md) — which layers exist and in what nesting
- [Guards](./guards.md#the-context-is-built-from-the-controller-and-the-method) — where the class and handler come from
- [Interceptors](./interceptors.md) — the other layer with a full context
- [Exception filters](./exception-filters.md#the-handler-is-wrapped-in-a-trycatch-that-discards-the-context) — why the filter host has neither
- [Pipes](./pipes.md) — the layer with metadata but no context
- [Decorators and metadata reflection](../foundations/decorators-and-metadata-reflection.md) — `Reflector` in full
- [Recipe: getting metadata inside a filter](../recipes/request-lifecycle/getting-metadata-inside-a-filter.md)

## References

- [Execution context](https://docs.nestjs.com/fundamentals/execution-context) — official docs
- [`packages/core/helpers/execution-context-host.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/helpers/execution-context-host.ts) — the whole surface: index aliases, `Object.assign`, the `'http'` default, and the non-null assertions
- [`packages/core/router/router-proxy.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/router/router-proxy.ts) — the filter host, built without a class or handler
- [`packages/core/services/reflector.service.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/services/reflector.service.ts) — `getAllAndOverride` and `getAllAndMerge`

## Demo source

`demos/foundations/` — extends `pipeline/` with `context-probe.ts`, `transport-aware-api-key.guard.ts`, and the shared `context-double.ts` test helper.