---
article_id: providers-and-di
concept_folder: foundations
wave: 1
nest_baseline: "11.1.x"
node_baseline: "24"
related:
  - foundations/modules-and-the-module-graph
  - foundations/custom-providers-and-injection-tokens
  - foundations/decorators-and-metadata-reflection
  - foundations/scopes-and-lifetimes
  - recipes/di-and-modules/nest-cant-resolve-dependencies
status:
  drafted: true
  reviewed: false
v12_watch: true
---

# Providers and dependency injection

> **Lead with this.** Nest does not inject *types*. It injects **tokens**. A token is a runtime value — a class reference, a string, or a symbol — and every provider in your application is an entry in a map from a token to a recipe for producing a value. TypeScript types are erased before your code ever runs, so the type annotation in your constructor is not what Nest reads; it is only a hint the compiler converts into a token for you, and only under specific conditions. Once you hold that distinction, essentially every dependency-injection error you will hit in Nest resolves into one of two questions: *is the token what I think it is?* or *can this module see that token?*

## What it is

A **provider** is anything the Nest container knows how to produce, registered under a token in a module's `providers` array. Services, repositories, factories, adapters, configuration objects, a database connection handed to you by a library — all providers. The unifying property is not "is a class" but "is registered, and can therefore be injected."

**Dependency injection** is the inversion: a class declares what it needs and the container supplies it, rather than the class constructing its own collaborators. Nest's container builds the whole object graph once at bootstrap, resolving dependencies bottom-up so that by the time anything handles a request, every instance already exists.

What you gain is not primarily "decoupling" in the abstract. It is three concrete things:

- **Substitution.** A token can resolve to a different implementation in test, in development, or per environment, without the consumer changing.
- **Lifetime management.** The container decides how many instances exist and when they are created and destroyed.
- **Wiring you don't maintain.** A ten-deep dependency chain is constructed in the correct order without anyone writing that order down.

What you pay is real and worth naming: an indirection between the class you're reading and the object it actually receives, plus a class of failure — token mismatch, module invisibility — that does not exist when you write `new`. Most of this article is about that class of failure.

> **If you know Angular.** The decorators look the same and the mental model is not. Nest has no `providedIn: 'root'`: there is no way for a provider to register itself, so every provider appears in exactly one module's `providers` array and is invisible outside that module until it is explicitly exported. There is no tree-shaking of providers and no zone. `@Global()` is the nearest analogue to a root-provided service, and it is opt-in and deliberately rare. The habit to unlearn is assuming a service is reachable because you imported the file.

## How it works under the hood

Five steps run between the decorator you type and the instance you receive. Every one of them is somewhere a bug can live.

### 1. `@Injectable()` marks the class

`@Injectable()` attaches metadata identifying the class as something the container may manage. On its own it registers nothing — a decorated class that never appears in a `providers` array is not a provider.

### 2. TypeScript emits the constructor's parameter types

This is the step people skip, and it explains a surprising share of errors. With `emitDecoratorMetadata` enabled, the compiler emits a `design:paramtypes` entry for any class that carries at least one decorator. For:

```typescript
@Injectable()
export class CatsController {
  constructor(private catsService: CatsService) {}
}
```

the compiler emits, alongside the class, the equivalent of:

```javascript
Reflect.metadata('design:paramtypes', [CatsService]);
```

Note what that array holds: the **class reference itself**, a runtime value — not a type. This is why interfaces cannot be injected and why `import type` on a provider breaks injection. Both erase to nothing, and the emitted array holds `Object` in their place.

Two conditions gate the whole mechanism: `experimentalDecorators` and `emitDecoratorMetadata` must be on in `tsconfig.json`, and `reflect-metadata` must be loaded. You do not import `reflect-metadata` yourself in an application — `@nestjs/core` imports it at the top of its own entry point — but it *is* a peer dependency, so it must be installed.

### 3. Nest reads the parameters, and `@Inject()` overrides them

At bootstrap Nest reads that emitted array and overlays anything you declared explicitly. In `packages/core/injector/injector.ts`, `reflectConstructorParams()` reads the `design:paramtypes` metadata, then reads the metadata written by `@Inject()` and **overwrites entries by index**:

