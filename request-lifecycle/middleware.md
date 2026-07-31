---
article_id: middleware
concept_folder: request-lifecycle
wave: 1
nest_baseline: "11.1.x"
node_baseline: "24"
related:
  - request-lifecycle/execution-order
  - request-lifecycle/guards
  - request-lifecycle/exception-filters
  - foundations/controllers-and-routing
  - foundations/scopes-and-lifetimes
  - recipes/request-lifecycle/middleware-timing-measures-nothing
status:
  drafted: true
  reviewed: false
v12_watch: true
---

# Middleware

> **Lead with this.** Middleware is the one layer in the pipeline that isn't really Nest's. It's the HTTP adapter's — Express's `(req, res, next)` — with just enough wrapping around it to route its errors through your filters and let it inject providers. Every confusing thing about middleware follows from that borrowed nature: no `ExecutionContext`, so no `Reflector` and no metadata; no idea which handler is about to run, because routing hasn't resolved yet; binding by **path pattern** rather than by decorator; and a `next()` that is a callback, not an awaited link in a chain. That combination makes middleware exactly right for the two jobs nothing else can do — and wrong for almost everything people reach for it to do.

## What it is

A middleware runs before the Nest-aware pipeline, for requests matching a path pattern. Two forms:

```typescript
// class-based — participates in DI
@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void { next(); }
}

// functional — no DI, no class
export function correlationId(req: Request, res: Response, next: NextFunction): void {
  next();
}
```

Bound in a module's `configure()`, not with a decorator:

```typescript
@Module({ /* … */ })
export class PipelineModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(CorrelationIdMiddleware).forRoutes('pipeline');
  }
}
```

**Nest ships no built-in middleware.** There is no middleware catalogue in `@nestjs/common` — the layer is the adapter's, so the ecosystem is Express's (`helmet`, `cors`, `compression`, `express-rate-limit`) plus whatever you write. The one exception is CORS, which Nest exposes as a first-class option rather than as middleware: `NestFactory.create(AppModule, { cors: true })` or `app.enableCors(options)`, which configures the adapter directly.

