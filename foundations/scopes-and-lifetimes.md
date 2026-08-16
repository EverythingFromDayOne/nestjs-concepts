---
article_id: scopes-and-lifetimes
description: Scope belongs to a dependency tree, declared in one place and taking effect upward through everything that injects it
concept_folder: foundations
wave: 1
nest_baseline: "11.1.x"
node_baseline: "24"
related:
  - foundations/providers-and-di
  - foundations/custom-providers-and-injection-tokens
  - foundations/modules-and-the-module-graph
  - request-lifecycle/interceptors
  - performance/request-scope-cost
  - recipes/di-and-modules/request-scope-bubbling
status:
  drafted: true
  reviewed: false
v12_watch: false
---

# Scopes and lifetimes

> **Lead with this.** Scope is not a property of a provider. It is a property of a **dependency tree**, and you declare it in one place while it takes effect everywhere above that place. Mark one small service `Scope.REQUEST` and every provider that injects it, every provider that injects *those*, and the controller at the top all quietly stop being singletons — rebuilt from scratch on every request, forever, with no warning at the call site and no diff in the files that changed behaviour. The declaration is local; the consequence is global and upward. That inversion is the whole article, and it's why "just make it request-scoped" is the most expensive one-line change in Nest.

## What it is

Three scopes:

| Scope | Instances | Created |
| --- | --- | --- |
| `DEFAULT` | one, for the whole application | at bootstrap |
| `REQUEST` | one per incoming request | per request |
| `TRANSIENT` | one per **consumer** that injects it | at bootstrap, once per injection site |

Default is the right answer almost always. Nest builds the object graph once at boot and every request shares it, which is why a Nest app has no per-request allocation cost for its services and why a singleton holding mutable state is a bug waiting for concurrency.

The two non-default scopes exist for different reasons and are frequently confused. **Request scope** is about *isolation* — this instance must not be shared between two requests in flight. **Transient scope** is about *identity* — each consumer needs its own copy, usually so the copy can know who injected it.

## How it works under the hood

### Instances are stored per context, and singletons are just one context

Every provider's `InstanceWrapper` holds instances keyed by a **context id**. The singleton slot is a shared constant, `STATIC_CONTEXT`. A request-scoped provider has one entry per in-flight request; a transient provider has an inner map keyed by *inquirer* — the consumer that asked for it.

There is no separate machinery for singletons. They are the entry under the static context, and everything else is the same lookup with a different key.

### Non-staticness propagates upward, and only `REQUEST` starts it

This is the mechanism behind every surprise in this article:

```typescript
// paraphrased from packages/core/injector/instance-wrapper.ts
public isDependencyTreeStatic(lookupRegistry: string[] = []): boolean {
  if (!isUndefined(this.isTreeStatic)) return this.isTreeStatic;   // memoized

  if (this.scope === Scope.REQUEST) {
    this.isTreeStatic = false;
    this.printIntrospectedAsRequestScoped();
    return this.isTreeStatic;
  }

  this.isTreeStatic = !this.introspectDepsAttribute(
    (collection, registry) =>
      collection.some(item => !item.isDependencyTreeStatic(registry)),
    lookupRegistry,
  );
  if (!this.isTreeStatic) this.printIntrospectedAsRequestScoped();
  return this.isTreeStatic;
}
```

Read it precisely, because three things fall out and two of them are counter-intuitive:

- **A provider is non-static if it is `REQUEST`-scoped, or if *any* of its dependencies is non-static.** That recursion is the bubbling: it climbs the whole graph, so the distance between the declaration and the damage can be five files.
- **`TRANSIENT` is not in this check.** A transient provider with static dependencies has a *static* tree. Its consumers stay singletons, and its instances are built at boot — one per injection site — not per request. Transient does not bubble.
- **The answer is computed once and memoized.** Scope is decided at bootstrap, not per request. Nothing about a running request can change it.

There is a log line in there, and a caveat that matters: `printIntrospectedAsRequestScoped` only prints when `NEST_DEBUG` is set. On a normal boot Nest changes your provider's lifetime and says nothing at all.

```
# NEST_DEBUG=true
[Nest] LOG [InstanceWrapper] AuditService introspected as request-scoped
[Nest] LOG [InstanceWrapper] AuditController introspected as request-scoped
```

### At boot, each route handler is bound one of two ways

The router asks the same question and picks a strategy:

```typescript
// paraphrased from packages/core/router/router-explorer.ts
const isRequestScoped = !instanceWrapper.isDependencyTreeStatic();
const proxy = isRequestScoped
  ? this.createRequestScopedHandler(instanceWrapper, /* … */)
  : this.createCallbackProxy(instance, targetCallback, /* … */);
```

A static handler closes over the one instance built at boot. A non-static handler does work on **every request** instead.

### What a request-scoped handler actually does per request

```typescript
// paraphrased — the per-request path
const contextId = this.getContextId(req, isTreeDurable);
const contextInstance = await this.injector.loadPerContext(
  instance, moduleRef, collection, contextId,
);
await this.createCallbackProxy(contextInstance, contextInstance[methodName], /* … */)(req, res, next);
```

And `getContextId`:

```typescript
// paraphrased
const contextId = ContextIdFactory.getByRequest(request);
if (!request[REQUEST_CONTEXT_ID]) {
  Object.defineProperty(request, REQUEST_CONTEXT_ID, {
    value: contextId, enumerable: false, writable: false, configurable: false,
  });
  const requestProviderValue = isTreeDurable
    ? contextId.payload
    : Object.assign(request, contextId.payload);
  this.container.registerRequestProvider(requestProviderValue, contextId);
}
```

Three details worth carrying:

- **A context id is an object**, literally `{ id: Math.random() }`. The number doesn't need to be unique because it's used as a `WeakMap` key and comparison is by reference. When the request's closure ends, the object becomes unreachable and the per-request instances go with it. That is the entire garbage-collection story for request scope.
- **The context id is pinned to the request object** under a non-enumerable symbol, so everything in that request — controller, guards, interceptors, nested providers — resolves into the same context.
- **`loadPerContext` rebuilds the sub-tree.** Not just the leaf you marked: every non-static provider between it and the handler is constructed again, per request.

### Durable providers change what `REQUEST` resolves to

Durable scope is the escape hatch for the case where per-request really means per-*something-coarser* — usually per tenant. A `REQUEST`-scoped provider marked `durable: true` gets its sub-tree cached against a parent context you supply, instead of being rebuilt each request.

`isDependencyTreeDurable()` looks like it mirrors the static check, but it branches differently in a way that is easy to read past:

```typescript
// paraphrased from instance-wrapper.ts
if (this.scope === Scope.REQUEST) {
  this.isTreeDurable = this.durable === undefined ? false : this.durable;
  return this.isTreeDurable;              // ← dependencies are never inspected
}
const isStatic = this.isDependencyTreeStatic();
if (isStatic) return false;
const isTreeNonDurable = this.introspectDepsAttribute(
  (collection, registry) =>
    collection.some(item => !item.isDependencyTreeStatic() && !item.isDependencyTreeDurable(registry)),
  lookupRegistry,
);
this.isTreeDurable = !isTreeNonDurable;
```

Two different rules, depending on which kind of provider is asking:

- **A provider that is itself `REQUEST`-scoped** reports its own `durable` flag and **stops**. Its dependencies are never examined. Adding an ordinary request-scoped dependency to a `durable: true` provider does *not* un-durable it — measured, and contrary to what the symmetry suggests.
- **A provider that became non-static only through a dependency** — a controller, typically — is durable only if **every** non-static dependency below it is durable.

The second rule is where the "one non-durable dependency spoils it" intuition actually applies, and it applies to the *consumers* above a durable provider, not to the durable provider itself.

Look again at the `getContextId` branch above, because it contains a trap:

```typescript
const requestProviderValue = isTreeDurable ? contextId.payload : Object.assign(request, contextId.payload);
```

**In a durable tree, the `REQUEST` token resolves to `contextId.payload` — not to the HTTP request.** That's deliberate: a durable sub-tree is shared across many requests, so handing it one request object would be a bug. Code that injects `@Inject(REQUEST)` and reads `request.headers` compiles fine and gets `undefined` at runtime the day someone marks the tree durable.

**And note whose durability decides it.** `isTreeDurable` in that snippet is computed from the **handler's** wrapper — the controller — not from the provider doing the injecting. Which produces a genuinely confusing observed behaviour, measured: the same durable service receives `{ tenantId }` when reached through a controller whose tree is durable, and the **HTTP request object** when reached through a controller that also injects some ordinary request-scoped provider. The durable service's own code is identical in both cases. If `@Inject(REQUEST)` seems to change type depending on the route, this is why.

## Basic usage