```typescript
// paraphrased from injector.ts — reflectConstructorParams
const paramtypes = [...(Reflect.getMetadata(PARAMTYPES_METADATA, type) || [])];
const selfParams = this.reflectSelfParams(type);
selfParams.forEach(({ index, param }) => (paramtypes[index] = param));
```

That index-overwrite is the precise relationship between the two styles. `@Inject('CONNECTION')` on parameter 0 does not "add" a token; it *replaces* whatever the compiler inferred at position 0. Which means: when a parameter carries `@Inject()`, the type annotation is decorative — it is a claim you are making to the compiler, not something Nest checks.

### 4. Registration turns a token into a recipe

The familiar shorthand is sugar:

```typescript
providers: [CatsService]
// desugars to
providers: [{ provide: CatsService, useClass: CatsService }]
```

`provide` is the token. `useClass` / `useValue` / `useFactory` / `useExisting` is the recipe. The shorthand only works because, in the common case, the token and the implementation happen to be the same class.

### 5. Lookup walks the module graph, then the instance is cached

When the container needs a token for a class it is constructing, it looks in this order (`lookupComponent` and `lookupComponentInImports` in `injector.ts`):

1. **Self-injection guard.** If the requested token is the class being constructed, resolution fails immediately — a provider cannot inject itself.
2. **The current module's own providers.** A hit here ends the search.
3. **The modules this module imports.** For a direct hit, the imported module must have the token in *both* its `providers` and its `exports`. Registering without exporting is invisible; exporting without registering is invisible.
4. **Deeper, through re-exports only.** If an imported module doesn't own the token, the search descends into *its* imports — but when traversing at that depth, it only follows children the intermediate module itself re-exports. This is the mechanism behind the most confusing visibility failure in Nest: `A → B → C` does not give `A` access to `C`'s providers unless `B` re-exports `C`.

If nothing matches, you get `Nest can't resolve dependencies of the …`.

Once resolved, the instance is stored on the provider's wrapper **keyed by context id**. Singletons — the default — live under a single static context, which is why "instantiated once and cached" is accurate for them and *not* accurate for request-scoped providers, which get an instance per request context. The container also tracks whether a provider's whole dependency subtree is static; a single request-scoped dependency anywhere beneath a provider makes that provider non-static too. That propagation is the subject of [scopes and lifetimes](./scopes-and-lifetimes.md) and this article deliberately stops at the boundary.

The graph is built during bootstrap and resolution is **transitive** and bottom-up: dependencies of dependencies are constructed first, so nothing is ever handed a half-built collaborator.

## Basic usage

A complete, runnable minimum. Four files.

```json
// tsconfig.json (the two options DI depends on)
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2023",
    "experimentalDecorators": true,
    "emitDecoratorMetadata": true,
    "strict": true,
    "outDir": "./dist"
  }
}
```

```typescript
// src/cats/cats.service.ts
import { Injectable } from '@nestjs/common';

export interface Cat {
  name: string;
  age: number;
}

@Injectable()
export class CatsService {
  private readonly cats: Cat[] = [];

  create(cat: Cat): void {
    this.cats.push(cat);
  }

  findAll(): Cat[] {
    return this.cats;
  }
}
```

```typescript
// src/cats/cats.controller.ts
import { Body, Controller, Get, Post } from '@nestjs/common';
import { Cat, CatsService } from './cats.service';

@Controller('cats')
export class CatsController {
  constructor(private readonly catsService: CatsService) {}

  @Post()
  create(@Body() cat: Cat): void {
    this.catsService.create(cat);
  }

  @Get()
  findAll(): Cat[] {
    return this.catsService.findAll();
  }
}
```

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { CatsController } from './cats/cats.controller';
import { CatsService } from './cats/cats.service';

@Module({
  controllers: [CatsController],
  providers: [CatsService],
})
export class AppModule {}
```

```typescript
// src/main.ts
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  await app.listen(3000);
}

