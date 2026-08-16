---
article_id: interceptors
description: The handler arrives as a deferred observable, so an interceptor holds the decision to invoke it at all
concept_folder: request-lifecycle
wave: 1
nest_baseline: "11.1.x"
node_baseline: "24"
related:
  - request-lifecycle/execution-order
  - request-lifecycle/guards
  - request-lifecycle/exception-filters
  - validation/serialization-and-response-shaping
  - performance/caching
  - recipes/request-lifecycle/interceptor-ran-the-handler-twice
status:
  drafted: true
  reviewed: false
v12_watch: false
---

# Interceptors

> **Lead with this.** An interceptor does not receive the handler's result. It receives a **deferred observable that will run the handler when subscribed** — and every power unique to this layer follows from that one fact. Decline to subscribe and the handler never runs, which is how caching short-circuits. Subscribe twice and the handler runs **twice**, which is how `retry()` works and how non-idempotent endpoints get double-written by accident. Subscribe with a time limit and you get a timeout response — but the handler keeps running, because nothing about RxJS unsubscription cancels a promise that already started. The flat pipeline diagram shows an interceptor as a box before and after the handler; what it actually holds is the *decision to invoke the handler at all*.

## What it is

One method, and a handle to the rest of the pipeline:

```typescript
@Injectable()
export class NoopInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle();
  }
}
```

Code before `return` is the pre-phase. Operators piped onto `next.handle()` are the post-phase. `next.handle()` itself is the rest of the chain — the inner interceptors, then the pipes, then the handler.

**Nest ships exactly one built-in interceptor.** `@nestjs/common` has no `interceptors/` barrel at all — `ClassSerializerInterceptor` lives under `serializer/`, and that's the entire list at v11.1.28. `CacheInterceptor` is in `@nestjs/cache-manager`, and everything else you've seen named as an interceptor is either ecosystem or hand-written. So unlike pipes and exceptions, this is a layer where you write essentially all of them yourself — which is why the rest of this article is about the mechanism rather than a catalogue.

Four jobs, one operator each:

| Job | Operator |
| --- | --- |
| observe without changing (logging, metrics) | `tap`, `finalize` |
| reshape the response | `map` |
| translate or log failures | `catchError` |
| replace the response entirely | return something else, never calling `handle()` |

