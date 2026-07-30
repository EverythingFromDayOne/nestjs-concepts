---
article_id: exception-filters
concept_folder: request-lifecycle
wave: 1
nest_baseline: "11.1.x"
node_baseline: "24"
related:
  - request-lifecycle/execution-order
  - request-lifecycle/interceptors
  - request-lifecycle/guards
  - request-lifecycle/pipes
  - observability/logging
  - recipes/request-lifecycle/filter-swallowed-the-error
status:
  drafted: true
  reviewed: false
v12_watch: false
---

# Exception filters

> **Lead with this.** Filters are where a thrown error becomes an HTTP response, and they are the only layer where **exactly one** participant runs. That single fact produces the two most expensive mistakes in Nest error handling, and neither announces itself. Adding a route-level filter silently removes the global one from that route — so whatever the global filter was doing, including logging, quietly stops. And the built-in filter **never logs an `HttpException`** — only unknown errors — so a custom catch-all filter that doesn't delegate to `super.catch()` deletes the framework's error logging entirely. Both failures look like a working application that has stopped telling you anything.

## What it is

A class with one method and a decorator declaring what it claims:

```typescript
@Catch(HttpException)
export class HttpExceptionFilter implements ExceptionFilter {
  catch(exception: HttpException, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    response.status(exception.getStatus()).json({ message: exception.message });
  }
}
```

`@Catch()` with no arguments claims everything. `@Catch(A, B)` claims those types and their subclasses.

Note the second parameter's type: **`ArgumentsHost`, not `ExecutionContext`.** That's not an oversight — §How it works shows the host a filter receives genuinely has no handler or class attached, so `getHandler()` and `Reflector` are unavailable here. A filter knows the transport and the error. It does not know which route threw.

