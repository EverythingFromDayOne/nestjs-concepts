---
article_id: bootstrap-and-lifecycle-hooks
concept_folder: foundations
wave: 1
nest_baseline: "11.1.x"
node_baseline: "24"
related:
  - foundations/providers-and-di
  - foundations/modules-and-the-module-graph
  - foundations/configuration-and-environment
  - foundations/scopes-and-lifetimes
  - observability/graceful-shutdown
  - recipes/deployment/shutdown-drops-in-flight-requests
status:
  drafted: true
  reviewed: false
v12_watch: false
---

# Bootstrap and lifecycle hooks

> **Lead with this.** A Nest application has a startup *sequence*, and the difference between "works on my laptop" and "the orchestrator keeps killing my pod" is almost always a misunderstanding of where in that sequence your code runs. Two guarantees are worth committing to memory, because most of the article follows from them. **Nothing is listening on a port until every `onApplicationBootstrap` has resolved** — which is why slow startup work is a deployment problem rather than a latency problem. And **shutdown hooks do not run at all unless you asked for them** — `SIGTERM` will end your process mid-request, silently, until you call one method. Neither fact is visible in your code.

## What it is

Startup has three phases, and only the middle one involves your hooks:

1. **Scan** — Nest walks the module graph from the root and registers every provider, controller, and enhancer. Nothing is constructed yet.
2. **Instantiate** — every static provider is constructed, dependencies first. Constructors run here.
3. **Initialize** — `onModuleInit`, then `onApplicationBootstrap`, then the port is bound.

Shutdown mirrors it: `onModuleDestroy`, then `beforeApplicationShutdown`, then the server closes, then `onApplicationShutdown`.

The six hooks, in the order they fire:

| Hook | Fires | Use it for |
| --- | --- | --- |
| `onModuleInit` | after this module's providers are constructed | async setup a constructor can't do |
| `onApplicationBootstrap` | after **all** modules have initialized | cross-module warmup, work that needs the whole graph |
| `onModuleDestroy` | first thing on shutdown | stop timers, unsubscribe, cancel work you own |
| `beforeApplicationShutdown` | after destroy, **while still listening** | drain — fail readiness, let in-flight requests finish |
| `onApplicationShutdown` | after the server has closed | close connections, flush buffers |

That fourth row is the one people get wrong, and §How it works shows why the ordering is what it is.

> **If you know Angular.** Angular's lifecycle hooks belong to *components* and fire per instance, many times, driven by change detection — `ngOnInit` runs again every time you navigate back to a route. Nest's fire **once per process**, on singletons, and are about the application's relationship to the outside world: is the port open, is the pool connected, is it safe to exit. There is no per-request analogue, and there is no `ngOnChanges` equivalent because nothing re-renders. The instinct to carry over is "initialization that can't happen in a constructor"; the instinct to drop is "this will run again."

## How it works under the hood

### `create()` does not run your hooks

```typescript
// paraphrased — NestFactory.create → initialize
const dependenciesScanner = new DependenciesScanner(container, /* … */);
await dependenciesScanner.scan(module);
await instanceLoader.createInstancesOfDependencies();
```

That is scan and instantiate. No hook has fired. `init()` is what runs them, and `listen()` calls `init()` for you:

```typescript
// paraphrased — NestApplication.listen
if (!this.isInitialized) {
  await this.init();
}
// … only now is the port bound
```

```typescript
// paraphrased — NestApplicationContext.init
await this.callInitHook();
await this.callBootstrapHook();
```

So the guarantee in the lead is structural: `listen()` awaits both hook phases before it asks the adapter for a port. A crash in `onApplicationBootstrap` means the process never accepts a connection — which is the correct behaviour and also the reason a thirty-second warmup is a thirty-second window of failing health checks.

One asymmetry worth knowing: `createApplicationContext()` — the standalone/CLI entry point — ends with `return context.init()`, so it *does* initialize for you. Only the HTTP path defers hooks to `listen()`.

### Modules run deepest-first, and teardown is the exact mirror

```typescript
// paraphrased — getModulesToTriggerHooksOn
const compareFn = (a: Module, b: Module) => b.distance - a.distance;
const modulesSortedByDistance = Array.from(modulesContainer.values()).sort(compareFn);
```