**What middleware uniquely can do**, per [article 09](./execution-order.md#how-it-works-under-the-hood):

- See requests that a guard rejects. It runs before guards, so it's the only layer that observes the 401s and 403s.
- Act before routing has resolved — including on requests that will 404.

**What it cannot do:**

- Read handler metadata. No `ExecutionContext` means no `Reflector`, so `@Roles()`-style decorators are invisible.
- Know which controller or method will handle the request.
- Return a value. Whatever it returns is discarded; the response is `res` or nothing.
- Be awaited by Nest. `next()` is a callback.

> **If you know Angular.** There is no Angular analogue, and the temptation is to map it onto `HttpInterceptor` — which is wrong in the way that matters. An Angular interceptor is a *chain link*: it returns the downstream observable, so code after `next(req)` genuinely runs after the response. Nest middleware is a *callback*: `next()` hands control onward and returns immediately, so code after it does **not** run after the handler. The closest Angular mental model is actually a route resolver or a `provideAppInitializer` — something that runs before the thing you care about and can't see the result of it. Nest's `HttpInterceptor` equivalent is the [interceptor](./interceptors.md), one layer in.

## How it works under the hood

### Binding is an ordered collection, and order is registration order

```typescript
// paraphrased from packages/core/middleware/builder.ts
private readonly middlewareCollection = new Set<MiddlewareConfiguration>();

public forRoutes(...routes: (string | Type<any> | RouteInfo)[]): MiddlewareConsumer {
  const { middlewareCollection } = this.builder;
  const configuration = {
    middleware: filterMiddleware(this.middleware, this.excludedRoutes, this.builder.getHttpAdapter()),
    forRoutes: this.getRoutesFlatList(routes),
  };
  middlewareCollection.add(configuration);
  return this.builder;
}
```

Each `apply(...).forRoutes(...)` appends one configuration. **Execution order is the order you called `apply()`**, and within a single `apply(a, b, c)` it's argument order. There is no priority, no `order` option, and no way to interleave two `apply()` calls — which makes `configure()` the one place a module's middleware ordering is decided.

### `forRoutes()` accepts three different things, and they mean different things

```typescript
// paraphrased from packages/core/middleware/routes-mapper.ts
private getRouteInfoFromPath(routePath: string): RouteInfo[] {
  const defaultRequestMethod = -1;                       // "any method"
  return [{ path: addLeadingSlash(routePath), method: defaultRequestMethod as any }];
}

private getRouteInfoFromController(controller, routePath) {
  const controllerPaths = this.pathsExplorer.scanForPaths(Object.create(controller), controller.prototype);
  // … one RouteInfo per mapped route, each with its own requestMethod …
}
```

- **A string** — `forRoutes('pipeline')` — binds for **every HTTP method** on that path pattern.
- **A `RouteInfo` object** — `{ path: 'pipeline', method: RequestMethod.POST }` — narrows to one method.
- **A controller class** — `forRoutes(PipelineController)` — is resolved through `PathsExplorer`, the same explorer [article 03](../foundations/controllers-and-routing.md#how-it-works-under-the-hood) traced. It does **not** bind the controller's prefix as a wildcard; it binds each of that controller's **actually mapped routes**, with each route's own method. Add a handler to the controller later and the middleware picks it up; that's usually what you want and occasionally a surprise.

### Middleware paths use the same path matcher as routes — including the Express 5 rules

```typescript
// paraphrased from packages/core/middleware/utils.ts
import { pathToRegexp } from 'path-to-regexp';
import { LegacyRouteConverter } from '../router/legacy-route-converter';

const path = LegacyRouteConverter.tryConvert(originalPath);
// …
pathRegex: pathToRegexp(addLeadingSlash(path)).regexp,
```

So everything [article 03](../foundations/controllers-and-routing.md#step-5--a-wildcard-under-express-5) established about Express 5 path patterns applies here verbatim:

- Wildcards must be **named**: `forRoutes('admin/*splat')`, not `'admin/*'`.
- Brace placement decides whether the base path matches. `'admin{/*splat}'` matches `/admin` **and** everything under it; `'admin/{*splat}'` requires the trailing slash.
- A bare `*` is rewritten by the legacy converter, which logs an error. `forRoutes('*')` — probably the most-copied line in any Nest tutorial — is running on a compatibility shim.

This is the single most useful cross-reference in the article: the wildcard bug people hit in `@Get()` is the same bug in `forRoutes()`, from the same code.

### Errors reach filters, but only global ones

```typescript
// paraphrased from packages/core/middleware/middleware-module.ts
const exceptionsHandler = this.routerExceptionFilter.create(instance, instance.use, moduleKey);
return this.routerProxy.createProxy(middleware, exceptionsHandler);
```

A throw inside `use()` is formatted by your exception filters rather than escaping to Express's default handler. But the handler is created against **the middleware**, not a controller method — there's no class or method metadata to merge — so only globally registered filters have jurisdiction. A `@UseFilters()` on the controller cannot catch something that happened before routing resolved.

### Middleware is a provider in every way that matters

Class middleware is registered in its module and collected in `module.middlewares`, which means two things worth knowing:

- **Module-scoped DI.** It can inject anything visible in the declaring module, under the rules from [article 02](../foundations/modules-and-the-module-graph.md). Nothing about middleware is exempt from the module graph.
- **It gets lifecycle hooks.** [Article 08](../foundations/bootstrap-and-lifecycle-hooks.md#how-it-works-under-the-hood) showed `module.middlewares` in the hook dispatch list, so `onModuleInit` on a middleware works.

### `next()` is a callback, not a chain

This is the mechanism behind the most common middleware bug, and it deserves stating plainly. `next()` invokes the next handler in the adapter's stack and **returns**. Your function then continues to its closing brace and finishes — while the controller may still be awaiting a database call.

```typescript
use(req: Request, res: Response, next: NextFunction): void {
  const startedAt = Date.now();
  next();
  // ✗ reached immediately, not after the handler
  this.logger.log(`took ${Date.now() - startedAt}ms`);   // always ~0
}
```

Express middleware has no `await next()`. The post-handler hook is the response's `finish` event, and §Step 2 uses it.

## Basic usage

```typescript
// src/pipeline/correlation-id.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { randomUUID } from 'node:crypto';

export const CORRELATION_HEADER = 'x-correlation-id';

@Injectable()
export class CorrelationIdMiddleware implements NestMiddleware {
  use(req: Request, res: Response, next: NextFunction): void {
    const incoming = req.headers[CORRELATION_HEADER];
    const correlationId = typeof incoming === 'string' && incoming.length > 0
      ? incoming
      : randomUUID();

    (req as Request & { correlationId?: string }).correlationId = correlationId;
    res.setHeader(CORRELATION_HEADER, correlationId);
    next();
  }
}
```

```typescript
// src/pipeline/pipeline.module.ts
import { MiddlewareConsumer, Module, NestModule, RequestMethod } from '@nestjs/common';
import { CorrelationIdMiddleware } from './correlation-id.middleware';

@Module({ /* … as in article 09 … */ })
export class PipelineModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer
      .apply(CorrelationIdMiddleware)
      .exclude({ path: 'pipeline/health', method: RequestMethod.GET })
      .forRoutes('pipeline{/*splat}');
  }
}
```

Note `'pipeline{/*splat}'` rather than `'pipeline/*'` — slash inside the braces, so both `/pipeline` and everything beneath it match, and no legacy conversion happens.

## Walkthrough — the two jobs middleware actually owns

We extend the `pipeline/` module from [article 09](./execution-order.md). Its trace endpoint is still the fastest way to see where a layer sits.

### Step 1 — a correlation ID, and why it has to be here

The middleware above stamps every request with an id and echoes it as a response header. Two properties make middleware the correct layer rather than an interceptor:

- It runs **before guards**, so a request rejected with 403 still carries a correlation id in its response headers. An interceptor's pre-phase never runs for that request.
- It runs before routing resolves, so even a 404 gets one.

Downstream layers read it off the request:

```typescript
// in a guard, interceptor, or handler
const { correlationId } = context.switchToHttp().getRequest<Request & { correlationId?: string }>();
```

That cast is the honest cost of the pattern. Middleware's only channel to the rest of the pipeline is mutating `req`, and `req` has no idea what you put on it. Two ways to do better: declare it once via module augmentation on Express's `Request`, or — for anything beyond a scalar — put it in an `AsyncLocalStorage` store that middleware initialises and everyone else reads with a type. The second is what [article 06](../foundations/scopes-and-lifetimes.md#real-world-patterns) recommends instead of request scope, and middleware is where the store gets opened.

### Step 2 — an access log, and the timing trap

The obvious version is wrong:

```typescript
// ✗ always logs ~0ms
use(req: Request, res: Response, next: NextFunction): void {
  const startedAt = Date.now();
  next();
  this.logger.log(`${req.method} ${req.originalUrl} — ${Date.now() - startedAt}ms`);
}
```

`next()` returns immediately, so the log line runs before the handler has awaited anything. On a synchronous handler you might see 1ms and believe it; on a real one you'll see 0ms for a request that took 400ms, which is worse than no metric because it looks like a metric.

The correct hook is the response's `finish` event:

```typescript
// src/pipeline/access-log.middleware.ts
import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';

@Injectable()
export class AccessLogMiddleware implements NestMiddleware {
  private readonly logger = new Logger('access');

  use(req: Request, res: Response, next: NextFunction): void {
    const startedAt = Date.now();
    const { correlationId } = req as Request & { correlationId?: string };

    res.on('finish', () => {
      this.logger.log(
        `${req.method} ${req.originalUrl} ${res.statusCode} ` +
          `${Date.now() - startedAt}ms cid=${correlationId ?? '-'}`,
      );
    });

    next();
  }
}
```

`finish` fires when the response has been handed to the OS, which is what you want to measure. Two caveats worth knowing: a client that disconnects mid-response may fire `close` without ever firing `finish`, so a complete access log listens for both and de-duplicates; and the listener closes over `req`, so anything you attach to it stays reachable until the response completes.

Register it after the correlation middleware, because order is registration order:

```typescript
configure(consumer: MiddlewareConsumer): void {
  consumer
    .apply(CorrelationIdMiddleware, AccessLogMiddleware)   // ← id first, so the log can use it
    .forRoutes('pipeline{/*splat}');
}
```

Now drive a rejected request:

```bash
curl -i 'localhost:3000/pipeline?deny=1'
# response carries x-correlation-id, and the access log records the 403
```

Compare with article 09's Step 2, where the interceptor logged nothing for the same request. That contrast is the whole argument for this layer.

### Step 3 — binding, precisely

Four bindings that look similar and aren't:

```typescript
consumer.apply(M).forRoutes('pipeline');                              // every method, that exact path
consumer.apply(M).forRoutes('pipeline{/*splat}');                     // that path and everything below
consumer.apply(M).forRoutes({ path: 'pipeline', method: RequestMethod.POST });  // one method
consumer.apply(M).forRoutes(PipelineController);                      // that controller's mapped routes
```

The fourth is the one to reach for when the answer is "wherever this controller is." It tracks the controller's routes, so it can't drift out of sync with a prefix you forgot to update — and it binds per mapped route with each route's own method, not as a prefix wildcard.

`exclude()` takes the same shapes and is evaluated per path, which makes health checks and metrics endpoints the standard use:

```typescript
consumer
  .apply(AccessLogMiddleware)
  .exclude('health', 'metrics')
  .forRoutes('{*splat}');   // ← the honest spelling of "everything"
```

That last line is the one to internalise. `forRoutes('*')` still works, and it works by being rewritten for you while an error is logged. Write `'{*splat}'` and nothing is rewritten.

### Step 4 — what happens when you put auth here

The tempting version:

```typescript
// ✗ authorization in middleware
import { UnauthorizedException } from '@nestjs/common';

use(req: Request, res: Response, next: NextFunction): void {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) {
    throw new UnauthorizedException();   // this does reach a global filter
  }
  next();
}
```

The throw is handled — middleware is proxied with an exceptions handler — so this *works*, which is why it survives code review. What it can't do:

- **Read `@Roles()` or any other metadata.** There is no `ExecutionContext`, so no `Reflector`. Per-route permissions are invisible.
- **Know which handler is about to run.** So "this endpoint is public" cannot be expressed at the endpoint.
- **Be caught by a route-level filter.** Only global filters apply.
- **Be tested against a handler.** There's nothing to bind it to.

The result is authorization rules encoded as path strings in `configure()`, drifting away from the routes they protect. Authentication *token parsing* is defensible here — it's transport-level and metadata-free. The **decision** belongs in a [guard](./guards.md).

### Step 5 — functional middleware and `app.use()`

Two DI-less options, for different reasons.

**Functional middleware** when the middleware needs nothing injected. It's smaller and, per the docs, preferable when you have no dependencies:

```typescript
// src/pipeline/no-cache.middleware.ts
import type { NextFunction, Request, Response } from 'express';

export function noCache(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('Cache-Control', 'no-store');
  next();
}
```

```typescript
consumer.apply(noCache).forRoutes('pipeline{/*splat}');
```

**`app.use()`** for third-party Express middleware and anything that must run before *all* module middleware:

```typescript
// src/main.ts
import compression from 'compression';
import helmet from 'helmet';

const app = await NestFactory.create(AppModule);
app.use(helmet());        // no DI, no path binding — every request
app.use(compression());
```

The trade-off: `app.use()` middleware is constructed outside the container, so it can't inject, and it can't be scoped to routes. That's fine for `helmet`, `cors`, and `compression`, which is most of what belongs there. It's not fine for anything that needs your config service — same lesson as `useGlobalX()` versus `APP_*` in [article 09](./execution-order.md#minimal-shapes).

### Verify the loop

```bash
# 1. the correlation header survives a guard rejection
curl -i 'localhost:3000/pipeline?deny=1' | grep -i x-correlation-id

# 2. the access log records real durations, not zeros
curl 'localhost:3000/pipeline?value=ok'
# access log line should show a non-zero ms and the same cid as the header

# 3. the trace endpoint still shows middleware first
curl 'localhost:3000/pipeline?value=ok'   # trace[0] === 'middleware'

# 4. no legacy-route warning at boot
npm run start | grep -i "Unsupported route path"   # expect no output
```

Check 2 is the one that matters: swap `res.on('finish')` back to a log after `next()` and watch the duration collapse to 0.

## Real-world patterns

**Correlation IDs and access logs.** The two jobs that need to see requests guards reject. Almost everything else has a better home one layer in.

**Open an `AsyncLocalStorage` store here.** Middleware is the outermost DI-aware layer, so a store opened in `run()` covers guards, interceptors, pipes, handler, and filters. This is the alternative to request scope that [article 06](../foundations/scopes-and-lifetimes.md#real-world-patterns) argues for.

**Third-party Express middleware via `app.use()`.** `helmet`, `cors`, `compression`, raw-body capture for webhook signature verification. No DI needed, and they should run before everything.

**Functional middleware when there are no dependencies.** Less ceremony, and the absence of a class is a signal to readers that nothing is injected.

**Type the request extension once.** Module-augment Express's `Request` rather than casting at every read site. A cast per consumer is a lie repeated.

**Bind with `forRoutes(Controller)` when the scope is "this controller."** Path strings drift; controller references don't.

**Never put business logic here.** A queue consumer, a scheduled job, and a CLI command all skip middleware entirely. Anything a second entry point needs belongs in a provider.

## API reference

| Symbol | Import | Purpose |
| --- | --- | --- |
| `NestMiddleware` | `@nestjs/common` | interface with `use(req, res, next)` |
| `NestModule` | `@nestjs/common` | interface with `configure(consumer)` |
| `MiddlewareConsumer` | `@nestjs/common` | the builder returned to `configure()` |
| `consumer.apply(...m)` | — | register middleware; argument order is execution order |
| `.forRoutes(...routes)` | — | bind by path string, `RouteInfo`, or controller class |
| `.exclude(...routes)` | — | exempt paths from the preceding `apply()` |
| `RouteInfo` | `@nestjs/common` | `{ path, method, version? }` |
| `RequestMethod` | `@nestjs/common` | enum for narrowing a `RouteInfo` |
| `app.use(...)` | — | adapter-level middleware; **no DI**, no path binding |
| `res.on('finish')` | Node `http` | the post-response hook — the correct place to measure |

## Common mistakes

**1. Measuring duration with code after `next()`.** `next()` is a callback that returns immediately; the log runs before the handler finished. Always ~0 ms. Use `res.on('finish')`.

**2. Forgetting `next()`.** The request hangs until the client times out. Nothing is logged, because nothing threw.

**3. Sending a response *and* calling `next()`.** The handler then tries to respond too, and you get `ERR_HTTP_HEADERS_SENT` — a stack trace that names Express, not your middleware.

**4. `forRoutes('*')`.** Rewritten by the legacy converter with an error logged at boot. Write `'{*splat}'`.

**5. Slash outside the braces.** `'admin/{*splat}'` doesn't match `/admin`; `'admin{/*splat}'` does. Same trap as `@Get()`, same code path.

**6. Authorization in middleware.** No `ExecutionContext`, no `Reflector`, no knowledge of the target handler, and only global filters can catch it. Parse the token here at most; decide in a guard.

**7. Expecting `@UseFilters()` to catch a middleware error.** The exceptions handler is created against the middleware, so only global filters apply.

**8. Expecting `app.use()` middleware to inject.** Constructed outside the container. Use class middleware in a module.

**9. Assuming `forRoutes(SomeController)` binds the prefix.** It binds that controller's mapped routes individually, each with its own HTTP method.

**10. Untyped `req` mutation.** `(req as any).user = …` in middleware and a different cast in every consumer. Augment the type once.

## How this evolved

Middleware has changed least of any layer, because it isn't Nest's own — it's the adapter's contract. What moved in Nest 11 is underneath it: the Express 5 upgrade brought path-to-regexp v8, and `forRoutes()`/`exclude()` go through the same `LegacyRouteConverter` and `pathToRegexp` as route decorators. So the wildcard rules changed for middleware bindings at the same moment they changed for routes, and the `forRoutes('*')` in every older tutorial now runs on a shim. Functional middleware has also become the documented default for the dependency-free case, which it wasn't always.

## Exercises

**1. Watch the timing lie.** Write a middleware that logs elapsed time after `next()`, point it at a handler that awaits 300 ms, and read the number. Then move the log into `res.on('finish')`. *Hint: the first number isn't wrong by a little.*

**2. Find the layer that sees the rejection.** Put a request log in a middleware and another in an interceptor, then send a request a guard rejects. *Hint: this is article 09's Step 2 from the other side — and it's why access logging lives here.*

**3. Break and fix a wildcard.** Bind middleware with `forRoutes('admin/*')` and read the boot output. Then find the two brace spellings and determine which one matches `/admin` itself. *Hint: the converter tells you what it rewrote your pattern to — and that rewrite has the trailing-slash problem.*

## Summary

- Middleware is the adapter's `(req, res, next)`, wrapped just enough to reach your filters and to inject providers.
- It **runs before guards**, so it's the only layer that sees requests guards reject — that's what it's for.
- It has no `ExecutionContext`, so no `Reflector`, no metadata, and no knowledge of the target handler.
- **Execution order is registration order** — `apply()` call order, then argument order.
- `forRoutes()` takes a path string (all methods), a `RouteInfo` (one method), or a controller class (its actual mapped routes).
- Middleware paths use the **same** `LegacyRouteConverter` + `pathToRegexp` as routes, so Express 5's named wildcards and brace placement apply verbatim. `'*'` runs on a shim.
- Errors reach **global** filters only.
- `next()` is a callback, not an awaited chain. The post-handler hook is `res.on('finish')`.
- `app.use()` and functional middleware trade DI for simplicity — right for `helmet`, wrong for anything that needs your providers.

## See also

- [Execution order](./execution-order.md) — where middleware sits, and what it can therefore see
- [Guards](./guards.md) — where authorization decisions belong
- [Exception filters](./exception-filters.md) — why only global filters catch middleware errors
- [Controllers and routing](../foundations/controllers-and-routing.md#step-5--a-wildcard-under-express-5) — the same path-matching rules
- [Scopes and lifetimes](../foundations/scopes-and-lifetimes.md#real-world-patterns) — `AsyncLocalStorage` as the alternative to request scope
- [Recipe: middleware timing always logs 0 ms](../recipes/request-lifecycle/middleware-timing-measures-nothing.md)

## References

- [Middleware](https://docs.nestjs.com/middleware) — official docs
- [`packages/core/middleware/builder.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/middleware/builder.ts) — the ordered middleware collection, `apply`/`exclude`/`forRoutes`
- [`packages/core/middleware/routes-mapper.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/middleware/routes-mapper.ts) — string vs `RouteInfo` vs controller resolution
- [`packages/core/middleware/utils.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/middleware/utils.ts) — `LegacyRouteConverter` and `pathToRegexp` on middleware paths
- [`packages/core/middleware/middleware-module.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/middleware/middleware-module.ts) — the proxy carrying an exceptions handler

## Demo source

`demos/foundations/` — extends `pipeline/` from article 09 with correlation-id and access-log middleware.