From [article 09](./execution-order.md#how-it-works-under-the-hood): interceptors sit **inside** guards and **outside** pipes. So an interceptor never observes a request a guard rejected, and its stopwatch includes validation cost.

> **If you know Angular.** This is the layer that genuinely maps onto `HttpInterceptor`, and the mapping is close enough to be worth trusting: same onion, same RxJS, outermost registered first, response unwinding in reverse. Two differences. Angular's `next(req)` returns a cold observable too, but you rarely exploit that — here, deferral is the whole point, and `retry()` on a Nest interceptor re-runs a *database write* rather than a re-fetch. And Angular's interceptors are the only cross-cutting layer it has, so everything goes in them; Nest splits the work four ways, which means the Angular habit of putting auth in an interceptor lands you one layer too deep — after status and headers are already set, and unable to reject before the chain is built.

## How it works under the hood

### The chain is a recursive fold of deferred observables

```typescript
// paraphrased from packages/core/interceptors/interceptors-consumer.ts
public async intercept(interceptors, args, instance, callback, next, type) {
  if (isEmpty(interceptors)) {
    return next();                                  // ← no interceptors: no RxJS at all
  }
  const context = this.createContext(args, instance, callback);
  context.setType(type);

  const nextFn = async (i = 0) => {
    if (i >= interceptors.length) {
      return defer(AsyncResource.bind(() => this.transformDeferred(next)));
    }
    const handler: CallHandler = {
      handle: () => defer(AsyncResource.bind(() => nextFn(i + 1))).pipe(mergeAll()),
    };
    return interceptors[i].intercept(context, handler);
  };
  return defer(() => nextFn()).pipe(mergeAll());
}
```

Four consequences, and they're the article:

- **`handle()` is `defer(...)`.** Nothing downstream executes until the observable it returns is subscribed. RxJS subscribes when the outer chain does — so if an interceptor returns an observable that doesn't include `handle()`'s, the handler is never called.
- **Each subscription runs the chain again** — and "the chain" is more than the handler. `defer` re-invokes its factory per subscriber, so `next.handle().pipe(retry(2))` re-runs every interceptor *below* this one, **the pipes**, and the handler, up to three times. Measured on a route with a piped query parameter: one client request produced three `pipe` invocations. So a retry on a route with expensive validation multiplies the validation, and any pipe with a side effect performs it again. A feature for reads, a defect for writes.
- **`mergeAll()` flattens** because `nextFn` is `async` and therefore returns `Promise<Observable>`. That's plumbing, not something you interact with.
- **No interceptors means no chain.** `return next()` directly. Interceptors you don't bind cost nothing.

### `AsyncResource.bind` is why `AsyncLocalStorage` survives

Both `defer` calls wrap their factory in `AsyncResource.bind(...)`, and the source carries a comment explaining that `transformDeferred` calls `next()` **eagerly**, inside the bound scope, on purpose — deferring it into the subscriber function would run it outside the binding and lose the async context.

The practical payoff: a store opened by [middleware](./middleware.md#real-world-patterns) is still readable in the handler, across the whole interceptor chain. That only works because of this binding, and it's the reason `AsyncLocalStorage` is a viable alternative to request scope in Nest at all.

### Cancellation does not cancel your handler

```typescript
// paraphrased — transformDeferred
const nextPromise = next();                          // eager, inside the bound scope
return new Observable(subscriber => {
  let innerSub;
  nextPromise.then(res => {
    if (subscriber.closed) {
      // the outer subscription was torn down (e.g. an SSE client disconnect)
      // before the handler resolved — subscribe/unsubscribe so teardown still runs
      if (res instanceof Observable) { res.subscribe({ error: () => {} }).unsubscribe(); }
      return;
    }
    const isDeferred = res instanceof Promise || res instanceof Observable;
    innerSub = from(isDeferred ? res : Promise.resolve(res)).subscribe(subscriber);
  }).catch(err => { if (!subscriber.closed) subscriber.error(err); });
  return () => innerSub?.unsubscribe();
});
```

Read the `subscriber.closed` branch carefully. Once `next()` has been called, the handler's promise is running and **nothing stops it**. If the outer subscription is torn down first — a `timeout()` fired, a client disconnected — the resolved value is *discarded*, not prevented.

So `timeout(5000)` in an interceptor gives the client a 408 after five seconds. It does not stop the query, release the connection, or prevent the write. If the handler was inserting a row, that row still gets inserted after the client was told the request timed out. Cancelling for real needs an `AbortSignal` threaded into whatever does the I/O, which is a handler concern, not an interceptor one.

### The handler's return value is flattened

`from(isDeferred ? res : Promise.resolve(res))` means a handler may return a plain value, a promise, or an observable, and the chain treats all three the same. That's also how server-sent events work: for an SSE handler, [article 03's](../foundations/controllers-and-routing.md) response path keeps the observable un-awaited rather than resolving it to a single value.

## Minimal shapes

```typescript
// observe
return next.handle().pipe(tap({ next: (v) => log(v), error: (e) => log(e) }));

// reshape
return next.handle().pipe(map((data) => ({ data, at: new Date().toISOString() })));

// translate failures
return next.handle().pipe(catchError((err) => throwError(() => translate(err))));

// replace — the handler never runs
const hit = this.cache.get(key);
return hit ? of(hit) : next.handle().pipe(tap((v) => this.cache.set(key, v)));
```

## Walkthrough — five things only this layer can do

We extend the `pipeline/` module from articles 09–11.

### Step 1 — timing, done correctly

The obvious version misses failures:

```typescript
// ✗ errors are never timed
return next.handle().pipe(tap(() => this.log(Date.now() - startedAt)));
```

`tap`'s next-handler doesn't run when the observable errors, so your latency metric silently excludes every failing request — which are usually the slow ones. `finalize` runs on completion, error, **and** unsubscription:

```typescript
// src/pipeline/timing.interceptor.ts
import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import { Observable, finalize } from 'rxjs';

@Injectable()
export class TimingInterceptor implements NestInterceptor {
  private readonly logger = new Logger('timing');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const startedAt = Date.now();
    const handler = `${context.getClass().name}.${context.getHandler().name}`;

    return next.handle().pipe(
      finalize(() => this.logger.log(`${handler} ${Date.now() - startedAt}ms`)),
    );
  }
}
```

Two honest caveats. This measures **pipes plus handler**, not the handler alone — validation of a large DTO is in the number, per article 09. And `finalize` also fires on unsubscription, so a timed-out request logs its elapsed time at the moment of teardown while the handler is still running.

`context.getClass().name` and `getHandler().name` come from the same `ExecutionContextHost` guards use, which is what makes a generic interceptor able to name what it wrapped.

### Step 2 — a response envelope, and what it costs

```typescript
// src/pipeline/envelope.interceptor.ts
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { Observable, map } from 'rxjs';
import { RawResponse } from './raw-response.decorator';

@Injectable()
export class EnvelopeInterceptor implements NestInterceptor {
  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const raw = this.reflector.getAllAndOverride(RawResponse, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (raw) {
      return next.handle();
    }

    return next.handle().pipe(
      map((data) => ({
        data,
        meta: { at: new Date().toISOString() },
      })),
    );
  }
}
```

```typescript
// src/pipeline/raw-response.decorator.ts
import { Reflector } from '@nestjs/core';
export const RawResponse = Reflector.createDecorator<boolean>();
```

Registered globally, this rewrites every response in the application — which is a decision with a bill attached, and the bill is worth stating rather than discovering:

- **Every client and generated type changes.** `{ data, meta }` everywhere means OpenAPI schemas, front-end types, and every existing consumer.
- **Some routes must opt out**, which is why `@RawResponse()` exists above. Health checks that a load balancer parses, file downloads, redirects, third-party webhook acknowledgements with a fixed contract — all need the raw shape.
- **`@Res()` handlers bypass it entirely.** From [article 03](../foundations/controllers-and-routing.md#step-4--the-res-trap), a handler that owns the response has its return value discarded, so the `map` produces something nobody sends.
- **Errors don't pass through `map`.** Error responses are shaped by [filters](./exception-filters.md), so an envelope needs a matching filter or your success and error shapes diverge.

Envelopes are common and defensible. Adding one to an application that already has clients is not a refactor, it's a version bump.

### Step 3 — where error logging belongs

Article 09 established that filters are winner-takes-all: exactly one runs, so logging inside a global filter stops covering any route with a more specific filter. Interceptors have no such problem — **all of them run** — which makes `catchError` the right home for error observability:

```typescript
// src/pipeline/error-log.interceptor.ts
import { CallHandler, ExecutionContext, Injectable, Logger, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, catchError, throwError } from 'rxjs';

@Injectable()
export class ErrorLogInterceptor implements NestInterceptor {
  private readonly logger = new Logger('errors');

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    return next.handle().pipe(
      catchError((error: unknown) => {
        const request = context.switchToHttp().getRequest<Request & { correlationId?: string }>();
        this.logger.error(
          `${request.method} ${request.originalUrl} cid=${request.correlationId ?? '-'}`,
          error instanceof Error ? error.stack : String(error),
        );
        return throwError(() => error);   // ← re-throw; do not swallow
      }),
    );
  }
}
```

`return throwError(() => error)` is the load-bearing line. Returning anything else converts the failure into a success and your filter never sees it — a `catchError` that returns `of(null)` is how a 500 becomes a silent `200 null`.

Worth knowing what this *doesn't* cover: guard rejections, which never reach the chain, and errors thrown in an interceptor's own pre-phase upstream of this one.

### Step 4 — short-circuit, which proves the deferral

```typescript
// src/pipeline/cache.interceptor.ts
import { CallHandler, ExecutionContext, Injectable, NestInterceptor } from '@nestjs/common';
import type { Request } from 'express';
import { Observable, of, tap } from 'rxjs';

@Injectable()
export class TinyCacheInterceptor implements NestInterceptor {
  private readonly store = new Map<string, unknown>();

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    if (request.method !== 'GET') {
      return next.handle();
    }

    const key = request.originalUrl;
    if (this.store.has(key)) {
      return of(this.store.get(key));       // ← handle() never called
    }

    return next.handle().pipe(tap((value) => this.store.set(key, value)));
  }
}
```

Hit the same URL twice with a logging handler and it logs once. The handler wasn't skipped by a flag or a return-early check — it was **never invoked**, because nothing subscribed to the deferred observable that would have invoked it.

This is a demonstration, not a cache. An unbounded `Map` keyed by URL, with no TTL, no invalidation, and no awareness of the authenticated user, is a memory leak and a data-leak between users. Real caching is [article 50](../performance/caching.md); Nest's own `CacheInterceptor` is the same mechanism with those problems solved.

### Step 5 — retry and timeout, and the trap in each

```typescript
// src/pipeline/resilience.interceptor.ts
import {
  CallHandler, ExecutionContext, Injectable, NestInterceptor, RequestTimeoutException,
} from '@nestjs/common';
import type { Request } from 'express';
import { Observable, TimeoutError, catchError, identity, retry, throwError, timeout } from 'rxjs';

@Injectable()
export class ResilienceInterceptor implements NestInterceptor {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const request = context.switchToHttp().getRequest<Request>();
    const isIdempotent = request.method === 'GET' || request.method === 'HEAD';

    return next.handle().pipe(
      timeout(5_000),
      isIdempotent ? retry({ count: 2, delay: 200 }) : identity,
      catchError((error) =>
        throwError(() =>
          error instanceof TimeoutError ? new RequestTimeoutException() : error,
        ),
      ),
    );
  }
}
```

The `isIdempotent` guard is not defensive style, it's the mechanism. `retry` **resubscribes**, and resubscribing re-invokes `defer`, which re-runs the inner interceptors, the pipes, and the handler. On `POST /orders` that's a second order — and, measured, a second full pass through validation as well. There is nothing in RxJS that knows any of it had side effects.

And `timeout(5_000)` produces a 408 for the client while the handler continues to completion — the `subscriber.closed` branch discards the result, it doesn't cancel the work. So a timeout protects the *caller's* latency budget and nothing else: the connection stays held, the query still finishes, the write still lands. Real cancellation means passing an `AbortSignal` down to the driver.

`identity` from RxJS is the no-op operator; a conditional operator has to be *something*.

### Verify the loop

The trace endpoint from article 09 already prints where interceptors sit. What's worth testing directly is behaviour, and an interceptor is unusually easy to unit-test because `CallHandler` is one method:

```typescript
// src/pipeline/cache.interceptor.spec.ts
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
```

Then confirm the retry hazard for yourself:

```bash
# with retry applied unconditionally and a handler that writes, count the rows
curl -X POST localhost:3000/pipeline/orders
```

## Real-world patterns

**Envelope at the outermost interceptor, logging inside it.** Order matters: an error-logging interceptor bound *outside* the envelope sees the raw error; bound inside, it sees whatever the envelope did.

**Error logging in `catchError`, not only in a filter.** All interceptors run; exactly one filter does.

**Always re-throw from `catchError`.** Returning a value turns a failure into a success. If you meant to recover, say so explicitly and make sure the status is right.

**`finalize` for metrics, `tap` for success-only side effects.** `tap` skips errors; `finalize` doesn't.

**Retry only idempotent methods, and only on retriable errors.** Method-based gating is the floor; error-based gating (`retry({ delay: (err) => …})`) is better.

**Treat `timeout()` as a caller-facing SLA, not cancellation.** Pair it with a real deadline in the driver if the work is expensive.

**Never put authorization here.** It runs after guards, after status and headers are set, and cannot reject before the chain exists. See [guards](./guards.md).

**Give global response-shaping interceptors an opt-out decorator** from the first commit. Retrofitting one means auditing every route.

**Watch scope.** A request-scoped interceptor bound via `APP_INTERCEPTOR` makes every route pay per-request instantiation — the propagation from [article 06](../foundations/scopes-and-lifetimes.md).

## API reference

| Symbol | Import | Purpose |
| --- | --- | --- |
| `NestInterceptor` | `@nestjs/common` | `intercept(context, next)` |
| `CallHandler` | `@nestjs/common` | `handle(): Observable<unknown>` — deferred |
| `@UseInterceptors(...)` | `@nestjs/common` | controller or method binding |
| `APP_INTERCEPTOR` | `@nestjs/core` | global binding with DI; accumulates in declaration order |
| `app.useGlobalInterceptors(...)` | — | global binding without DI |
| `tap` | `rxjs` | observe next/error/complete without changing them |
| `finalize` | `rxjs` | run on complete, error, **or** unsubscribe |
| `map` | `rxjs` | reshape the emitted value |
| `catchError` | `rxjs` | translate or log; re-throw with `throwError` |
| `timeout` / `TimeoutError` | `rxjs` | caller-facing deadline — does **not** cancel the handler |
| `retry` | `rxjs` | resubscribe — **re-invokes the handler** |
| `identity` | `rxjs` | no-op operator, for conditional pipelines |
| `ClassSerializerInterceptor` | `@nestjs/common` | `@Exclude()`-aware serialization — [article 18](../validation/serialization-and-response-shaping.md) |

## Common mistakes

**1. Not returning the observable.** `next.handle()` without `return` means nothing is subscribed and the request hangs with no error.

**2. Swallowing errors in `catchError`.** Returning `of(null)` converts a 500 into a `200 null`. Re-throw with `throwError`.

**3. `retry()` on a non-idempotent handler.** Resubscription re-invokes the handler. Two orders, two charges, two emails.

**4. Assuming `timeout()` cancels the work.** The client gets 408; the query, the connection, and the write all continue.

**5. Timing with `tap` alone.** Failures are excluded from your latency metric — usually the slowest requests. Use `finalize`.

**6. Expecting to see guard-rejected requests.** Guards run outside the chain. Nothing here executes for a 403.

**7. Expecting a `map` to apply to a `@Res()` handler.** That handler owns the response; its return value is discarded.

**8. Expecting a `map` to apply to errors.** Errors bypass `map` and are shaped by filters. Success and error envelopes must be kept in sync by hand.

**9. Authorization in an interceptor.** Too late and too deep. Use a guard.

**10. A global envelope with no opt-out.** Health checks, downloads, and fixed-contract webhooks break, and the fix is a decorator you should have had from the start.

## How this evolved

The `intercept(context, next)` shape hasn't changed; the machinery under it has been hardened around async context and teardown. `AsyncResource.bind` around the deferred factories is what makes `AsyncLocalStorage` usable through the chain — and the source comment explains that `next()` is called eagerly inside the bound scope specifically to avoid losing that context, which is a deliberate trade against laziness. The `subscriber.closed` branch in `transformDeferred` exists because SSE clients disconnect mid-stream, and it ensures a producer observable's teardown still runs even when its value is no longer wanted. Both are recent-ish refinements, invisible in the public API, and both explain behaviour you would otherwise find inexplicable.

## Exercises

**1. Prove the deferral.** Write an interceptor that returns `of('replaced')` without calling `handle()`, put a log in the handler, and confirm it never prints. *Hint: this is the entire mechanism behind caching, in three lines.*

**2. Count the writes.** Apply `retry({ count: 2 })` unconditionally to a `POST` handler that appends to an array, make it fail once, and count the entries. *Hint: the count is not what a reader of the interceptor would predict.*

**3. Watch a timeout not cancel.** Put `timeout(500)` on a handler that logs after a 2-second sleep. Observe the 408, then wait. *Hint: the log still arrives, which is the point.*

## Summary

- `next.handle()` returns a **deferred** observable. Subscribing runs the rest of the chain, the pipes, and the handler.
- **Not subscribing short-circuits** the handler entirely — the caching mechanism.
- **Subscribing twice runs the handler twice** — the retry mechanism, and the double-write hazard.
- **Unsubscribing does not cancel.** `timeout()` gives the client a 408 while the handler runs to completion and its result is discarded.
- No interceptors bound means `return next()` with no RxJS at all.
- `AsyncResource.bind` around the deferred factories is what keeps `AsyncLocalStorage` intact across the chain.
- `tap` skips errors; `finalize` doesn't. `map` skips errors too — error shape belongs to filters.
- All interceptors run, unlike filters — so `catchError` is the right place for error logging.

## See also

- [Execution order](./execution-order.md#how-it-works-under-the-hood) — why pipes run inside the chain and guards outside it
- [Guards](./guards.md) — the layer that rejects before any of this runs
- [Exception filters](./exception-filters.md) — error response shape, and why only one runs
- [Middleware](./middleware.md#real-world-patterns) — where an `AsyncLocalStorage` store is opened
- [Serialization and response shaping](../validation/serialization-and-response-shaping.md) — `ClassSerializerInterceptor` and `@Exclude()`
- [Caching](../performance/caching.md) — the real version of Step 4
- [Recipe: my interceptor ran the handler twice](../recipes/request-lifecycle/interceptor-ran-the-handler-twice.md)

## References

- [Interceptors](https://docs.nestjs.com/interceptors) — official docs
- [`packages/core/interceptors/interceptors-consumer.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/interceptors/interceptors-consumer.ts) — the recursive fold, `defer`, `AsyncResource.bind`, and `transformDeferred`'s teardown branch
- [`packages/core/router/router-execution-context.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/router/router-execution-context.ts) — where the chain is invoked, and the SSE exception
- [RxJS operator reference](https://rxjs.dev/api) — `finalize`, `retry`, `timeout`, `identity`

## Demo source

`demos/foundations/` — extends `pipeline/` with timing, envelope, error-log, cache, and resilience interceptors.