```typescript
import { Injectable, Scope } from '@nestjs/common';

@Injectable()                                  // DEFAULT — one instance
export class CatalogService {}

@Injectable({ scope: Scope.REQUEST })          // one per request
export class RequestContext {}

@Injectable({ scope: Scope.TRANSIENT })        // one per consumer
export class ContextualLogger {}
```

Custom providers take the same option, and remember from [article 05](./custom-providers-and-injection-tokens.md#how-it-works-under-the-hood) that `useClass` **inherits the class's scope** when the provider doesn't state one:

```typescript
{ provide: LOGGER, useClass: ContextualLogger, scope: Scope.TRANSIENT }
{ provide: RATES, useFactory: makeRates, inject: [ConfigService], scope: Scope.REQUEST }
```

## Walkthrough — state that shouldn't be shared

We extend `demos/foundations` with `src/audit/`. The arc is the one real applications actually walk: a singleton accumulates per-request state, it breaks under concurrency, the obvious fix works, and the fix costs more than it looks.

### Step 1 — the bug that only appears under load

```typescript
// src/audit/audit.service.ts — ✗ singleton holding per-request state
import { Injectable } from '@nestjs/common';

@Injectable()
export class AuditService {
  private readonly events: string[] = [];

  record(event: string): void {
    this.events.push(event);
  }

  flush(): string[] {
    const collected = [...this.events];
    this.events.length = 0;
    return collected;
  }
}
```

One instance, shared by every request. Two requests in flight interleave their events, and whichever calls `flush()` first takes the other's. On a laptop with one request at a time this passes every test you write.

Make it visible:

```typescript
// src/audit/audit.controller.ts
import { Controller, Get } from '@nestjs/common';
import { AuditService } from './audit.service';

@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {}

  @Get('demo')
  async demo(): Promise<{ events: string[] }> {
    this.audit.record('start');
    await new Promise((resolve) => setTimeout(resolve, 50)); // simulate I/O
    this.audit.record('end');
    return { events: this.audit.flush() };
  }
}
```

```bash
curl localhost:3000/audit/demo & curl localhost:3000/audit/demo & wait
# {"events":["start","start","end"]}   ← took the other request's event too
# {"events":["end"]}                   ← lost one
```

The exact split depends on how the two requests interleave; what's constant is that neither response describes the request that produced it.

That is the shape of every singleton-state bug: correct in isolation, wrong under concurrency, invisible in tests.

### Step 2 — request scope, and watching it spread

```typescript
// src/audit/audit.service.ts
import { Injectable, Scope } from '@nestjs/common';

@Injectable({ scope: Scope.REQUEST })
export class AuditService {
  // … unchanged …
}
```

The endpoint is now correct. But look at what else changed — nothing you edited:

```typescript
// add a constructor log to each to see it
@Controller('audit')
export class AuditController {
  constructor(private readonly audit: AuditService) {
    console.log('AuditController constructed');
  }
}
```

`AuditController` is now built on every request too. It injects a non-static provider, so its own tree is non-static, so the router bound it with the request-scoped handler. You changed one decorator in one file and altered the lifetime of a class in another.

The framework will tell you, but only if you ask. `NEST_DEBUG=true` makes it print one `introspected as request-scoped` line per provider whose tree it decided is non-static — including `AuditController`, which you never annotated. Without that flag there is no output at all, which is why this change can land in a pull request with nobody noticing.

### Step 3 — ask the container, don't guess

Guessing which providers went non-static doesn't scale past a small app. `ModuleRef.introspect()` reports the **effective** scope — computed from the tree, not read off the decorator:

```typescript
// src/audit/scope-report.ts
import { Injectable, OnApplicationBootstrap, Type } from '@nestjs/common';
import { ModuleRef } from '@nestjs/core';
import { AuditService } from './audit.service';
import { CatalogService } from '../catalog/catalog.service';

@Injectable()
export class ScopeReport implements OnApplicationBootstrap {
  constructor(private readonly moduleRef: ModuleRef) {}

  onApplicationBootstrap(): void {
    // the annotation is load-bearing: a bare array of two different classes
    // infers a union that `introspect<T>` will not accept under `strict`
    const tokens: Type<unknown>[] = [AuditService, CatalogService];
    for (const token of tokens) {
      console.log(token.name, this.moduleRef.introspect(token).scope);
    }
  }
}
```

`introspect` returns `REQUEST` whenever the tree is non-static — including for providers you never annotated, which is exactly the list you want. That difference between "what the decorator says" and "what the container decided" is the thing to check when performance work starts.

### Step 4 — transient, which behaves nothing like request

A logger that knows who injected it:

```typescript
// src/audit/contextual.logger.ts
import { Inject, Injectable, Scope } from '@nestjs/common';
import { INQUIRER } from '@nestjs/core';

@Injectable({ scope: Scope.TRANSIENT })
export class ContextualLogger {
  private readonly source: string;

  constructor(@Inject(INQUIRER) parentClass: object) {
    this.source = parentClass?.constructor?.name ?? 'unknown';
  }

  log(message: string): void {
    console.log(`[${this.source}] ${message}`);
  }
}
```

Every consumer gets its own instance, tagged with the consumer's class name. Now the part people get wrong: **this does not make anything request-scoped.** Transient is absent from the static check, so `AuditController` injecting `ContextualLogger` stays a singleton, and the logger instances are created at boot — one per injection site — not per request.

The costs are real but different in kind from request scope: instance count scales with injection sites rather than with traffic, and a transient provider that holds state holds it for the application's lifetime, per consumer.

### Step 5 — durable, and the `REQUEST` surprise

Per-request rebuilding is wasteful when the thing being isolated is per-*tenant*. Durable providers cache the sub-tree against a parent context you define:

```typescript
// src/audit/tenant.strategy.ts
import {
  ContextId,
  ContextIdFactory,
  ContextIdStrategy,
  HostComponentInfo,
} from '@nestjs/core';
import type { Request } from 'express';

const tenants = new Map<string, ContextId>();

export class TenantContextIdStrategy implements ContextIdStrategy<Request> {
  attach(contextId: ContextId, request: Request) {
    const tenantId = (request.headers['x-tenant-id'] as string) ?? 'public';

    let tenantSubTreeId = tenants.get(tenantId);
    if (!tenantSubTreeId) {
      tenantSubTreeId = ContextIdFactory.create();
      tenants.set(tenantId, tenantSubTreeId);
    }

    return {
      payload: { tenantId },
      // durable sub-trees resolve into the tenant's shared context;
      // everything else stays per-request
      resolve: (info: HostComponentInfo) =>
        info.isTreeDurable ? tenantSubTreeId! : contextId,
    };
  }
}
```

The `Map` is a deliberate leak worth naming: tenant context ids are never evicted, so an app with unbounded tenant ids grows without limit. Bound it, or key it on something you control.

```typescript
// src/main.ts — register it before creating the app
ContextIdFactory.apply(new TenantContextIdStrategy());
```

```typescript
// src/audit/tenant-cache.service.ts
import { Inject, Injectable, Scope } from '@nestjs/common';
import { REQUEST } from '@nestjs/core';

@Injectable({ scope: Scope.REQUEST, durable: true })
export class TenantCacheService {
  // ✗ NOT the HTTP request — in a durable tree this is contextId.payload
  constructor(@Inject(REQUEST) private readonly payload: { tenantId: string }) {}

  get tenantId(): string {
    return this.payload.tenantId;
  }
}
```

The comment marks the trap named in the mechanism section. `registerRequestProvider` is handed `contextId.payload` for a durable tree and the request object otherwise, so `@Inject(REQUEST)` changes meaning under you the moment `durable: true` is added. Code reading `request.headers` compiles, runs, and returns `undefined`.

Two more constraints: the strategy must be registered **before** `NestFactory.create()`, and durability requires every non-static dependency beneath the provider to be durable as well. One ordinary request-scoped dependency in the chain and the tree silently reverts to per-request — with no error, because per-request is always correct, just slower.

### Verify the loop

Correctness first — prove the isolation:

```typescript
// src/audit/audit.service.spec.ts
import { ContextIdFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { AuditService } from './audit.service';

describe('AuditService', () => {
  it('gives each context its own instance', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [AuditService],
    }).compile();

    const first = ContextIdFactory.create();
    const second = ContextIdFactory.create();

    const a = await moduleRef.resolve(AuditService, first);
    const b = await moduleRef.resolve(AuditService, second);
    const aAgain = await moduleRef.resolve(AuditService, first);

    a.record('one');

    expect(a).not.toBe(b);
    expect(aAgain).toBe(a);      // same context → same instance
    expect(b.flush()).toEqual([]); // no leakage across contexts
  });
});
```

Note `resolve`, not `get`: `get` is for static providers and returns the singleton slot, which a scoped provider doesn't have. `resolve` takes a context id and builds into it.

Then the cost, which is the part that gets skipped:

```bash
# count constructions per request
NEST_DEBUG=true npm run start | grep -i "request-scoped"
```

Every provider listed there is rebuilt on every request. If that list contains something with an expensive constructor — a client, a parser, a compiled schema — the scope decision has become a throughput decision.

## Real-world patterns

**Prefer passing state to scoping the graph.** A correlation id, a tenant, a user — these usually want to travel as an argument or through `AsyncLocalStorage`, not as a rebuilt dependency tree. Request scope is the heaviest possible way to move a string.

**Keep the request-scoped provider at the leaf.** The bubbling is upward, so the cost of a request-scoped provider is proportional to how much of the graph sits above it. A tiny leaf injected by one service is cheap; one injected by a shared utility everything depends on is not.

**`@Inject(REQUEST)` is the most contagious line in a Nest codebase.** It makes its host request-scoped, and that spreads. Confine it to one small provider and expose what's needed through a narrow interface.

**Enhancers inherit this too.** A request-scoped guard, interceptor, or pipe is instantiated per request, and a globally-registered one via `APP_GUARD` with `useClass` keeps the class's scope — applying that cost to *every* route. See [interceptors](../request-lifecycle/interceptors.md).

**Transient for identity, not isolation.** `INQUIRER` injection is the legitimate use: per-consumer loggers, metrics tagged with their owner. Reaching for transient to "get a fresh instance" per request is a category error — it won't.

**Durable when the isolation unit is coarser than a request.** Multi-tenant connection pools, per-tenant caches. The payload becomes your context object; design it deliberately, since it's what `REQUEST` will resolve to.

**Choosing:**

| Need | Scope | Cost |
| --- | --- | --- |
| stateless service | `DEFAULT` | none — this is the default for a reason |
| per-request isolation of mutable state | `REQUEST` | whole tree above it rebuilt per request; `get()` no longer works |
| per-consumer instance, usually for `INQUIRER` | `TRANSIENT` | instance per injection site, alive for the app's lifetime |
| per-tenant (or other coarse) isolation | `REQUEST` + `durable` | needs a `ContextIdStrategy`; `REQUEST` becomes the payload; all non-static deps must be durable |

## API reference

| Symbol | Import | Purpose |
| --- | --- | --- |
| `Scope.DEFAULT` / `REQUEST` / `TRANSIENT` | `@nestjs/common` | the three scopes |
| `@Injectable({ scope, durable })` | `@nestjs/common` | declares scope on a class |
| `{ provide, useClass, scope }` | — | scope on a custom provider; inherited from the class if omitted |
| `REQUEST` | `@nestjs/core` | token for the request object — or the durable payload |
| `INQUIRER` | `@nestjs/core` | token for the consumer that injected a transient provider |
| `moduleRef.resolve(token, contextId?)` | `@nestjs/core` | retrieves a scoped provider into a context |
| `moduleRef.introspect(token)` | `@nestjs/core` | the **effective** scope, computed from the tree |
| `moduleRef.registerRequestByContextId(req, ctxId)` | `@nestjs/core` | binds a request to a context outside HTTP |
| `ContextIdFactory.create()` | `@nestjs/core` | a fresh context id |
| `ContextIdFactory.apply(strategy)` | `@nestjs/core` | registers a durable-context strategy; call before `create()` |

## Common mistakes

**1. Treating scope as local.** It propagates to every provider above it in the graph. The file you changed is not the file that got slower.

**2. Thinking a singleton stays a singleton.** A "singleton" injecting a request-scoped provider is rebuilt per request. Nothing in its own file says so; `introspect()` is how you find out.

**3. Expecting `TRANSIENT` to give a fresh instance per request.** It gives one per *consumer*, created at boot. Transient does not bubble and does not isolate requests.

**4. `moduleRef.get()` on a scoped provider.** `get()` reads the static slot, which a scoped provider doesn't have. The error says so plainly: `AuditService is marked as a scoped provider. Request and transient-scoped providers can't be used in combination with "get()" method. Please, use "resolve()" instead.`

**5. Request-scoped global enhancers.** `APP_GUARD` with a request-scoped `useClass` applies per-request instantiation to every route in the application.

**6. Expensive constructors under request scope.** Building a client, compiling a schema, or reading a file in a constructor is free at boot and ruinous per request.

**7. `@Inject(REQUEST)` in a widely-injected provider.** It converts everything above it. Put it in a leaf.

**8. Durable without a registered strategy.** `durable: true` alone changes nothing; `ContextIdFactory.apply()` must run before the app is created.

**9. Expecting `REQUEST` to be the HTTP request in a durable provider.** It's `contextId.payload`. Reading `.headers` gives `undefined`.

**10. One non-durable dependency in a durable tree.** The tree silently reverts to per-request, because that's still correct — just not what you optimised for.

## How this evolved

The three scopes have been stable; what has moved is the escape hatch. Durable providers exist so that multi-tenant applications aren't forced to choose between per-request rebuilding and unsafe sharing, and they arrived with `ContextIdStrategy`, the `payload` channel, and the `isTreeDurable` propagation rule. The broader trend runs the other way: `AsyncLocalStorage` in Node makes request-scoped *state* cheap without request-scoped *providers*, which is why the guidance here leans toward passing context rather than scoping graphs.

## Exercises

**1. Watch it spread.** Add a constructor log to a controller and to two services beneath it, all default-scoped. Confirm each logs once at boot. Then mark the deepest one `Scope.REQUEST` and hit the endpoint twice. *Hint: count the log lines before you look at the code — the number tells you how far the bubbling reached.*

**2. Ask instead of guessing.** Use `moduleRef.introspect()` to print the effective scope of every provider in one module, and find the one whose decorator disagrees with the answer. *Hint: the disagreement is the point; a provider with no scope option can still report `REQUEST`.*

**3. Find where durability actually breaks.** Build a durable provider that caches per tenant, instrument its constructor with a counter, and drive the same tenant twice. Then add an ordinary request-scoped dependency *to the durable provider* and repeat — the count does not change. Now add that dependency to the **controller** instead and check what `@Inject(REQUEST)` receives. *Hint: the branch that matters is on the handler's wrapper, not the provider's.*

## Summary

- Scope belongs to a **tree**, not a provider. `isDependencyTreeStatic()` marks a provider non-static if it is `REQUEST`-scoped *or any dependency is*, recursively and upward.
- The answer is **memoized at bootstrap**. Nothing at request time changes it.
- `TRANSIENT` is absent from that check: it does not bubble, does not isolate requests, and its instances are created at boot — one per injection site.
- A context id is an object used as a `WeakMap` key, pinned to the request; per-request instances are collected when the request closure ends.
- A non-static handler calls `loadPerContext` per request, rebuilding **every** non-static provider between the leaf and the handler.
- A `REQUEST`-scoped provider's durability is its own flag and nothing else; the "all dependencies must be durable" rule applies to the providers *above* it. What `REQUEST` resolves to — payload or HTTP request — is decided by the **handler's** tree, not the injecting provider's.
- `moduleRef.introspect()` reports the effective scope; `resolve()` retrieves scoped providers where `get()` can't.

## See also

- [Providers and dependency injection](./providers-and-di.md) — how instances are cached per context
- [Custom providers and injection tokens](./custom-providers-and-injection-tokens.md#how-it-works-under-the-hood) — `useClass` inheriting the class's scope
- [Modules and the module graph](./modules-and-the-module-graph.md) — where a provider is registered, and why that matters for resolution
- [Interceptors](../request-lifecycle/interceptors.md) — enhancers and their scopes
- [Request-scope cost](../performance/request-scope-cost.md) — measuring the throughput impact
- [Recipe: request scope spread through my whole app](../recipes/di-and-modules/request-scope-bubbling.md)

## References

- [Injection scopes](https://docs.nestjs.com/fundamentals/injection-scopes) — official docs, including durable providers
- [Module reference](https://docs.nestjs.com/fundamentals/module-ref) — `resolve`, `introspect`, `registerRequestByContextId`
- [`packages/core/injector/instance-wrapper.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/injector/instance-wrapper.ts) — `isDependencyTreeStatic`, `isDependencyTreeDurable`, transient keying by inquirer
- [`packages/core/router/router-explorer.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/router/router-explorer.ts) — `createRequestScopedHandler`, `getContextId`
- [`packages/core/helpers/context-id-factory.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/helpers/context-id-factory.ts) — context id creation and durable strategies
- [`packages/core/injector/module-ref.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/injector/module-ref.ts) — `introspect` computing scope from the tree

## Demo source

`demos/foundations/` — adds `audit/` to the app built in articles 01–05.