void bootstrap();
```

`private readonly catsService: CatsService` does three things at once: declares the dependency, assigns it to a field, and — via the emitted paramtypes — supplies the token. Delete the type annotation and injection breaks.

## Walkthrough — swapping an implementation without touching its consumer

We'll build a notification feature where the delivery mechanism is chosen at boot. It exercises every provider form in the order you actually meet them, and each step is a complete file.

### Step 1 — a service with a hard-coded collaborator

Start where most code starts:

```typescript
// src/notifications/notifications.service.ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class NotificationsService {
  send(to: string, body: string): void {
    // eslint-disable-next-line no-console
    console.log(`[console] to=${to} body=${body}`);
  }
}
```

```typescript
// src/notifications/notifications.module.ts
import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Module({
  providers: [NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
```

This works and is fine until the day you need a second delivery mechanism. Note the `exports` line — without it, `NotificationsService` is usable only inside `NotificationsModule`, no matter who imports the file.

### Step 2 — the interface trap

The instinct is to extract an interface and depend on that:

```typescript
// src/notifications/notification-transport.interface.ts
export interface NotificationTransport {
  deliver(to: string, body: string): Promise<void>;
}
```

```typescript
// ✗ this compiles and fails at boot
@Injectable()
export class NotificationsService {
  constructor(private readonly transport: NotificationTransport) {}
}
```

At runtime the interface does not exist. The emitted paramtypes entry is `Object`, there is no provider registered under `Object`, and boot fails with `Nest can't resolve dependencies of the NotificationsService (?)`. The interface is still worth keeping — it is the contract — but it cannot be the token.

### Step 3 — a symbol token and a real implementation

Separate the contract from the token, and put the token somewhere both sides can import:

```typescript
// src/notifications/notification.tokens.ts
export const NOTIFICATION_TRANSPORT = Symbol('NOTIFICATION_TRANSPORT');
```

```typescript
// src/notifications/transports/console.transport.ts
import { Injectable } from '@nestjs/common';
import { NotificationTransport } from '../notification-transport.interface';

@Injectable()
export class ConsoleTransport implements NotificationTransport {
  async deliver(to: string, body: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[console] to=${to} body=${body}`);
  }
}
```

```typescript
// src/notifications/transports/buffered.transport.ts
import { Injectable } from '@nestjs/common';
import { NotificationTransport } from '../notification-transport.interface';

@Injectable()
export class BufferedTransport implements NotificationTransport {
  private readonly outbox: Array<{ to: string; body: string }> = [];

  async deliver(to: string, body: string): Promise<void> {
    this.outbox.push({ to, body });
  }

