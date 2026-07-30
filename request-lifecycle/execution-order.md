---
article_id: execution-order
concept_folder: request-lifecycle
wave: 1
nest_baseline: "11.1.x"
node_baseline: "24"
related:
  - request-lifecycle/middleware
  - request-lifecycle/guards
  - request-lifecycle/interceptors
  - request-lifecycle/pipes
  - request-lifecycle/exception-filters
  - foundations/decorators-and-metadata-reflection
  - recipes/request-lifecycle/guard-vs-interceptor-ordering
status:
  drafted: true
  reviewed: false
v12_watch: false
---

# Execution order

> **Lead with this.** Every NestJS diagram draws the request pipeline as a **list** — middleware, guards, interceptors, pipes, handler, interceptors, filters — and the list is accurate but it teaches the wrong thing. The pipeline is a **nesting**, and what matters is who wraps whom. Guards run entirely *outside* the interceptor chain, so an interceptor never observes a request a guard rejected. Pipes run *inside* the innermost interceptor, so an interceptor's `catchError` does see validation failures and its stopwatch does include validation cost. Exception filters don't chain at all — exactly one runs. None of that is visible in a left-to-right arrow diagram, and all of it is one function in `router-execution-context.ts`.

## What it is

Every layer between the socket and your handler, in documented order:

| Phase | Layers, in order |
| --- | --- |
| Before | global middleware → module middleware → **global → controller → route guards** → **global → controller → route interceptors** (pre) → **global → controller → route pipes** → route-parameter pipes |
| Handler | the controller method, and whatever it calls |
| After | **route → controller → global interceptors** (post) |
| On error | **route → controller → global filters** — the first match wins, and only it runs |

Two patterns to notice. Guards and interceptors' pre-phase run **outside-in** (global first). Interceptors' post-phase and filters run **inside-out** (route first). That symmetry isn't decoration — §How it works shows it's a single array consumed in two directions.

Each enhancer binds at three levels:

- **Global** — every route in the application
- **Controller** — `@UseGuards()` / `@UseInterceptors()` / `@UsePipes()` / `@UseFilters()` on the class
- **Route** — the same decorators on the method (plus per-parameter pipes: `@Param('id', ParseIntPipe)`)

Middleware is the exception: it binds by **path pattern** through `MiddlewareConsumer`, not by decorator, because it sits below Nest's DI-aware layer.

> **If you know Angular.** Angular's HTTP interceptor chain is the closest analogue and it's genuinely the same onion — outermost registered first, response unwinding in reverse. Two differences bite. Angular has *one* kind of interceptor; Nest splits the job across four enhancer types with different powers, and choosing wrongly is the most common structural mistake here — authorization in an interceptor works but runs later and costs more than a guard. And Angular's chain is assembled from one array you can read; Nest's is assembled from three metadata sources (global, class, method) merged at bootstrap, so no single file shows you the order.

## How it works under the hood

### One function assembles the whole thing

```typescript
// paraphrased from packages/core/router/router-execution-context.ts — create()
const handler = (args, req, res, next) => async () => {
  fnApplyPipes && (await fnApplyPipes(args, req, res, next));
  return callback.apply(instance, args);
};

return async (req, res, next) => {
  const args = this.contextUtils.createNullArray(argsLength);

  fnCanActivate && (await fnCanActivate([req, res, next]));        // ← guards

  this.responseController.setStatus(res, httpStatusCode);
  hasCustomHeaders && this.responseController.setHeaders(res, responseHeaders);

  const resultOrDeferred = this.interceptorsConsumer.intercept(
    interceptors, [req, res, next], instance, callback,
    handler(args, req, res, next),                                 // ← pipes + method
    contextType,
  );
  const result = isSseHandler ? resultOrDeferred : await resultOrDeferred;
  await fnHandleResponse(result, res, req);
};
```

Read the nesting off it directly:

```
guards
  status + headers
    interceptor 1 (global)
      interceptor 2 (controller)
        interceptor 3 (route)
          pipes
            handler
```

Four consequences, and they're the reason this article exists:

- **Guards are awaited before any interceptor is constructed into a chain.** A guard returning `false` or throwing means no interceptor's pre-phase code ever runs. Your logging interceptor will not log the 403. Your correlation-ID interceptor will not tag it. If you need visibility into rejected requests, that belongs in middleware or in the guard itself.
- **Pipes live inside the innermost interceptor's `next.handle()`.** So an interceptor's `catchError` *can* observe a `ValidationPipe` failure — useful — and an interceptor measuring elapsed time is measuring **pipes plus handler**, not the handler alone. For a large DTO, that difference is real.
- **Status and headers are set before interceptors run**, which is the mechanism [article 03](../foundations/controllers-and-routing.md#step-4--the-res-trap) traced when correcting the `@Res()` story.
- **`fnHandleResponse` is outside the interceptor chain.** The interceptors shape the *value*; Nest sends it afterwards.

### Global, class, and method metadata are one array

Guards, interceptors, pipes, and filters all inherit the same assembly:

```typescript
// paraphrased from packages/core/helpers/context-creator.ts — createContext
const globalMetadata = this.getGlobalMetadata?.(contextId, inquirerId);
const classMetadata  = this.reflectClassMetadata(instance, metadataKey);
const methodMetadata = this.reflectMethodMetadata(callback, metadataKey);

return [
  ...this.createConcreteContext(globalMetadata ?? [], contextId, inquirerId),
  ...this.createConcreteContext(classMetadata, contextId, inquirerId),
  ...this.createConcreteContext(methodMetadata, contextId, inquirerId),
];
```

Always `[...global, ...class, ...method]`. The class and method halves are read with `Reflector`, using the metadata mechanism from [article 04](../foundations/decorators-and-metadata-reflection.md#how-it-works-under-the-hood) — `@UseGuards()` is a `SetMetadata` call under a framework-owned key.

**Guards** are then evaluated in array order, so global guards decide first. **Interceptors** are folded into an RxJS chain in array order, which makes the global one outermost — hence pre-phase outside-in and post-phase inside-out, for free, from the shape of the chain.

### Filters reverse the array, and only one runs

```typescript
// paraphrased from packages/core/exceptions/external-exception-filter-context.ts
const filters = this.createContext<ExceptionFilterMetadata[]>(/* … */);
if (isEmpty(filters)) return exceptionHandler;
exceptionHandler.setCustomFilters(filters.reverse());   // ← global→class→method becomes method→class→global
```

```typescript
// paraphrased from exceptions-handler.ts — invokeCustomFilters
const filter = selectExceptionFilterMetadata(this.filters, exception);
if (!filter) return false;
filter.func(exception, ctx);   // exactly one
return true;
```

Two facts nobody guesses:

- **The array is reversed for filters**, so the *most specific* matching filter wins — route, then controller, then global. Guards and interceptors consume the same array forwards; filters consume it backwards.
- **`selectExceptionFilterMetadata` returns one filter.** Filters do **not** chain. A route-level filter that matches means your global filter never sees the exception — so logging that lives only in the global filter silently stops covering that route.

### Middleware errors do reach filters — but only global ones

```typescript
// paraphrased from packages/core/middleware/middleware-module.ts
const exceptionsHandler = this.routerExceptionFilter.create(instance, instance.use, moduleKey);
return this.routerProxy.createProxy(middleware, exceptionsHandler);
```

Middleware is wrapped in a proxy carrying its own exceptions handler, so a throw inside `use()` is formatted by your filters rather than escaping to Express. But the handler is created against **the middleware**, not a controller method — so there is no class or method metadata to merge, and only globally registered filters apply. A route-level filter has no jurisdiction over middleware that ran before routing resolved.

## Minimal shapes

```typescript
// global, with no DI — the enhancer is constructed by you
const app = await NestFactory.create(AppModule);
app.useGlobalGuards(new AuthGuard());
app.useGlobalInterceptors(new LoggingInterceptor());
app.useGlobalPipes(new ValidationPipe({ whitelist: true }));
app.useGlobalFilters(new AllExceptionsFilter());
```

```typescript
// global, with DI — the container constructs it
@Module({
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_INTERCEPTOR, useClass: LoggingInterceptor },   // outer
    { provide: APP_INTERCEPTOR, useClass: TransformInterceptor }, // inner
    { provide: APP_PIPE, useClass: ValidationPipe },
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
  ],
})
export class AppModule {}
```

```typescript
// controller and route level
@UseGuards(RolesGuard)
@UseInterceptors(CacheInterceptor)
@Controller('orders')
export class OrdersController {
  @UseFilters(OrdersExceptionFilter)
  @Get(':id')
  findOne(@Param('id', ParseIntPipe) id: number) {}
}
```

The `APP_*` tokens are the one place Nest accumulates multiple providers under a single token — the exception noted in [article 05](../foundations/custom-providers-and-injection-tokens.md#real-world-patterns). Declaration order is application order.

## Walkthrough — make the pipeline print itself

We add `src/pipeline/` to `demos/foundations`. Rather than trusting a diagram, we'll build one of each enhancer, have every layer append to a shared trace, and read the result.

### Step 1 — a trace, and one of each layer

```typescript
// src/pipeline/trace.service.ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class TraceService {
  private readonly steps: string[] = [];

  mark(step: string): void {
    this.steps.push(step);
  }

  drain(): string[] {
    const collected = [...this.steps];
    this.steps.length = 0;
    return collected;
  }
}
```

```typescript
// src/pipeline/trace.middleware.ts
import { Injectable, NestMiddleware } from '@nestjs/common';
import type { NextFunction, Request, Response } from 'express';
import { TraceService } from './trace.service';

@Injectable()
export class TraceMiddleware implements NestMiddleware {
  constructor(private readonly trace: TraceService) {}

  use(_req: Request, _res: Response, next: NextFunction): void {
    this.trace.mark('middleware');
    next();
  }
}
```

```typescript
// src/pipeline/trace.guard.ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { TraceService } from './trace.service';

@Injectable()
export class TraceGuard implements CanActivate {
  constructor(private readonly trace: TraceService) {}

  canActivate(context: ExecutionContext): boolean {
    this.trace.mark('guard');
    const request = context.switchToHttp().getRequest<Request>();
    if (request.query.deny === '1') {
      throw new ForbiddenException('denied by TraceGuard');
    }
    return true;
  }
}
```

```typescript
// src/pipeline/trace.interceptor.ts
import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, catchError, tap, throwError } from 'rxjs';
import { TraceService } from './trace.service';

@Injectable()
export class TraceInterceptor implements NestInterceptor {
  constructor(private readonly trace: TraceService) {}

  intercept(_context: ExecutionContext, next: CallHandler): Observable<unknown> {
    this.trace.mark('interceptor:before');
    const startedAt = Date.now();

    return next.handle().pipe(
      tap(() => {
        const mark = `interceptor:after (${Date.now() - startedAt}ms)`;
        this.trace.mark(mark);
        // also log it: by the time this runs, the handler has already read the
        // list, so this mark cannot appear in the response — see below
        new Logger('trace').log(mark);
      }),
      catchError((error) => {
        this.trace.mark(`interceptor:caught ${error.constructor.name}`);
        return throwError(() => error);
      }),
    );
  }
}
```

```typescript
// src/pipeline/trace.pipe.ts
import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';
import { TraceService } from './trace.service';

@Injectable()
export class TracePipe implements PipeTransform {
  constructor(private readonly trace: TraceService) {}

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    this.trace.mark(`pipe (${metadata.type})`);
    if (value === 'invalid') {
      throw new BadRequestException('rejected by TracePipe');
    }
    return value;
  }
}
```

```typescript
// src/pipeline/trace.filter.ts
import { ArgumentsHost, Catch, ExceptionFilter, HttpException } from '@nestjs/common';
import type { Response } from 'express';
import { TraceService } from './trace.service';

@Catch(HttpException)
export class TraceFilter implements ExceptionFilter {
  constructor(private readonly trace: TraceService) {}

  catch(exception: HttpException, host: ArgumentsHost): void {
    this.trace.mark('filter');
    const response = host.switchToHttp().getResponse<Response>();
    response.status(exception.getStatus()).json({
      message: exception.message,
      trace: this.trace.drain(),
    });
  }
}
```

Note that every one of these injects `TraceService`, which is precisely why they must be registered through DI rather than with `new`.

```typescript
// src/pipeline/pipeline.controller.ts
import { Controller, Get, Query } from '@nestjs/common';
import { TracePipe } from './trace.pipe';
import { TraceService } from './trace.service';

@Controller('pipeline')
export class PipelineController {
  constructor(private readonly trace: TraceService) {}

  @Get()
  run(@Query('value', TracePipe) value?: string): { trace: string[] } {
    this.trace.mark('handler');
    return { trace: this.trace.drain() };
  }
}
```

```typescript
// src/pipeline/pipeline.module.ts
import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { PipelineController } from './pipeline.controller';
import { TraceFilter } from './trace.filter';
import { TraceGuard } from './trace.guard';
import { TraceInterceptor } from './trace.interceptor';
import { TraceMiddleware } from './trace.middleware';
import { TracePipe } from './trace.pipe';
import { TraceService } from './trace.service';

@Module({
  controllers: [PipelineController],
  providers: [
    TraceService,
    TracePipe,
    { provide: APP_GUARD, useClass: TraceGuard },
    { provide: APP_INTERCEPTOR, useClass: TraceInterceptor },
    { provide: APP_FILTER, useClass: TraceFilter },
  ],
})
export class PipelineModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(TraceMiddleware).forRoutes('pipeline');
  }
}
```

`TraceService` is a plain singleton here so the trace survives across layers. In a real application this is exactly the state-across-layers problem [article 06](../foundations/scopes-and-lifetimes.md) is about, and it misbehaves in a specific, measured way: because the handler drains the list before the interceptor's post-phase writes to it, that last mark stays in the service and **turns up prepended to the next request's trace**. Two sequential requests are enough to see it; concurrent ones interleave completely. The honest fix is request scope or `AsyncLocalStorage`. It's a diagnostic, not a pattern — and the leak is part of the demonstration.

```bash
curl 'localhost:3000/pipeline?value=ok'
```

```json
{
  "trace": ["middleware", "guard", "interceptor:before", "pipe (query)", "handler"]
}
```

```
LOG [trace] interceptor:after (2ms)
```

There it is, from the running application rather than a diagram: pipes between the interceptor's before and the handler.

**And note what the response can't contain.** There are six marks but only five in the body, because the handler calls `drain()` to build its return value and the interceptor's post-phase runs *after* that. The sixth mark exists — it's in the log — but nothing inside the handler can ever see it. That's the nesting made visible from the inside: a handler cannot observe what wraps it. Any interceptor writing into the response shape has to do it with `map`, not by handing data to the handler.

### Step 2 — a guard rejection, and the layer that never sees it

```bash
curl 'localhost:3000/pipeline?deny=1'
```

```json
{ "message": "denied by TraceGuard", "trace": ["middleware", "guard", "filter"] }
```

No `interceptor:before`. No pipe. The guard threw before the interceptor chain was entered, exactly as the nesting predicts. This is the single most useful consequence to internalise: **anything you need on rejected requests cannot live in an interceptor.** Request logging, metrics on 401/403 counts, correlation IDs on error responses — middleware or the guard itself.

### Step 3 — a pipe rejection, which the interceptor does see

```bash
curl 'localhost:3000/pipeline?value=invalid'
```

```json
{
  "message": "rejected by TracePipe",
  "trace": ["middleware", "guard", "interceptor:before", "pipe (query)", "interceptor:caught BadRequestException", "filter"]
}
```

The interceptor's `catchError` fired. Pipes run inside `next.handle()`, so validation failures are inside the interceptor's jurisdiction while guard failures are outside it. That asymmetry is not arbitrary — it is the shape of the nesting — but it is impossible to guess from the flat list.

It also means the `interceptor:after (2ms)` in Step 1 covered pipe execution. If you want handler-only timing you need the *innermost* interceptor; for total in-Nest time, the outermost.

### Step 4 — registration, DI, and order

Swap the guard registration to the non-DI style and boot:

```typescript
// main.ts — ✗
app.useGlobalGuards(new TraceGuard());   // TraceGuard's constructor wants TraceService
```

TypeScript rejects it immediately here because the constructor is typed, and that is the lucky case. The unlucky version is an enhancer whose dependencies are all optional or `any`: it constructs fine and receives `undefined`. **`useGlobalX(new X())` builds the enhancer outside the container, so it gets no injection.** Use the `APP_*` token whenever the enhancer needs anything — which, once it needs to read config or log, is always.

Then prove ordering with two global interceptors:

```typescript
providers: [
  { provide: APP_INTERCEPTOR, useClass: OuterInterceptor },
  { provide: APP_INTERCEPTOR, useClass: InnerInterceptor },
]
```

Declaration order is application order, so the trace reads `outer:before → inner:before → handler → inner:after → outer:after`. One array, two directions.

### Step 5 — filters don't chain

Add a route-level filter alongside the global one:

```typescript
// src/pipeline/route.filter.ts
import { ArgumentsHost, BadRequestException, Catch, ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';

@Catch(BadRequestException)
export class RouteOnlyFilter implements ExceptionFilter {
  catch(exception: BadRequestException, host: ArgumentsHost): void {
    host.switchToHttp().getResponse<Response>()
      .status(400)
      .json({ handledBy: 'RouteOnlyFilter' });
  }
}
```

```typescript
@UseFilters(RouteOnlyFilter)
@Get()
run(@Query('value', TracePipe) value?: string) { /* … */ }
```

Now `?value=invalid` returns `{ "handledBy": "RouteOnlyFilter" }` — and the global `TraceFilter` never runs, so nothing is logged and no trace is emitted. The array was reversed and the first match won.

The practical rule: **a global filter is only a safety net for exceptions no more specific filter claims.** If it holds your logging or your error-reporting integration, every route-level filter you add is a hole in it. Either re-emit from the specific filter or move logging to an interceptor's `catchError`, which runs regardless of which filter formats the response.

### Verify the loop

The trace endpoint *is* the verification, and it's worth keeping in the demo — it answers "what actually runs here" faster than reading five files.

What can't be verified yet is automated: driving the full pipeline in a test needs the HTTP layer, which is [end-to-end testing](../testing/integration-and-e2e-with-supertest.md). Until then:

```bash
curl 'localhost:3000/pipeline?value=ok'       # full path
curl 'localhost:3000/pipeline?deny=1'         # guard rejection — no interceptor
curl 'localhost:3000/pipeline?value=invalid'  # pipe rejection — interceptor catches
npm run start | grep Mapped                   # confirm the route is bound where you think
```

## Real-world patterns

**Choose the layer by what it needs to see, not by convenience.**

| Job | Layer | Why not the neighbour |
| --- | --- | --- |
| Is this caller allowed? | **guard** | an interceptor works but runs later, after status and headers are set, and cannot reject before the chain is built |
| Correlation ID, request logging | **middleware** | it's the only layer that also sees requests guards reject |
| Timing, response shaping, caching | **interceptor** | pipes can't see the response; filters only see errors |
| Input validation and coercion | **pipe** | a guard has the raw request but no typed argument |
| Error response shape | **filter** | but remember only one runs |

**`APP_*` over `useGlobalX()`, by default.** The moment an enhancer needs config, a logger, or a repository, the `new`-based registration is a dead end. Starting there avoids a rewrite.

**One global filter, and specific filters only where the response shape genuinely differs** — with the knowledge that each one carves a hole in the global one.

**Put error logging in an interceptor's `catchError`, not only in a filter.** Interceptors all run; filters are winner-takes-all.

**Watch enhancer scope.** A request-scoped guard or interceptor registered via `APP_GUARD` applies per-request instantiation to *every* route — the propagation cost from [article 06](../foundations/scopes-and-lifetimes.md).

**Don't put authorization in middleware.** It has no `ExecutionContext`, so no `Reflector`, so no `@Roles()`-style metadata, and no access to which handler is about to run. Middleware is for transport-level concerns.

**Register an enhancer in exactly one place.** Globally *and* on the controller means it runs twice — legal, silent, and occasionally expensive.

## API reference

| Symbol | Import | Purpose |
| --- | --- | --- |
| `app.useGlobalGuards/Interceptors/Pipes/Filters(...)` | — | global registration, **no DI** |
| `APP_GUARD` `APP_INTERCEPTOR` `APP_PIPE` `APP_FILTER` | `@nestjs/core` | global registration with DI; multiple providers **accumulate** in declaration order |
| `@UseGuards(...)` | `@nestjs/common` | class or method binding |
| `@UseInterceptors(...)` | `@nestjs/common` | class or method binding |
| `@UsePipes(...)` | `@nestjs/common` | class or method binding |
| `@UseFilters(...)` | `@nestjs/common` | class or method binding; most specific wins |
| `@Param('id', ParseIntPipe)` | `@nestjs/common` | parameter-level pipe, the innermost binding |
| `MiddlewareConsumer.apply(...).forRoutes(...)` | `@nestjs/common` | middleware binding, by path not decorator |
| `.exclude(...)` | `MiddlewareConsumer` | exempt paths from middleware |

## Common mistakes

**1. Expecting an interceptor to observe a guard rejection.** The guard is awaited before the chain is built. Nothing in an interceptor runs.

**2. Believing an interceptor times only the handler.** Pipes run inside `next.handle()`, so a large DTO's validation is in your number.

**3. Expecting exception filters to chain.** Exactly one runs — `selectExceptionFilterMetadata` picks a single filter.

**4. Assuming a global filter outranks a route filter.** The array is reversed for filters: most specific wins.

**5. `useGlobalX(new X())` on an enhancer with dependencies.** Constructed outside the container, so nothing is injected. Use the `APP_*` token.

**6. Registering an enhancer globally *and* locally.** It runs twice, silently.

**7. Expecting route-level filters to cover middleware.** Middleware's exceptions handler is created against the middleware, so only global filters apply.

**8. Authorization in middleware.** No `ExecutionContext`, no `Reflector`, no knowledge of the target handler.

**9. Relying on `@UseGuards()` to run before a global guard.** The array is `[global, class, method]`; global decides first.

**10. Request-scoped global enhancers.** Every route in the application pays per-request instantiation.

## How this evolved

The nesting has been stable; the binding surface around it has grown. The `APP_*` provider tokens exist so that global enhancers can participate in DI at all — the `useGlobalX()` methods predate them and remain useful only for enhancers with no dependencies. Enhancer *scope* arrived with request-scoped and durable providers, which is why a global guard can now be a per-request cost rather than a singleton. Middleware is the layer that has moved least, because it isn't really Nest's — it's the adapter's, wrapped just enough to route its errors through your filters.

## Exercises

**1. Predict, then run.** Before starting the trace app, write down the six lines you expect from `?value=ok`. *Hint: the one most people get wrong is where the pipe sits relative to the interceptor.*

**2. Find the blind spot.** Add a request-logging interceptor, then send a request a guard rejects, and confirm nothing was logged. Move the logging to middleware and confirm it is. *Hint: this is why access logs live below the guard layer in every production setup.*

**3. Punch a hole in the safety net.** With a global filter that logs, add a route-level filter for one exception type and confirm the global filter stops seeing it. Then make both fire. *Hint: there are two ways, and one of them isn't a filter.*

## Summary

- The pipeline is a **nesting**, not a list: `guards → (status/headers) → interceptors → pipes → handler`.
- **Guards are outside the interceptor chain.** Nothing in an interceptor observes a rejected request.
- **Pipes are inside the innermost interceptor.** Validation errors are catchable by interceptors, and interceptor timing includes pipe cost.
- Guards, interceptors, pipes, and filters are all assembled as `[...global, ...class, ...method]` by one shared `createContext`.
- Guards and interceptors consume that array **forwards**; filters **reverse** it, so the most specific filter wins — and **only one filter runs**.
- Middleware exceptions do reach filters, but only **globally** registered ones.
- `useGlobalX(new X())` gets no DI; `APP_*` does, and multiple `APP_*` providers accumulate in declaration order.

## See also

- [Middleware](./middleware.md) — the adapter-level layer, and why it sees what guards reject
- [Guards](./guards.md) — the authorization decision point
- [Interceptors](./interceptors.md) — the RxJS chain this article folds
- [Pipes](./pipes.md) — transformation and validation inside the chain
- [Exception filters](./exception-filters.md) — winner-takes-all error formatting
- [Decorators and metadata reflection](../foundations/decorators-and-metadata-reflection.md#how-it-works-under-the-hood) — how `@UseGuards()` stores its metadata
- [Recipe: guard vs interceptor ordering](../recipes/request-lifecycle/guard-vs-interceptor-ordering.md)

## References

- [Request lifecycle](https://docs.nestjs.com/faq/request-lifecycle) — official docs
- [`packages/core/router/router-execution-context.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/router/router-execution-context.ts) — the assembled handler: guards, then interceptors wrapping pipes and the method
- [`packages/core/helpers/context-creator.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/helpers/context-creator.ts) — `[...global, ...class, ...method]`
- [`packages/core/exceptions/external-exception-filter-context.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/exceptions/external-exception-filter-context.ts) — `filters.reverse()`
- [`packages/core/exceptions/exceptions-handler.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/exceptions/exceptions-handler.ts) — one filter is selected
- [`packages/core/middleware/middleware-module.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/middleware/middleware-module.ts) — middleware wrapped with its own exceptions handler

## Demo source

`demos/foundations/` — adds `pipeline/`, the self-describing trace endpoint.