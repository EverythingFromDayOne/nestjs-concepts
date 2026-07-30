# Cursor prompt — verify articles 08–15 in `demos/foundations`

> Save as `prompts/verify-foundations-demo-lifecycle-pipeline.md`. Paste everything below the line into Cursor as a single instruction.

---

You are extending the existing `demos/foundations` app so it compiles and runs the code in **eight** articles:

- `foundations/bootstrap-and-lifecycle-hooks.md` (08)
- `request-lifecycle/execution-order.md` (09)
- `request-lifecycle/middleware.md` (10)
- `request-lifecycle/guards.md` (11)
- `request-lifecycle/interceptors.md` (12)
- `request-lifecycle/pipes.md` (13)
- `request-lifecycle/exception-filters.md` (14)
- `request-lifecycle/execution-context-and-reflector.md` (15)

## The discipline, unchanged

Lift the code **verbatim**. Do not improve it, rename things, or reorder imports. A sample that doesn't compile or doesn't behave as claimed is a **finding to report**, not a thing to quietly repair. Smallest possible change for a green build; record every one. **Never edit a `.md` file.**

Where an article shows a `✗` version followed by a `✓` version, take the `✓` one — except inside the experiments, which deliberately apply broken versions and revert.

## 1. Two new folders

`src/lifecycle/` from article 08 and `src/pipeline/` from articles 09–15. Article 09 creates `pipeline/`; articles 10–15 each add to it.

| File | Article |
| --- | --- |
| `src/lifecycle/first.service.ts`, `second.service.ts` | 08 Step 2, including the `whenReady()` variant |
| `src/lifecycle/lifecycle.module.ts` | 08 Step 3 — module class with its own `onModuleInit` |
| `src/lifecycle/drain.service.ts` | 08 Step 4 |
| `src/lifecycle/lifecycle.spec.ts` | 08 "Verify the loop" |
| `src/pipeline/trace.service.ts`, `trace.middleware.ts`, `trace.guard.ts`, `trace.interceptor.ts`, `trace.pipe.ts`, `trace.filter.ts`, `pipeline.controller.ts`, `pipeline.module.ts` | 09 Step 1 |
| `src/pipeline/route.filter.ts` | 09 Step 5 |
| `src/pipeline/correlation-id.middleware.ts`, `access-log.middleware.ts`, `no-cache.middleware.ts` | 10 |
| `src/pipeline/api-key.guard.ts`, `naive.guard.ts`, `roles.guard.ts`, `public.decorator.ts`, `roles.guard.spec.ts` | 11 |
| `src/pipeline/timing.interceptor.ts`, `envelope.interceptor.ts`, `raw-response.decorator.ts`, `error-log.interceptor.ts`, `cache.interceptor.ts`, `cache.interceptor.spec.ts`, `resilience.interceptor.ts` | 12 |
| `src/pipeline/trim.pipe.ts`, `trim.pipe.spec.ts`, `dto/create-item.interface.ts`, `dto/create-item.dto.ts` | 13 |
| `src/pipeline/errors.controller.ts`, `all-exceptions.filter.ts` | 14 — the **explicit** `✓` filter, not the `extends BaseExceptionFilter` one |
| `src/pipeline/context-probe.ts`, `transport-aware-api-key.guard.ts`, `transport-aware-api-key.guard.spec.ts`, `context-double.ts` | 15 |

Article 08 Step 1's `SchemaCache` needs a `loadSchemaFrom`: write a local stub that resolves `{ ok: true }` after 50 ms, and say so in the report.

Skip article 14's `DatabaseExceptionFilter` — it imports TypeORM, which this demo doesn't have. The article says so.

## 2. Registration conflicts — read this before wiring anything

Eight articles each say "register this globally," and some of those collide. **These are my decisions, not yours to re-litigate — but report if any of them doesn't work.**