From [article 09](./execution-order.md#filters-reverse-the-array-and-only-one-runs): filters are assembled as `[...global, ...class, ...method]`, that array is **reversed**, and the first match wins. Most specific runs; nothing else does.

> **If you know Angular.** `ErrorHandler` is the analogue and it inverts in the way that matters most: Angular's is a **singleton** — one handler, every error, no selection, no shadowing. Nest's is a **set of competing claims** where one wins, which means "I added a handler" can mean "I removed a handler" for some routes. The other inversion is purpose. Angular's `ErrorHandler` exists so the app doesn't die and the user sees something friendly; a Nest filter's output *is* the API contract — status code, body shape, error codes clients switch on. Treating it as a place to make things look nice, rather than as a published interface, is how error shapes end up inconsistent across a codebase.

## How it works under the hood

### The handler is wrapped in a try/catch that discards the context

```typescript
// paraphrased from packages/core/router/router-proxy.ts
return async (req, res, next) => {
  try {
    await targetCallback(req, res, next);
  } catch (e) {
    const host = new ExecutionContextHost([req, res, next]);   // ← no class, no handler
    exceptionsHandler.next(e, host);
    return res;
  }
};
```

Compare with the hosts built for [guards](./guards.md#the-context-is-built-from-the-controller-and-the-method) and interceptors, which pass `instance.constructor` and `callback`. Here only the transport arguments survive. That's why the parameter is typed `ArgumentsHost` and why metadata-driven filters aren't a thing — by the time an exception is being formatted, the framework has stopped tracking what was running.

If you need per-route error behaviour, the choices are a route-level filter, or metadata read *earlier* by an interceptor's `catchError` (which does have the full context).

### One filter is selected, or the default runs

```typescript
// paraphrased from packages/core/exceptions/exceptions-handler.ts
export class ExceptionsHandler extends BaseExceptionFilter {
  public next(exception: Error | HttpException, ctx: ArgumentsHost) {
    if (this.invokeCustomFilters(exception, ctx)) {
      return;
    }
    super.catch(exception, ctx);                 // ← the built-in behaviour
  }

  public invokeCustomFilters(exception, ctx): boolean {
    if (isEmpty(this.filters)) return false;
    const filter = selectExceptionFilterMetadata(this.filters, exception);
    filter && filter.func(exception, ctx);
    return !!filter;
  }
}
```

Two details beyond article 09's "only one runs":

- **The default filter is the fallback, not a participant.** `super.catch()` runs only when no custom filter matched. A global `@Catch()` with no arguments therefore *replaces* the built-in entirely, for every exception in the application.
- **`filter.func(...)` is not awaited.** `next()` isn't async, and the router proxy doesn't await it either. An `async catch()` works in practice — Express doesn't care when you call `res.json()` — but nothing is waiting for it, so **a rejection inside an async filter is an unhandled rejection**, which under Node's default is fatal. If a filter must await anything, it owns its own try/catch.

### What the built-in filter actually does

```typescript
// paraphrased from packages/core/exceptions/base-exception-filter.ts
@Optional() @Inject()
protected readonly httpAdapterHost?: HttpAdapterHost;

constructor(protected readonly applicationRef?: HttpServer) {}

catch(exception: T, host: ArgumentsHost) {
  const applicationRef = this.applicationRef || this.httpAdapterHost?.httpAdapter!;

  if (!(exception instanceof HttpException)) {
    return this.handleUnknownError(exception, host, applicationRef);
  }
  const res = exception.getResponse();
  const message = isObject(res) ? res : { statusCode: exception.getStatus(), message: res };

  const response = host.getArgByIndex(1);
  if (!applicationRef.isHeadersSent(response)) {
    applicationRef.reply(response, message, exception.getStatus());
  } else {
    applicationRef.end(response);
  }
}

public handleUnknownError(exception, host, applicationRef) {
  const body = this.isHttpError(exception)
    ? { statusCode: exception.statusCode, message: exception.message }
    : { statusCode: HttpStatus.INTERNAL_SERVER_ERROR, message: MESSAGES.UNKNOWN_EXCEPTION_MESSAGE };
  // …reply or end…
  if (!(exception instanceof IntrinsicException)) {
    BaseExceptionFilter.logger.error(exception);          // ← only here
  }
}
```

Five things worth having in your head:

- **`HttpException`s are never logged.** The `logger.error` call lives only in `handleUnknownError`. Every 400, 401, 403, 404, and 409 your application produces is silent by default. If you want them, that's [logging](../observability/logging.md) work — or an interceptor's `catchError`.
- **`getResponse()` decides the body.** If a custom exception passes an **object** to `super()`, that object *is* the response body, verbatim. A string gets wrapped as `{ statusCode, message }`. This is the cheapest way to control error shape and it needs no filter at all.
- **Unknown errors get `isHttpError` sniffing.** Anything shaped `{ statusCode, message }` — which is what the `http-errors` library produces, and therefore what `body-parser` throws for malformed JSON or an oversized payload — keeps its own status instead of becoming a 500. That's why a broken JSON body returns 400 rather than 500 even though nothing in your code threw an `HttpException`. **Your own filter has to preserve that**, and it's easy not to: a filter that nests `getResponse()` under its own `message` field turns an already-structured body into `{"statusCode":400,"message":{"message":"…","error":"Bad Request","statusCode":400}}`. Mirror what the built-in does — object payloads become the body, strings get wrapped.
- **`isHeadersSent` guards both paths.** If the response has already started — a `@Res()` handler that replied, a stream mid-flight — the filter calls `end()` instead of `reply()`. It cannot rewrite what's already gone. This is the mechanism behind "my filter didn't change the response" on handlers that own their own response ([article 03](../foundations/controllers-and-routing.md#step-4--the-res-trap)).
- **`applicationRef` arrives by property injection.** `@Optional() @Inject()` on `httpAdapterHost` is only populated when the container instantiates the filter. So a filter that `extends BaseExceptionFilter` and is registered with `useGlobalFilters(new MyFilter())` has **no adapter** and fails inside itself. Register it with `APP_FILTER`, or pass the adapter explicitly — the DI point from [article 09](./execution-order.md#minimal-shapes), with teeth.

`IntrinsicException` is Nest's opt-out for framework errors it doesn't want double-logged; throwing one from your own code suppresses the default log line, which is occasionally what you want and easy to misuse.

## Minimal shapes

```typescript
// shape the body from the exception — no filter needed
throw new HttpException({ code: 'ORDER_LOCKED', orderId }, HttpStatus.CONFLICT);

// a filter for one exception type
@Catch(QueryFailedError)
export class DatabaseFilter implements ExceptionFilter { catch(e, host) { /* … */ } }

// a catch-all that keeps the framework's behaviour for what it doesn't handle
@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    if (!(exception instanceof HttpException)) {
      // …your reporting…
    }
    super.catch(exception, host);        // ← delegate, don't replace
  }
}

// binding
providers: [{ provide: APP_FILTER, useClass: AllExceptionsFilter }]   // global, with DI
@UseFilters(DatabaseFilter)                                          // controller or route
```

## Walkthrough — five ways this layer surprises you

We extend the `pipeline/` module from articles 09–13.

### Step 1 — what the default already does

Before writing any filter, see the baseline:

```typescript
// src/pipeline/errors.controller.ts
import { Controller, ForbiddenException, Get, HttpException, HttpStatus } from '@nestjs/common';

@Controller('errors')
export class ErrorsController {
  @Get('http')
  http(): never {
    throw new ForbiddenException('nope');
  }

  @Get('object')
  object(): never {
    throw new HttpException({ code: 'ORDER_LOCKED', orderId: 42 }, HttpStatus.CONFLICT);
  }

  @Get('unknown')
  unknown(): never {
    throw new Error('something broke');
  }
}
```

```bash
curl -i localhost:3000/errors/http     # 403 {"message":"nope","error":"Forbidden","statusCode":403}
curl -i localhost:3000/errors/object   # 409 {"code":"ORDER_LOCKED","orderId":42}   ← body verbatim
curl -i localhost:3000/errors/unknown  # 500 {"statusCode":500,"message":"Internal server error"}
```

Now read the server log. **Only the third one produced a line.** The 403 is invisible — no log, no metric, no trace. Applications routinely run for years without anyone noticing that their 4xx traffic is unlogged, and then a client reports "your API rejects us" and there's nothing to look at.

Also note `/errors/object`: passing an object to `HttpException` gave complete control of the response body with no filter involved. Reach for that before reaching for a filter.

### Step 2 — the catch-all that deletes your logging

The natural first filter:

```typescript
// src/pipeline/all-exceptions.filter.ts — ✗ loses the framework's logging
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    response.status(status).json({ error: true, status });
  }
}
```

Registered globally, this is now the *only* filter that ever runs. `super.catch()` is never reached, so `handleUnknownError`'s `logger.error(exception)` never runs either. Every 500 in the application becomes a tidy JSON body and **zero** stack traces. The application looks healthier than before, which is the whole problem.

Two ways to keep the behaviour:

```typescript
// src/pipeline/all-exceptions.filter.ts — ✓ extend and delegate
@Catch()
export class AllExceptionsFilter extends BaseExceptionFilter {
  private readonly logger = new Logger('errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    if (!(exception instanceof HttpException)) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }
    super.catch(exception, host);
  }
}
```

```typescript
// or ✓ own the response and own the logging explicitly
// src/pipeline/all-exceptions.filter.ts
import {
  ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger,
} from '@nestjs/common';
import type { Request, Response } from 'express';

@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger('errors');

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const response = http.getResponse<Response>();
    const request = http.getRequest<Request & { correlationId?: string }>();

    const status = exception instanceof HttpException
      ? exception.getStatus()
      : HttpStatus.INTERNAL_SERVER_ERROR;

    if (status >= 500) {
      this.logger.error(
        `${request.method} ${request.originalUrl} cid=${request.correlationId ?? '-'}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    if (response.headersSent) {
      response.end();                    // ← see Step 5; nothing can be rewritten now
      return;
    }

    // `getResponse()` may be a string or an object. Nesting an object under
    // `message` double-wraps it — measured against a malformed-JSON request,
    // which arrives as an HttpException whose response is already
    // { message, error, statusCode }.
    const payload = exception instanceof HttpException
      ? exception.getResponse()
      : 'Internal server error';

    response.status(status).json(
      typeof payload === 'string'
        ? { statusCode: status, message: payload, correlationId: request.correlationId }
        : { ...(payload as object), correlationId: request.correlationId },
    );
  }
}
```

The second is more code and more honest: it states the contract, and the correlation id from [article 10](./middleware.md#step-1--a-correlation-id-and-why-it-has-to-be-here) makes a support ticket traceable to a log line. If you take the first, remember `super.catch()` needs the adapter — so `APP_FILTER`, not `useGlobalFilters(new …)`.

**Never leak the raw message for a 500.** `exception.message` on a database error can contain a query, a constraint name, or a value. Log it; don't send it.

### Step 3 — exception shape versus filter shape

Two ways to control an error response, and they belong to different concerns:

```typescript
// ✓ domain semantics — the exception carries the contract
export class OrderLockedException extends ConflictException {
  constructor(orderId: number) {
    super({ code: 'ORDER_LOCKED', orderId });
  }
}
```

The second example below imports `QueryFailedError` from TypeORM, which the `foundations` demo does not have — it is illustrative here and gets built for real in Wave 2.

```typescript
// ✓ cross-cutting translation — the filter maps a foreign error into your contract
import { ArgumentsHost, Catch, ExceptionFilter, HttpStatus } from '@nestjs/common';
import type { Response } from 'express';
import { QueryFailedError } from 'typeorm';

@Catch(QueryFailedError)
export class DatabaseExceptionFilter implements ExceptionFilter {
  catch(exception: QueryFailedError, host: ArgumentsHost): void {
    const isUniqueViolation = (exception as { code?: string }).code === '23505';
    const status = isUniqueViolation ? HttpStatus.CONFLICT : HttpStatus.INTERNAL_SERVER_ERROR;

    host.switchToHttp().getResponse<Response>().status(status).json({
      statusCode: status,
      message: isUniqueViolation ? 'Resource already exists' : 'Internal server error',
    });
  }
}
```

The rule: **your own errors should be exceptions; other people's errors need filters.** A custom exception subclass keeps the status and body next to the domain rule that produced it, and needs no registration. A filter is for translating errors you don't control — driver errors, third-party SDK errors — into your contract, and for doing it in one place rather than in fifty try/catch blocks.

`23505` is Postgres's unique-violation code, and hard-coding driver codes in a filter is a real coupling; article 29 covers where those belong.

### Step 4 — the route filter that blinds the global one

```typescript
@UseFilters(DatabaseExceptionFilter)     // narrow: @Catch(QueryFailedError)
@Post('items')
create(@Body() dto: CreateItemDto): unknown { /* … */ }
```

`DatabaseExceptionFilter` claims only `QueryFailedError`, so `selectExceptionFilterMetadata` won't match a `ForbiddenException` and the global filter still handles it — fine. But make the route filter `@Catch()` and every exception on that route stops reaching the global one: no logging, no correlation id, a different body shape from the rest of the API.

The rules that follow:

- **Route-level filters should be narrow.** `@Catch(SpecificError)`, never `@Catch()`.
- **A global catch-all is the only catch-all.** One in the application.
- **Put error observability where all participants run.** From [article 12](./interceptors.md#step-3--where-error-logging-belongs), every interceptor's `catchError` fires regardless of which filter eventually formats the response. Logging there is immune to this whole class of bug.

That last point is the strongest structural advice in the folder: the layer that decides the response is winner-takes-all, so don't attach observability to it.

### Step 5 — headers already sent, and async filters

Two ways a filter quietly does nothing.

**The response already started:**

```typescript
@Get('stream')
stream(@Res() res: Response): void {
  res.write('partial');
  throw new Error('too late');      // headers are out
}
```

`isHeadersSent(response)` is true, so the built-in filter calls `end()` rather than `reply()`. A custom filter calling `response.status(500).json(...)` here throws `ERR_HTTP_HEADERS_SENT` **inside the filter**, and there is no filter for filters. Any filter that might see a streaming or `@Res()` handler must check:

```typescript
if (response.headersSent) {
  response.end();
  return;
}
```

**An async filter that rejects:**

```typescript
// ✗ nothing awaits this
@Catch()
export class ReportingFilter implements ExceptionFilter {
  async catch(exception: unknown, host: ArgumentsHost): Promise<void> {
    await this.sentry.report(exception);          // if this rejects → unhandled rejection
    host.switchToHttp().getResponse<Response>().status(500).json({ error: true });
  }
}
```

`filter.func(...)` isn't awaited by `invokeCustomFilters`, so a rejection here escapes as an unhandled rejection — fatal under Node's default. Worse, the response isn't sent until the reporting call resolves, so a slow error tracker becomes slow error responses. Send the response first, report fire-and-forget with its own `.catch()`:

```typescript
catch(exception: unknown, host: ArgumentsHost): void {
  const response = host.switchToHttp().getResponse<Response>();
  if (!response.headersSent) {
    response.status(500).json({ error: true });
  }
  void this.sentry.report(exception).catch(() => undefined);   // never block the response
}
```

### Verify the loop

A filter is testable directly, because `ArgumentsHost` is small:

```typescript
// src/pipeline/all-exceptions.filter.spec.ts
import { ArgumentsHost, ForbiddenException, HttpStatus } from '@nestjs/common';
import { AllExceptionsFilter } from './all-exceptions.filter';

function hostFor(): { host: ArgumentsHost; json: jest.Mock; status: jest.Mock } {
  const json = jest.fn();
  const status = jest.fn().mockReturnValue({ json });
  const host = {
    switchToHttp: () => ({
      getResponse: () => ({ status, json, headersSent: false }),
      getRequest: () => ({ method: 'GET', originalUrl: '/x' }),
    }),
  } as unknown as ArgumentsHost;
  return { host, json, status };
}

describe('AllExceptionsFilter', () => {
  it('preserves an HttpException status', () => {
    const { host, status } = hostFor();
    new AllExceptionsFilter().catch(new ForbiddenException('nope'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.FORBIDDEN);
  });

  it('maps an unknown error to 500', () => {
    const { host, status } = hostFor();
    new AllExceptionsFilter().catch(new Error('boom'), host);
    expect(status).toHaveBeenCalledWith(HttpStatus.INTERNAL_SERVER_ERROR);
  });
});
```

Then the thing a unit test can't show — which filter actually ran:

```bash
curl -i localhost:3000/errors/http      # global filter's shape?
curl -i localhost:3000/errors/unknown   # and is there a stack trace in the log?
curl -i -X POST localhost:3000/pipeline/items -d 'not json' -H 'content-type: application/json'
#   ↑ 400 from body-parser via isHttpError, not 500 — worth seeing once
```

The third one is the check people never think to run, and it's the one that tells you whether your catch-all is mangling framework errors.

## Real-world patterns

**One global catch-all; route filters narrow.** `@Catch()` appears exactly once in an application.

**Extend `BaseExceptionFilter` and call `super.catch()`** unless you're deliberately replacing the whole contract — and if you extend it, register with `APP_FILTER` so the adapter gets injected.

**Custom exceptions for your domain, filters for foreign errors.** `class OrderLockedException extends ConflictException` needs no registration and keeps the contract beside the rule.

**Pass an object to `HttpException` when the body needs structure.** `getResponse()` output becomes the body verbatim — a machine-readable `code` field costs nothing and saves clients string-matching on `message`.

**Log 5xx, count 4xx.** Stack traces for server faults; metrics for client faults. Neither happens by default.

**Never send a raw error message on a 500.** Log it, return something generic, include the correlation id so the two can be joined.

**Error observability belongs in an interceptor.** All of them run; one filter does.

**Always check `headersSent`** in any filter that might see a streaming or `@Res()` handler.

**Keep `catch()` synchronous.** Respond, then report fire-and-forget with its own `.catch()`.

## API reference

| Symbol | Import | Purpose |
| --- | --- | --- |
| `ExceptionFilter<T>` | `@nestjs/common` | `catch(exception, host)` |
| `@Catch(...types)` | `@nestjs/common` | what the filter claims; no args = everything |
| `ArgumentsHost` | `@nestjs/common` | `switchToHttp()`, `getType()`, `getArgByIndex()` — **no handler or class** |
| `@UseFilters(...)` | `@nestjs/common` | controller or route binding; most specific wins |
| `APP_FILTER` | `@nestjs/core` | global binding **with** DI — required if you extend `BaseExceptionFilter` |
| `app.useGlobalFilters(...)` | — | global binding without DI |
| `BaseExceptionFilter` | `@nestjs/core` | the built-in behaviour; `super.catch()` to delegate |
| `HttpException` | `@nestjs/common` | `getStatus()`, `getResponse()` — an object response becomes the body |
| `HttpAdapterHost` | `@nestjs/core` | the adapter, when you need `isHeadersSent`/`reply` directly |
| `IntrinsicException` | `@nestjs/common` | suppresses the default error log |

## Common mistakes

**1. A global `@Catch()` that doesn't delegate or log.** `super.catch()` never runs, so the framework's 500 logging disappears and the app looks healthier than it is.

**2. Assuming `HttpException`s are logged.** They never are. Only `handleUnknownError` logs.

**3. A route-level `@Catch()`.** It shadows the global filter for that route — different shape, no logging, no correlation id.

**4. Expecting several filters to run.** Exactly one does.

**5. Using `Reflector` inside a filter.** The host has no handler or class. Read metadata in an interceptor instead.

**6. `useGlobalFilters(new MyFilter())` on a `BaseExceptionFilter` subclass.** `httpAdapterHost` is property-injected, so it's `undefined` and the filter fails inside itself.

**7. Not checking `headersSent`.** On a streaming or `@Res()` handler, responding again throws inside the filter, where nothing catches it.

**8. An `async catch()` that can reject.** Nothing awaits it; a rejection is an unhandled rejection, and a slow await delays the response.

**9. Sending `exception.message` on a 500.** Driver messages leak queries, constraint names, and values.

**10. Formatting errors without matching the success shape.** If an interceptor wraps successes in `{ data }`, errors bypass it — [article 12](./interceptors.md#step-2--a-response-envelope-and-what-it-costs) — so the two shapes have to be kept aligned by hand.

## How this evolved

The `catch(exception, host)` contract is unchanged. The refinements are all in the built-in filter: `isHttpError` sniffing means `http-errors`-shaped failures from `body-parser` keep their own status instead of collapsing to 500; the `isHeadersSent` branches were added so a filter can't corrupt a response that already started; and `IntrinsicException` gave the framework a way to raise errors without triggering the default log, which also gives you one. `ArgumentsHost` has always been deliberately narrower than `ExecutionContext` — the source shows why, since the host built at catch time genuinely has no handler to offer.

## Exercises

**1. Find the silence.** Throw a `ForbiddenException` and an `Error` from two routes, then look at the log. *Hint: one of them produced nothing, and that's the default for every 4xx your API returns.*

**2. Delete your logging, then notice.** Register a global `@Catch()` filter that responds without calling `super.catch()` or logging, then trigger a 500. *Hint: the response looks better than before, which is what makes this dangerous.*

**3. Break a filter from inside.** Write a handler that uses `@Res()`, writes a partial response, then throws — with a filter that calls `response.status(500).json(...)` unconditionally. *Hint: the error you get has no filter of its own.*

## Summary

- Filters are assembled global → class → method, then **reversed**; the most specific match runs and **nothing else does**.
- The built-in filter is the **fallback**, reached only when no custom filter matched. A global `@Catch()` replaces it entirely.
- **`HttpException`s are never logged.** Only `handleUnknownError` logs, and only for non-`IntrinsicException` errors.
- `getResponse()` returning an object makes that object the response body verbatim — error shape without a filter.
- Unknown errors shaped `{ statusCode, message }` keep their status via `isHttpError`, which is why malformed JSON is a 400.
- `isHeadersSent` means a filter cannot rewrite a response that already started.
- `applicationRef` is **property-injected**, so `BaseExceptionFilter` subclasses must be registered with `APP_FILTER`.
- `catch()` is **not awaited**. Respond synchronously; report fire-and-forget.
- Filters receive `ArgumentsHost` — no handler, no class, no `Reflector`.

## See also

- [Execution order](./execution-order.md#filters-reverse-the-array-and-only-one-runs) — the reversal and the single-winner rule
- [Interceptors](./interceptors.md#step-3--where-error-logging-belongs) — where error observability belongs instead
- [Guards](./guards.md#step-2--throw-to-say-what-happened) — throwing to choose the status
- [Pipes](./pipes.md) — validation failures, which are catchable by interceptors on their way here
- [Logging](../observability/logging.md) — structured logging, and making 4xx visible
- [Recipe: my filter swallowed the error](../recipes/request-lifecycle/filter-swallowed-the-error.md)

## References

- [Exception filters](https://docs.nestjs.com/exception-filters) — official docs
- [`packages/core/exceptions/exceptions-handler.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/exceptions/exceptions-handler.ts) — single selection, and `super.catch()` as fallback
- [`packages/core/exceptions/base-exception-filter.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/exceptions/base-exception-filter.ts) — `getResponse()` as body, `isHttpError`, `isHeadersSent`, and the log that only fires for unknown errors
- [`packages/core/router/router-proxy.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/router/router-proxy.ts) — the try/catch, and the host built without a handler

## Demo source

`demos/foundations/` — extends `pipeline/` with `errors.controller.ts` and `all-exceptions.filter.ts`. The `QueryFailedError` filter from Step 3 needs TypeORM and lands with the `data/` demo in Wave 2.