  drain(): ReadonlyArray<{ to: string; body: string }> {
    return this.outbox;
  }
}
```

```typescript
// src/notifications/notifications.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { NotificationTransport } from './notification-transport.interface';
import { NOTIFICATION_TRANSPORT } from './notification.tokens';

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(NOTIFICATION_TRANSPORT)
    private readonly transport: NotificationTransport,
  ) {}

  async send(to: string, body: string): Promise<void> {
    await this.transport.deliver(to, body);
  }
}
```

```typescript
// src/notifications/notifications.module.ts
import { Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';
import { NOTIFICATION_TRANSPORT } from './notification.tokens';
import { ConsoleTransport } from './transports/console.transport';

@Module({
  providers: [
    NotificationsService,
    { provide: NOTIFICATION_TRANSPORT, useClass: ConsoleTransport },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
```

The symbol carries a unique runtime identity, so two unrelated packages cannot collide the way they can with the string `'TRANSPORT'`. `NotificationsService` now names a contract and a token, and knows nothing about `ConsoleTransport`.

### Step 4 — choose the implementation at boot with `useFactory`

`useClass` fixes the choice at authoring time. To decide from configuration, use a factory and declare what it needs via `inject`. We need something to read configuration from — a deliberately minimal stand-in here, since [configuration](./configuration-and-environment.md) is its own article:

```typescript
// src/config/config.service.ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class ConfigService {
  get(key: string): string | undefined {
    return process.env[key];
  }
}
```

```typescript
// src/config/config.module.ts
import { Module } from '@nestjs/common';
import { ConfigService } from './config.service';

@Module({
  providers: [ConfigService],
  exports: [ConfigService],
})
export class ConfigModule {}
```

```typescript
// src/notifications/notifications.module.ts
import { Module } from '@nestjs/common';
import { ConfigService } from '../config/config.service';
import { ConfigModule } from '../config/config.module';
import { NotificationsService } from './notifications.service';
import { NotificationTransport } from './notification-transport.interface';
import { NOTIFICATION_TRANSPORT } from './notification.tokens';
import { BufferedTransport } from './transports/buffered.transport';
import { ConsoleTransport } from './transports/console.transport';

@Module({
  imports: [ConfigModule],
  providers: [
    NotificationsService,
    ConsoleTransport,
    BufferedTransport,
    {
      provide: NOTIFICATION_TRANSPORT,
      useFactory: (
        config: ConfigService,
        consoleTransport: ConsoleTransport,
        bufferedTransport: BufferedTransport,
      ): NotificationTransport =>
        config.get('NOTIFY_MODE') === 'buffer'
          ? bufferedTransport
          : consoleTransport,
      inject: [ConfigService, ConsoleTransport, BufferedTransport],
    },
  ],
  exports: [NotificationsService],
})
export class NotificationsModule {}
```

Two rules, both easy to get wrong:

- **`inject` is positional.** Nest resolves the tokens in `inject` and passes them to the factory in that order. The parameter names are irrelevant; the order is everything. Reorder one list and not the other and you get a type error at best, a silently wrong object at worst.
- **The factory's dependencies must be resolvable from *this* module.** `ConfigService` works here because `ConfigModule` is imported and exports it. The factory does not get special access.

Note also that both transports are registered as ordinary providers so the container can construct them. The token `NOTIFICATION_TRANSPORT` then aliases one of them — meaning `ConsoleTransport` may be instantiated even when it isn't selected. If construction is expensive, move the branch inside the factory and construct only the winner with `new`.

### Step 5 — an optional dependency, and verify the loop

Suppose a metrics sink should be used if the app has one and skipped otherwise. The tokens file grows a second entry:

```typescript
// src/notifications/notification.tokens.ts
export const NOTIFICATION_TRANSPORT = Symbol('NOTIFICATION_TRANSPORT');
export const METRICS_SINK = Symbol('METRICS_SINK');
```

```typescript
// src/notifications/notifications.service.ts
import { Inject, Injectable, Optional } from '@nestjs/common';
import { NotificationTransport } from './notification-transport.interface';
import { NOTIFICATION_TRANSPORT, METRICS_SINK } from './notification.tokens';

export interface MetricsSink {
  increment(metric: string): void;
}

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(NOTIFICATION_TRANSPORT)
    private readonly transport: NotificationTransport,
    @Optional()
    @Inject(METRICS_SINK)
    private readonly metrics?: MetricsSink,
  ) {}

  async send(to: string, body: string): Promise<void> {
    await this.transport.deliver(to, body);
    this.metrics?.increment('notifications.sent');
  }
}
```

Nothing registers `METRICS_SINK`, and that is the point: with `@Optional()`, an unregistered token resolves to `undefined` instead of failing the boot — so the optional marker and the `?:` on the field have to agree, or `strict` will let you dereference something that isn't there.

**Verify the loop.** Two checks, both cheap:

```bash
NEST_DEBUG=true npm run start
```

`NEST_DEBUG` (available since Nest 8.1.0) logs each dependency as it resolves: the host class, the token being injected, and the module being searched. If a token is being looked for in a module you didn't expect, you have found the bug without reading a single line of your own code.

Then prove substitution actually works — the whole point of the exercise:

```typescript
// src/notifications/notifications.service.spec.ts
import { Test } from '@nestjs/testing';
import { NotificationsService } from './notifications.service';
import { NOTIFICATION_TRANSPORT } from './notification.tokens';

describe('NotificationsService', () => {
  it('delegates delivery to the configured transport', async () => {
    const deliver = jest.fn().mockResolvedValue(undefined);

    const moduleRef = await Test.createTestingModule({
      providers: [
        NotificationsService,
        { provide: NOTIFICATION_TRANSPORT, useValue: { deliver } },
      ],
    }).compile();

    await moduleRef.get(NotificationsService).send('a@b.c', 'hi');

    expect(deliver).toHaveBeenCalledWith('a@b.c', 'hi');
  });
});
```

No mocking library reached into the class; the token was simply pointed somewhere else. That is the return on the indirection you paid for in Step 3.

## Real-world patterns

**Pick the provider form by what varies.**

| Form | Use when | Cost |
| --- | --- | --- |
| `useClass` | the implementation is a class the container should construct | the choice is fixed at authoring time unless you compute the class inline |
| `useValue` | a constant, a pre-built object from a library, or a test double | nothing is constructed for you; you own the object's lifetime |
| `useFactory` | the value depends on configuration or other providers, or needs async setup | positional `inject`, and the factory becomes a place logic hides |
| `useExisting` | you need a second name for an existing provider | two tokens now point at one instance — obvious in the module, invisible at the call site |

**Keep tokens in their own file.** A `*.tokens.ts` per feature. Tokens imported from a module file, while that module imports the provider, is the standard route to a circular import — and the resulting error names the *dependency*, not the import cycle.

**Abstract class as contract-plus-token.** When you want one artifact to be both, an abstract class exists at runtime and can serve as the token, which means consumers can use plain constructor injection with no `@Inject()`:

```typescript
export abstract class Clock {
  abstract now(): Date;
}

@Injectable()
export class SystemClock extends Clock {
  now(): Date {
    return new Date();
  }
}

// module
providers: [{ provide: Clock, useClass: SystemClock }]

// consumer — no @Inject() needed
constructor(private readonly clock: Clock) {}
```

The trade-off against a symbol token: the abstract class is a real import, so consumers take a hard dependency on the file that defines the contract. Symbols decouple further; abstract classes read better. Use symbols in library code where collisions and coupling matter more, abstract classes in application code where ergonomics do.

**Prefer constructor injection.** Property injection with `@Inject()` on a field exists mainly for base classes where threading dependencies through `super()` is painful. Everywhere else the constructor is the honest signature: it states what the class needs in a place that cannot be missed.

**Reach for `ModuleRef` last.** Resolving providers imperatively is available and occasionally necessary, but it moves a boot-time failure to runtime. Covered in [modules and the module graph](./modules-and-the-module-graph.md).

## API reference

| Symbol | Import | Purpose |
| --- | --- | --- |
| `@Injectable()` | `@nestjs/common` | marks a class as manageable by the container; required for classes with injected dependencies |
| `@Inject(token)` | `@nestjs/common` | overrides the inferred token at that parameter index, or injects into a property |
| `@Optional()` | `@nestjs/common` | resolution failure yields `undefined` instead of throwing |
| `{ provide, useClass }` | — | token resolves to a container-constructed instance of that class |
| `{ provide, useValue }` | — | token resolves to a value you supply |
| `{ provide, useFactory, inject }` | — | token resolves to the factory's return value; `inject` is positional |
| `{ provide, useExisting }` | — | token becomes an alias for another token |
| `exports` | `@Module()` | makes a module's providers visible to importers; required for cross-module injection |
| `NEST_DEBUG` | env var | logs dependency resolution during bootstrap |

## Common mistakes

**1. Decorated but never registered.**

```typescript
@Injectable()
export class CatsService {}          // ✗ not in any providers array
```

`@Injectable()` is a marker, not a registration. Add it to a module's `providers`.

**2. Provider placed in `imports`.**

```typescript
@Module({ imports: [CatsService] })  // ✗
```

`imports` takes modules. The resulting error puts the provider's name where the module name should be, which is the tell.

**3. Registered but not exported.**

```typescript
@Module({ providers: [CatsService] })              // ✗ invisible outside
@Module({ providers: [CatsService], exports: [CatsService] })  // ✓
```

File imports have nothing to do with DI visibility. The `exports` array is the only thing that opens a provider to other modules.

**4. Assuming transitive visibility.** `AppModule` imports `OrdersModule`, which imports `BillingModule`. `AppModule` cannot inject `BillingService` unless `OrdersModule` re-exports `BillingModule`:

```typescript
@Module({
  imports: [BillingModule],
  exports: [BillingModule],  // ✓ re-export makes it reachable one level up
})
export class OrdersModule {}
```

**5. Duplicate registration in two modules.**

```typescript
// feature module
@Module({ providers: [CatsService], exports: [CatsService] })
// root module
@Module({ providers: [CatsService], imports: [CatsModule] })  // ✗ two instances
```

Registering the same class in two modules produces two instances, and any state on it silently diverges. Import the module instead of re-registering the provider.

**6. Injecting an interface.**

```typescript
constructor(private readonly transport: NotificationTransport) {}  // ✗
```

The unresolvable token appears as `Object`. Use a symbol, a string, or an abstract class.

**7. `import type` on a class provider.**

```typescript
import type { CatsService } from './cats.service';   // ✗ erased at compile time
import { CatsService } from './cats.service';        // ✓
```

Same `Object` symptom as the interface case, from a line that looks like a harmless lint fix.

**8. Self-injection.**

```typescript
@Injectable()
export class CatsService {
  constructor(private readonly self: CatsService) {}  // ✗
}
```

Rejected outright. The unresolvable token equals the provider name, which is the signature of this mistake.

**9. Missing compiler options.** Without `emitDecoratorMetadata` (and `experimentalDecorators`), no paramtypes are emitted and *every* constructor injection fails at once. If the whole app fails to boot rather than one provider, check `tsconfig.json` before reading your modules.

**10. Circular imports through barrel files.** A module file that exports a token while a provider imports that token from the module file creates a cycle; `index.ts` barrels make it easy to build one accidentally. The error reports an undefined dependency, not an import cycle — a misleading symptom worth memorising. Tokens in their own file prevent it.

## How this evolved

The token model has been stable, but the debugging surface has improved: `NEST_DEBUG` was added in Nest 8.1.0 and is the fastest way to see which module a token is being searched for in. The `inject` array also accepts an object form — `{ token, optional: true }` — for factory dependencies that may legitimately be absent, which is cleaner than defaulting inside the factory body.

One thing worth flagging for the near future rather than the past: this article's mechanism depends on `emitDecoratorMetadata`, and Nest 12 moves the core packages to ESM. The DI model itself is unchanged, but the reflection setup described in step 2 is a surface to re-verify after that release.

## Exercises

**1. Break it deliberately, then read the error.** Take the Basic usage app and remove `CatsService` from `providers`. Boot it, read the message, then re-add it and instead change the constructor parameter to `@Inject('CatsService')` with a string token. Predict the error before you run it. *Hint: the string `'CatsService'` and the class `CatsService` are different tokens; nothing registers the former.*

**2. Prove the re-export rule.** Build three modules, `A → B → C`, with a provider in `C` that `A` injects. Get it working with the minimum number of `exports` entries, then remove one and confirm which one breaks it. *Hint: `C` must export its provider, and `B` must export `C` — two separate mechanisms, both required.*

**3. Swap a transport without touching the consumer.** Extend the walkthrough with a third transport that writes to a file, selected by `NOTIFY_MODE=file`. The diff should not touch `notifications.service.ts` at all. *Hint: if you find yourself editing the consumer, the token boundary is in the wrong place.*

## Summary

- Nest injects **tokens**, not types. A class reference used as a token is a convenience, not the rule.
- `emitDecoratorMetadata` turns a constructor's type annotations into runtime tokens; `@Inject()` overwrites them by index. Anything erased at compile time — interfaces, `import type` — cannot survive that trip.
- `providers: [X]` is shorthand for `{ provide: X, useClass: X }`; the four `use*` forms differ in what varies and what it costs you.
- Visibility is module-graph-based: own providers first, then imports that both register **and** export, then deeper only through re-exports.
- Singletons are constructed once at bootstrap and cached; the graph is resolved transitively, bottom-up.
- `NEST_DEBUG=true` shows which module a token is being searched for in, which is usually the answer.

## See also

- [Modules and the module graph](./modules-and-the-module-graph.md) — `exports`, `@Global()`, and `ModuleRef`
- [Custom providers and injection tokens](./custom-providers-and-injection-tokens.md) — the four provider forms in depth, async factories
- [Decorators and metadata reflection](./decorators-and-metadata-reflection.md) — what the compiler emits and how Nest reads it
- [Scopes and lifetimes](./scopes-and-lifetimes.md) — request and transient scope, and how non-static dependencies propagate
- [Recipe: "Nest can't resolve dependencies of…"](../recipes/di-and-modules/nest-cant-resolve-dependencies.md) — reading the error message as a diagnostic

## References

- [Providers](https://docs.nestjs.com/providers) — official docs
- [Custom providers](https://docs.nestjs.com/fundamentals/custom-providers) — official docs, including tokens, interfaces, and abstract classes
- [Common errors](https://docs.nestjs.com/faq/common-errors) — official docs, `NEST_DEBUG` and the resolution error catalogue
- [Injection scopes](https://docs.nestjs.com/fundamentals/injection-scopes) — official docs
- [`packages/core/injector/injector.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/injector/injector.ts) — `reflectConstructorParams`, `lookupComponent`, `lookupComponentInImports`
- [`packages/core/injector/instance-wrapper.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/injector/instance-wrapper.ts) — per-context instance caching, `isDependencyTreeStatic`

## Demo source

`demos/foundations/` — the walkthrough app, built forward across articles 01–08.