1. **One global filter only.** Article 14's `AllExceptionsFilter` (`@Catch()`) is the sole `APP_FILTER`. Article 09's `TraceFilter` binds at **controller level** with `@UseFilters(TraceFilter)` on `PipelineController`, not as `APP_FILTER` as article 09 shows. That's a deliberate deviation — and it makes article 14's Step 4 claim (a controller filter shadows the global one) directly observable. Report it as a deviation.
2. **`EnvelopeInterceptor` is global** (`APP_INTERCEPTOR`) per article 12 — **and** `PipelineController` and `ErrorsController` both carry `@RawResponse()`. Without the opt-out, the envelope rewrites the trace and error bodies every other experiment reads. This exercises the opt-out mechanism article 12 insists on.
3. **`TraceGuard` and `TraceInterceptor` are global** per article 09. They will mark traces for pre-existing routes too; that's fine, `TraceService.drain()` empties the list.
4. **`RolesGuard` is global** per article 11. Safe as written, because it returns `true` when no `@Roles()` metadata is present — confirm that's true for the cats/orders/catalog routes from articles 01–04.
5. **`ApiKeyGuard` is NOT global.** Bind it with `@UseGuards(ApiKeyGuard)` on **one** route only (`GET /pipeline/protected`, which you'll add). Global would require an `x-api-key` header on every earlier article's `curl`. Deviation from article 11's "or globally" line; report it.
6. **`ValidationPipe` is global** (`APP_PIPE`) with `{ whitelist: true, transform: true }` — article 13's interface trap needs it. **Check and report** whether this changes the behaviour of any handler from articles 01–04; the inline body types there (`@Body() cat: Cat`) may well erase to `Object` and be skipped, which is itself worth confirming.
7. **`TimingInterceptor`, `ErrorLogInterceptor`, `TinyCacheInterceptor`, `ResilienceInterceptor`** bind at controller level on `PipelineController`. Global caching and global retry would corrupt other experiments.
8. `main.ts` gets `bufferLogs: true` and `app.enableShutdownHooks()` per article 08, plus `ContextIdFactory.apply(...)` already there from the previous task.

Add `LifecycleModule` and `PipelineModule` to `AppModule.imports`.

## 3. Build and test

```bash
pnpm install
pnpm --filter foundations-demo build
pnpm --filter foundations-demo test
```

All specs must pass. Report the output and the resolved `rxjs` version.

## 4. Experiments — article 13 first, it's the highest value

### P1 — the interface DTO accepts anything *(article 13 Step 4)*

Two handlers on `PipelineController`, one taking `CreateItemInterface` and one taking `CreateItemDto`, both echoing the body. With the global `ValidationPipe({ whitelist: true })`:

```bash
curl -i -X POST localhost:3000/pipeline/items-interface -H 'content-type: application/json' \
  -d '{"name":"","quantity":"not-a-number","injected":"surprise"}'
curl -i -X POST localhost:3000/pipeline/items-dto -H 'content-type: application/json' \
  -d '{"name":"","quantity":"not-a-number","injected":"surprise"}'
```

**Expected:** the first returns 201 with `injected` **echoed back** and `quantity` still a string; the second returns 400 listing both violations. Then post a *valid* payload with an extra field to the DTO route and confirm `injected` is **stripped**.

Also print `Reflect.getMetadata('design:paramtypes', PipelineController.prototype, 'itemsInterface')` and the DTO equivalent. **Expected:** `[Object]` versus `[CreateItemDto]`.

This is the single most important claim in the corpus. Be precise.

### P2 — pipe chain order *(article 13 Step 2)*

Add `@Query('page', new DefaultValuePipe(1), ParseIntPipe)` and a second route with the pipes reversed. Request both **without** the query parameter. **Expected:** the first returns 1; the second 400s because `ParseIntPipe` sees `undefined`.

### P3 — parameters resolve concurrently *(article 13 Step 5)*

A handler with two piped parameters, both invalid, one pipe awaiting 50 ms. Run it 20 times and report whether the reported error is stable.

## 5. Experiments — article 12 (interceptors)

### I1 — deferral short-circuits

With `TinyCacheInterceptor` on a `GET` handler that logs on entry, request the same URL twice. **Expected:** the handler logs **once**. The `cache.interceptor.spec.ts` asserts this too — report both.

### I2 — retry re-invokes the handler

Temporarily apply `retry({ count: 2 })` **unconditionally** in `ResilienceInterceptor`, on a `POST /pipeline/orders` handler that pushes to an array and throws on the first two calls. Report the array length. **Expected:** 3 entries for one client request. **Revert** to the `isIdempotent` version.

### I3 — timeout does not cancel

A handler that logs after a 2-second sleep, with `timeout(500)`. **Expected:** the client gets 408 (or `RequestTimeoutException`) at ~500 ms **and the handler's log still appears** at ~2 s. Report both timestamps.

### I4 — `tap` misses errors, `finalize` doesn't

Time a failing handler with a `tap`-based interceptor and a `finalize`-based one. **Expected:** `tap` logs nothing, `finalize` logs.

## 6. Experiments — article 14 (filters)

### F1 — are 4xx logged at all?

```bash
curl -i localhost:3000/errors/http      # ForbiddenException
curl -i localhost:3000/errors/unknown   # plain Error
```

Report the **complete** server log for both. **Expected:** the `Error` produces a stack trace; the `ForbiddenException` produces **nothing**.

### F2 — a catch-all that deletes logging

Temporarily replace `AllExceptionsFilter` with the article's `✗` version (responds, no logging, no `super.catch()`). Trigger `/errors/unknown`. **Expected:** a tidy JSON body and **zero** log output. **Revert.**

### F3 — malformed JSON

```bash
curl -i -X POST localhost:3000/pipeline/items-dto -H 'content-type: application/json' -d 'not json'
```

**Expected:** **400**, not 500 — `isHttpError` sniffing on the `body-parser` error. Report the exact body, and whether your global filter mangled it.

### F4 — controller filter shadows the global one

`TraceFilter` (`@Catch(HttpException)`) is bound on `PipelineController`. Trigger an `HttpException` from a pipeline route and confirm the global `AllExceptionsFilter` did **not** run — no log line, different body shape.

### F5 — `headersSent`

A handler using `@Res()` that writes a partial response then throws, with the global filter responding unconditionally. Report what happens. **Expected:** an error *inside* the filter (`ERR_HTTP_HEADERS_SENT`) with nothing catching it. **Revert** to a `headersSent`-guarded filter.

## 7. Experiments — article 15 (context)

### C1 — the per-layer table

Call `describeHandler` from a guard, an interceptor, and the global filter on one route. Paste the three lines. **Expected:** guard and interceptor report the class and handler; the filter reports neither.

### C2 — the cast returns `null`

Inside the filter, cast `ArgumentsHost` to `ExecutionContext`, call `getHandler()`, and **log it without touching a property**. **Expected:** `null`. Then touch `.name` and report the error.

### C3 — `switchToWs()` on an HTTP request

In an HTTP guard, call `context.switchToWs().getClient()` and log its constructor name and whether it has `headers`. **Expected:** it's the Express **request**. Confirm no error is thrown. **Revert.**

### C4 — `getType()` on a hand-built host

Construct a bare `ExecutionContextHost([{}, {}])`-equivalent (or use `context-double.ts` without passing `type`) and report `getType()`. **Expected:** `'http'`.

## 8. Experiments — articles 08–11

### L1 — `create()` runs no hooks *(08)*

In `main.ts`, temporarily `const app = await NestFactory.create(AppModule)` then immediately `app.get(SomeServiceWithOnModuleInit)` and check whether its init flag is set, **before** `listen()`. **Expected:** not initialized. **Revert.**

### L2 — hook order *(08)*

Report the boot log order for `deep provider → deep module class → root module class → bootstrap hooks`, and confirm `lifecycle.spec.ts` passes.

### L3 — concurrency within a module *(08 Step 2)*

`FirstService` awaits 50 ms, `SecondService` is synchronous, `First` declared first. **Expected:** `Second done` prints first.

### L4 — no hooks for scoped providers *(08)*

Give a `Scope.REQUEST` provider an `onModuleInit` that logs. **Expected:** it never logs.

### L5 — shutdown *(08 Step 4)*

With `enableShutdownHooks()`, stop the app and report the order of `DrainService`'s three log lines. Then remove `enableShutdownHooks()` and repeat. **Expected:** the second run prints none.

**Windows note:** there's no real `SIGTERM`. `Ctrl+C` (SIGINT) exercises the same chain — use it, and say which signal you used. If Docker or WSL is available, repeat with `SIGTERM` in a Linux container and report both.

### T1 — the trace *(09)*

```bash
curl 'localhost:3000/pipeline?value=ok'
curl 'localhost:3000/pipeline?deny=1'
curl 'localhost:3000/pipeline?value=invalid'
```

Paste all three trace arrays. **Expected:** middleware → guard → interceptor:before → pipe → handler → interceptor:after; the second has **no** interceptor entry; the third shows `interceptor:caught BadRequestException`.

### T2 — global interceptor order *(09 Step 4)*

Two global interceptors declared in order. **Expected:** `outer:before → inner:before → handler → inner:after → outer:after`.

### M1 — middleware timing *(10 Step 2)*

Log elapsed time after `next()` **and** in `res.on('finish')`, on a handler awaiting 300 ms. Report both numbers. **Expected:** ~0 ms and ~300 ms.

### M2 — the wildcard warning *(10 Step 3)*

Temporarily use `forRoutes('pipeline/*')`. Capture the exact boot warning and the pattern it converts to. Then confirm `'pipeline{/*splat}'` matches `/pipeline` and `'pipeline/{*splat}'` does **not**. **Revert.**

### G1 — `false` versus `throw` *(11 Step 1–2)*

Bind `NaiveGuard` to one route and `ApiKeyGuard` to another. Report both responses with `-i`. **Expected:** the first is a generic 403 in both the missing and wrong-key cases; the second is 401 then 403 with distinct messages. Include the **exact** body of the `return false` case — I want the framework's stock forbidden message verbatim.

### G2 — sequential short-circuit *(11 Step 5)*

Two guards, the first rejecting and the second sleeping 50 ms. Time a rejected request, then swap their order and time it again. Report both.

### G3 — Observable last value *(11)*

A guard returning `of(true, false)`. **Expected:** denied.

## 9. Report

**Divergence table:**

| Article | Section | What broke | Minimal change made (or proposed) |
| --- | --- | --- | --- |

If nothing diverged, say so explicitly.

**Experiment results** — one line per experiment (P1–P3, I1–I4, F1–F5, C1–C4, L1–L5, T1–T2, M1–M2, G1–G3): claim verified, or what actually happened.

**Also report:**

- resolved `rxjs` version
- whether the global `ValidationPipe` changed any articles 01–04 behaviour
- verbatim: F1's logs, F3's body, G1's 403 body, M2's warning, T1's three traces
- every registration deviation from §2 that didn't work
- anything ambiguous you had to choose, and what you chose

## Out of scope

- No database, Docker, or TypeORM.
- No `supertest` or e2e — `curl` and the boot log are the instruments.
- No WebSocket gateway; article 15's transport experiments are done by inspection on an HTTP context.
- No CI, linting, or Prettier setup.
- No edits to any `.md` file.