`distance` is a module's depth from the root, and the sort is **descending** — the deepest module initializes first, the root module last. `callDestroyHook`, `callBeforeShutdownHook`, and `callShutdownHook` all take that same array and `.reverse()` it, so shutdown runs root-first and leaves the leaves for last.

Read practically: **on the way up, your dependencies are ready before you are; on the way down, your dependents are gone before you are.** That's what you want, and it's why a shared connection pool in a deep module is still usable while the feature modules above it are tearing down.

### Within one module, hooks run concurrently

This is the part that surprises people:

```typescript
// paraphrased — callModuleInitHook
const providers = module.getNonAliasProviders();
const [_, moduleClassHost] = providers.shift()!;   // the module class itself
const instances = [
  ...module.controllers, ...providers, ...module.injectables, ...module.middlewares,
];

await Promise.all(callOperator(getNonTransientInstances(instances)));
await Promise.all(callOperator(getTransientInstances(instances)));

// the module class's own hook runs last
if (moduleClassInstance && hasOnModuleInitHook(moduleClassInstance)
    && moduleClassHost.isDependencyTreeStatic()) {
  await moduleClassInstance.onModuleInit();
}
```

Four facts fall out:

- **`Promise.all`, not a loop.** Two providers in the same module have their `onModuleInit` invoked concurrently. Declaration order in the `providers` array buys you nothing. If A's init must precede B's, the only reliable expression of that is **B depending on A** — then the graph, not the hook, orders them.
- **Enhancers and middlewares get hooks too**, not just providers and controllers.
- **The module class's own hook runs after all of its members'** — the source comments say so explicitly. That makes a module-class `onModuleInit` the natural "everything in here is ready" checkpoint.
- **Aliases are excluded.** `getNonAliasProviders()` means a `useExisting` alias from [article 05](./custom-providers-and-injection-tokens.md#how-it-works-under-the-hood) doesn't fire the same instance's hook twice.

### Scoped providers get no lifecycle hooks at all

Both instance helpers begin with the same filter:

```typescript
// paraphrased — getNonTransientInstances / getTransientInstances
.filter(([key, wrapper]) => wrapper.isDependencyTreeStatic() && !wrapper.isTransient)
```

`isDependencyTreeStatic()` is the same predicate [article 06](./scopes-and-lifetimes.md#how-it-works-under-the-hood) is built on. So a request-scoped provider — or any provider that became non-static by depending on one — **never receives `onModuleInit` or any other lifecycle hook.** Transient providers do, via the second pass, once per instance.

This catches people twice: the hook silently doesn't run, and the reason lives in a different file from the hook.

### Shutdown: where the server closes matters

```typescript
// paraphrased — NestApplicationContext.close
await this.initializationPromise;
await this.callDestroyHook();
await this.callBeforeShutdownHook(signal);
await this.dispose();                      // ← the HTTP server closes here
await this.callShutdownHook(signal);
this.unsubscribeFromProcessSignals();
```

`dispose()` sits **between** `beforeApplicationShutdown` and `onApplicationShutdown`. Which fixes the meaning of both:

- **`beforeApplicationShutdown` runs while the server is still accepting connections.** This is where you fail your readiness probe and wait for in-flight work — and where you must *not* close the database pool, because requests are still using it.
- **`onApplicationShutdown` runs after the server is closed.** Nothing new can arrive. This is where connections get closed and buffers flushed.

Swap those two and you get the classic failure: a pool closed under requests that hadn't finished, producing errors that look like a database outage during every deploy.

### Signal handling is opt-in

```typescript
// paraphrased — enableShutdownHooks
public enableShutdownHooks(signals = [], options = {}): this {
  if (isEmpty(signals)) {
    signals = Object.keys(ShutdownSignal).map(key => ShutdownSignal[key]);
  }
  // dedupe, uppercase, drop signals already subscribed
  this.listenToShutdownSignals(signals, options);
  return this;
}
```

Called with no arguments it subscribes to every signal Nest knows. Not called at all — the default — and `SIGTERM` terminates the process with **no hook running**.

**Be precise about what it gates: process signals, not `close()`.** `app.close()` runs the whole teardown chain whether or not you called `enableShutdownHooks()` — measured. So a test that calls `close()` proves your hooks work and proves nothing about your deploy, and an application whose only shutdown path is a signal has no teardown at all until this line is added. The opt-in exists because each signal costs a process listener; the practical effect is that graceful shutdown is a single line most applications are missing.

## Basic usage

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.enableShutdownHooks();   // ← without this, SIGTERM skips every hook

  await app.listen(process.env.PORT ?? 3000);
}

void bootstrap();
```

```typescript
// src/rates/rates.warmup.ts
import {
  Injectable, Logger, OnApplicationBootstrap, OnApplicationShutdown, OnModuleInit,
} from '@nestjs/common';

@Injectable()
export class RatesWarmup implements OnModuleInit, OnApplicationBootstrap, OnApplicationShutdown {
  private readonly logger = new Logger(RatesWarmup.name);
  private timer?: NodeJS.Timeout;

  async onModuleInit(): Promise<void> {
    this.logger.log('module ready');           // this module's providers exist
  }

  async onApplicationBootstrap(): Promise<void> {
    this.logger.log('every module ready');     // the whole graph exists
    this.timer = setInterval(() => this.refresh(), 60_000);
  }

  onApplicationShutdown(signal?: string): void {
    clearInterval(this.timer);
    this.logger.log(`shut down on ${signal ?? 'close()'}`);
  }

  private refresh(): void {
    /* … */
  }
}
```

The signal is passed to the shutdown hooks, which is worth logging — `SIGTERM` from an orchestrator and a `SIGINT` from someone's terminal call for different levels of concern.

## Walkthrough — the four things the sequence tells you

We extend `demos/foundations` with `src/lifecycle/`. Each step is a claim the sequence makes that you can check.

### Step 1 — the work a constructor can't do

```typescript
// ✗ a constructor cannot await
@Injectable()
export class SchemaCache {
  private schema!: object;

  constructor(private readonly config: ConfigService) {
    this.load(); // returns a promise nobody waits for
  }

  private async load(): Promise<void> {
    this.schema = await loadSchemaFrom(this.config.getOrThrow('SCHEMA_URL'));
  }
}
```

This compiles, boots, and hands out a `SchemaCache` whose `schema` is `undefined` for however long the load takes. The first few requests get a broken object and nothing logs an error.

```typescript
// ✓ the hook can be awaited
@Injectable()
export class SchemaCache implements OnModuleInit {
  private schema?: object;

  constructor(private readonly config: ConfigService) {}

  async onModuleInit(): Promise<void> {
    this.schema = await loadSchemaFrom(this.config.getOrThrow('SCHEMA_URL'));
  }

  get(): object {
    if (!this.schema) {
      throw new Error('SchemaCache used before initialization');
    }
    return this.schema;
  }
}
```

Nest awaits the hook, so the port isn't bound until the schema is loaded. The guard in `get()` is still worth having — it converts "used too early" from a confusing `undefined` into a named failure.

The trade-off is the one from [article 07](./configuration-and-environment.md): startup work you await is startup latency you pay on every deploy. Same decision, different mechanism.

### Step 2 — the ordering that isn't there

Two providers in one module, each logging in its hook:

```typescript
// src/lifecycle/first.service.ts
@Injectable()
export class FirstService implements OnModuleInit {
  async onModuleInit(): Promise<void> {
    await new Promise((r) => setTimeout(r, 50));
    console.log('First done');
  }
}
```

```typescript
// src/lifecycle/second.service.ts
@Injectable()
export class SecondService implements OnModuleInit {
  onModuleInit(): void {
    console.log('Second done');
  }
}
```

```typescript
@Module({ providers: [FirstService, SecondService] })   // First is declared first
export class LifecycleModule {}
```

`Second done` prints first. `Promise.all` started both, and `First` awaited. Declaration order is not execution order, and no amount of rearranging the array changes that.

If `Second` genuinely needs `First` to be ready, say so in the graph:

```typescript
@Injectable()
export class SecondService implements OnModuleInit {
  constructor(private readonly first: FirstService) {}   // ← now ordered
  // …
}
```

That doesn't order the *hooks* — both still start together — so if the dependency is about *initialized state* rather than existence, `First` must expose it:

```typescript
@Injectable()
export class FirstService implements OnModuleInit {
  private ready!: Promise<void>;

  onModuleInit(): void {
    this.ready = this.load();          // don't await here
  }

  private async load(): Promise<void> {
    /* … the slow work … */
  }

  async whenReady(): Promise<void> {
    await this.ready;
  }
}
```

`SecondService` then awaits `first.whenReady()` in its own hook. This is more honest than hook ordering would be: the dependency is visible at the call site rather than implied by array position.

### Step 3 — the module class as a readiness checkpoint

Because a module class's hook runs after all of its members', it's the one place that can truthfully say "this feature is ready":

```typescript
// src/lifecycle/lifecycle.module.ts
import { Module, OnModuleInit } from '@nestjs/common';
import { FirstService } from './first.service';
import { SecondService } from './second.service';

@Module({ providers: [FirstService, SecondService] })
export class LifecycleModule implements OnModuleInit {
  onModuleInit(): void {
    console.log('LifecycleModule: all providers initialized');
  }
}
```

Note from [article 02](./modules-and-the-module-graph.md#real-world-patterns) that a module class **can** inject providers even though it is not itself injectable — which makes this a legitimate place to assert an invariant across the feature.

### Step 4 — shutdown, in the right order

```typescript
// src/lifecycle/drain.service.ts
import {
  BeforeApplicationShutdown, Injectable, Logger,
  OnApplicationShutdown, OnModuleDestroy,
} from '@nestjs/common';

@Injectable()
export class DrainService
  implements OnModuleDestroy, BeforeApplicationShutdown, OnApplicationShutdown
{
  private readonly logger = new Logger(DrainService.name);
  private accepting = true;

  onModuleDestroy(): void {
    // first thing to run: stop producing new work of our own
    this.logger.log('1. destroy — timers and subscriptions stopped');
  }

  async beforeApplicationShutdown(signal?: string): Promise<void> {
    // still listening — this is the drain window
    this.accepting = false;
    this.logger.log(`2. before shutdown (${signal}) — failing readiness, draining`);
    await new Promise((resolve) => setTimeout(resolve, 5_000));
  }

  onApplicationShutdown(signal?: string): void {
    // the server is closed; nothing new can arrive
    this.logger.log(`3. shutdown (${signal}) — closing connections`);
  }

  get isAccepting(): boolean {
    return this.accepting;
  }
}
```

The five-second sleep is a placeholder for the real thing, and the real thing belongs to [graceful shutdown](../observability/graceful-shutdown.md) — readiness endpoints, orchestrator `preStop` timing, and a bounded drain rather than a fixed sleep. What article 08 owns is the *placement*: drain in phase 2 while the socket is open, release resources in phase 3 after it's closed. Getting those backwards is the deploy-time "database outage" that isn't one.

### Verify the loop

Hook order is directly observable, so assert it rather than reasoning about it:

```typescript
// src/lifecycle/lifecycle.spec.ts
import { Injectable, Module, OnApplicationBootstrap, OnModuleInit } from '@nestjs/common';
import { Test } from '@nestjs/testing';

const order: string[] = [];

@Injectable()
class Deep implements OnModuleInit, OnApplicationBootstrap {
  onModuleInit(): void { order.push('deep:init'); }
  onApplicationBootstrap(): void { order.push('deep:bootstrap'); }
}

@Module({ providers: [Deep] })
class DeepModule implements OnModuleInit {
  onModuleInit(): void { order.push('deepModule:init'); }
}

@Module({ imports: [DeepModule] })
class RootModule implements OnModuleInit {
  onModuleInit(): void { order.push('rootModule:init'); }
}

describe('lifecycle order', () => {
  it('initializes deepest-first, and the module class last within a module', async () => {
    const app = await Test.createTestingModule({ imports: [RootModule] }).compile();
    await app.init();

    expect(order).toEqual([
      'deep:init',          // provider before its own module class
      'deepModule:init',    // deepest module before the root
      'rootModule:init',
      'deep:bootstrap',     // every init hook precedes every bootstrap hook
    ]);

    await app.close();      // ← always; otherwise handles leak and Jest hangs
  });
});
```

Then check the shutdown ordering by hand, because a signal is involved:

```bash
npm run start
# in another terminal
kill -TERM $(pgrep -f "nest start" | head -1)
# expect 1. destroy → 2. before shutdown → 3. shutdown, in that order
```

**On Windows** there is no real `SIGTERM`: Node emulates `SIGINT` for `Ctrl+C` and the orchestrator signal you care about doesn't exist locally. `Ctrl+C` will exercise the same hook chain, but verify signal behaviour in a Linux container before trusting it in a deployment.

Remove `app.enableShutdownHooks()` from `main.ts` and send the signal again: the process dies and **none** of the three lines print. That's the default, and it's the single most valuable thing to see once with your own eyes — but only via a *signal*. Call `app.close()` explicitly and the chain runs either way, which is why a passing teardown test says nothing about what happens on deploy.

## Real-world patterns

**Constructors wire, hooks do I/O.** If it can't be synchronous, it doesn't belong in a constructor. If it can be, a constructor keeps the object valid from the moment it exists.

**Never encode ordering in hooks.** Express it as a dependency, and if the dependency is on *initialized state* rather than existence, expose a `whenReady()` promise. Hook order within a module is `Promise.all`.

**`onModuleInit` for local setup, `onApplicationBootstrap` for cross-module work.** Anything that touches another feature's providers wants the second — by then the whole graph is initialized.

**`enableShutdownHooks()` belongs in every deployed application.** One line, and without it every deploy truncates in-flight requests.

**Drain in `beforeApplicationShutdown`, release in `onApplicationShutdown`.** The server closes between them.

**Always `await app.close()` in tests.** Timers, pools, and signal listeners survive a test file otherwise, and the symptom is Jest not exiting rather than a failing assertion.

**Lifecycle work belongs to singletons.** Scoped providers get no hooks; if a request-scoped provider needs a warmed resource, warm it in a singleton and inject that.

**`bufferLogs: true` plus a custom logger.** Buffered startup logs are flushed once the real logger is available, so early messages aren't lost or printed twice in a format you didn't choose.

**`abortOnError: false`** turns a fatal startup exit into a thrown error you can catch — useful when the process is a test harness or a CLI rather than a server.

## API reference

| Symbol | Import | Purpose |
| --- | --- | --- |
| `NestFactory.create(module, options?)` | `@nestjs/core` | scans and instantiates; **does not** run hooks |
| `NestFactory.createApplicationContext(module)` | `@nestjs/core` | standalone context; calls `init()` for you |
| `app.init()` | — | runs `onModuleInit` then `onApplicationBootstrap`; idempotent |
| `app.listen(port)` | — | calls `init()` if needed, **then** binds the port |
| `app.close(signal?)` | — | destroy → before-shutdown → close server → shutdown |
| `app.enableShutdownHooks(signals?)` | — | subscribes to process signals; **required** for signal-driven shutdown |
| `OnModuleInit` | `@nestjs/common` | `onModuleInit()` |
| `OnApplicationBootstrap` | `@nestjs/common` | `onApplicationBootstrap()` |
| `OnModuleDestroy` | `@nestjs/common` | `onModuleDestroy()` |
| `BeforeApplicationShutdown` | `@nestjs/common` | `beforeApplicationShutdown(signal?)` — still listening |
| `OnApplicationShutdown` | `@nestjs/common` | `onApplicationShutdown(signal?)` — server closed |
| `{ bufferLogs, autoFlushLogs }` | create options | hold startup logs until a logger is set |
| `{ abortOnError: false }` | create options | throw instead of exiting on a startup failure |

## Common mistakes

**1. Assuming `create()` initialized the app.** For an HTTP application it did not. `app.get(SomeService)` between `create()` and `listen()` returns an instance whose `onModuleInit` has not run.

**2. Async work in a constructor.** Nothing awaits it. The object is handed out half-built and the failure surfaces later, somewhere else.

**3. Relying on provider declaration order for hook order.** `Promise.all` runs them concurrently. Reordering the `providers` array changes nothing.

**4. Expecting hooks on a scoped provider.** Both instance collectors filter on `isDependencyTreeStatic()`. Request-scoped providers get no hooks — and neither does anything that became non-static by depending on one.

**5. Not calling `enableShutdownHooks()`.** `SIGTERM` ends the process and no hook runs. This is the default — and because `app.close()` runs the chain regardless, a green teardown test will not catch it.

**6. Closing the database pool in `beforeApplicationShutdown`.** The server is still listening; in-flight requests hit a closed pool. Close in `onApplicationShutdown`.

**7. Draining in `onApplicationShutdown`.** Too late — the server is already closed, so there is nothing left to drain.

**8. Slow `onApplicationBootstrap`.** The port stays unbound for the whole duration, so readiness probes fail and the orchestrator may kill the container before it ever serves a request.

**9. Forgetting `await app.close()` in tests.** Handles leak across files and the test runner won't exit. The error message points at nothing useful.

**10. Throwing from a teardown hook.** The chain is awaited in sequence; an unhandled rejection in `onModuleDestroy` prevents the later phases from running at all. Catch and log inside teardown hooks.

## How this evolved

The hook set has been stable; the operational surface around it has filled in. `beforeApplicationShutdown` exists specifically because `onApplicationShutdown` runs too late to drain, and `enableShutdownHooks` accepts a signal list and options rather than being all-or-nothing. `bufferLogs` and `autoFlushLogs` were added so that messages emitted before a custom logger is installed aren't lost. Preview mode adds one wrinkle worth knowing exists: with `preview: true`, only modules marked `initOnPreview` have their hooks called at all, so a graph can be inspected without side effects.

## Exercises

**1. Watch the port stay closed.** Add a five-second `await` to an `onApplicationBootstrap` and try to `curl` the app during those five seconds. *Hint: the failure is a connection refusal, not a slow response — and that distinction is what a readiness probe sees.*

**2. Prove the concurrency.** Put two providers with logging init hooks in one module, one of them awaiting a delay, and predict which logs first. Then make the second depend on the first and check whether the *hook* order changed. *Hint: it doesn't — which is the point of the `whenReady()` pattern.*

**3. Break shutdown deliberately.** Close a resource in `beforeApplicationShutdown` while a long request is in flight, then send `SIGTERM` mid-request. Move the close to `onApplicationShutdown` and repeat. *Hint: the first version produces an error that looks like the resource failed, not like you closed it.*

## Summary

- `create()` scans and instantiates. `init()` — which `listen()` calls — runs the hooks. **The port is bound only after every `onApplicationBootstrap` resolves.**
- Modules initialize **deepest-first**, root last; every teardown phase reverses that exact order.
- Within one module, hooks run under `Promise.all` — **concurrently**. Declaration order means nothing; express ordering as a dependency, and expose initialized state as a promise if that's what dependents need.
- A module class's own hook runs **after** all of its providers', making it a truthful readiness checkpoint.
- `useExisting` aliases are excluded from hook dispatch; transient instances get hooks once per instance.
- **Scoped providers receive no lifecycle hooks**, and neither does anything non-static because of them.
- `close()` runs destroy → before-shutdown → **server closes** → shutdown. Drain in phase 2, release resources in phase 3.
- Signal handling is opt-in: without `enableShutdownHooks()`, `SIGTERM` skips every hook.

## See also

- [Providers and dependency injection](./providers-and-di.md) — what "instantiate" means in phase 2
- [Modules and the module graph](./modules-and-the-module-graph.md) — the graph whose depth decides hook order
- [Configuration and environment](./configuration-and-environment.md) — startup work you await is deploy latency you pay
- [Scopes and lifetimes](./scopes-and-lifetimes.md#how-it-works-under-the-hood) — why scoped providers get no hooks
- [Graceful shutdown](../observability/graceful-shutdown.md) — readiness, `preStop`, and bounded drains
- [Recipe: shutdown drops in-flight requests](../recipes/deployment/shutdown-drops-in-flight-requests.md)

## References

- [Lifecycle events](https://docs.nestjs.com/fundamentals/lifecycle-events) — official docs
- [`packages/core/nest-application-context.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/nest-application-context.ts) — `init`, `close`, `enableShutdownHooks`, `getModulesToTriggerHooksOn`
- [`packages/core/hooks/on-module-init.hook.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/hooks/on-module-init.hook.ts) — per-module dispatch, `Promise.all`, module class last
- [`packages/core/injector/helpers/transient-instances.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/injector/helpers/transient-instances.ts) — the `isDependencyTreeStatic` filter
- [`packages/core/nest-factory.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/nest-factory.ts) — scan and instantiate, `abortOnError`, log buffering
- [`packages/core/nest-application.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/nest-application.ts) — `listen` calling `init` before binding

## Demo source

`demos/foundations/` — adds `lifecycle/` to the app built in articles 01–07.