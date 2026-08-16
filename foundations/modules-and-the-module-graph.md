---
article_id: modules-and-the-module-graph
description: A module is a visibility boundary with an identity, and those two properties are enforced by different mechanisms
concept_folder: foundations
wave: 1
nest_baseline: "11.1.x"
node_baseline: "24"
related:
  - foundations/providers-and-di
  - foundations/custom-providers-and-injection-tokens
  - foundations/bootstrap-and-lifecycle-hooks
  - architecture/dynamic-modules
  - recipes/di-and-modules/circular-dependency
status:
  drafted: true
  reviewed: false
v12_watch: false
---

# Modules and the module graph

> **Lead with this.** A module is not a folder and it is not a namespace. It is a **visibility boundary with an identity**. The boundary decides which providers a class can inject; the identity decides how many copies of those providers exist. Almost every confusing module bug is one of those two things behaving exactly as designed while you assumed the other: a provider you can import in TypeScript but cannot inject, or a service that mysteriously has two instances with diverging state. Reading the module graph correctly means asking, for any provider, *who can see it* and *how many of it are there* — and knowing that those are answered by different mechanisms.

## What it is

A module is a class carrying `@Module()` metadata with four arrays:

| Key | Holds | Means |
| --- | --- | --- |
| `providers` | providers | instantiate these, and make them injectable **inside this module** |
| `controllers` | controller classes | instantiate these and bind their routes |
| `imports` | modules | make *their exported* providers injectable here |
| `exports` | provider tokens, or modules | open these to whoever imports me |

Providers are encapsulated by default. A class in module `A` can inject only what `A` registers itself and what `A`'s imports have explicitly exported. The `exports` array is the module's public API — everything else in `providers` is private, no matter how many files import it.

The root module is the entry point Nest uses to build the application graph, and the graph is what resolution walks. Understanding it is not architectural garnish: it is the thing that determines whether your app boots.

> **If you know Angular.** Two inversions, both easy to trip on. First, Angular lets a provider register itself with `providedIn: 'root'` and be globally available; Nest has no such thing — every provider belongs to exactly one module and is invisible until exported and imported. The official docs draw this contrast themselves. Second, `exports` means the opposite kind of thing: an `NgModule`'s `exports` array is for declarables (components, directives, pipes) while its providers were global anyway; a Nest module's `exports` array is *specifically* for providers, because providers are what's encapsulated. Reading a Nest `exports` array as "template stuff other modules can use" will mislead you every time.

## How it works under the hood

### Modules are keyed, and the key decides identity

When Nest encounters a module, `ModuleCompiler.compile()` produces an opaque **token** for it, and `NestContainer.addModule()` checks whether that token is already registered:

```typescript
// paraphrased from packages/core/injector/container.ts
const { type, dynamicMetadata, token } = await this.moduleCompiler.compile(metatype);
if (this.modules.has(token)) {
  return { moduleRef: this.modules.get(token)!, inserted: true };
}
```

So "modules are singletons" is really "one module instance per token." Which raises the question the docs don't answer: **what produces the token?**

In Nest 11 the default is `ByReferenceModuleOpaqueKeyFactory`. It generates an id and caches it **on the object reference itself**, under a private symbol:

```typescript
// paraphrased from by-reference-module-opaque-key-factory.ts
if (originalRef[K_MODULE_ID]) {
  return originalRef[K_MODULE_ID];
}
const moduleId = this.generateRandomString();
originalRef[K_MODULE_ID] = moduleId;
```

For a **static** module the reference is the class itself. A class is one object no matter how many modules import it, so the token is stable and you get exactly one instance — that's the singleton guarantee, and it's why importing `LoggerModule` in five places shares one `LoggerService`.

For a **dynamic** module the reference is the object literal returned by `forRoot()`. Two calls return two objects, so two tokens, so **two module instances**, each with its own copy of the providers inside — even if the options were identical. This is the real reason for the `forRoot()`-once-at-the-root convention. If you need content-based deduplication instead, `moduleIdGeneratorAlgorithm: 'deep-hash'` in the application options restores hashing over the module metadata; the cost is that a module's identity then depends on its options being serializable and stable.

Dynamic modules are otherwise [article 41's](../architecture/dynamic-modules.md) subject. What matters here is the identity rule.

### `exports` is one flat set, holding two kinds of thing

A module's exports are a single `Set` of tokens. Exporting a provider adds its token; exporting a module adds that module's **class reference** to the same set:

```typescript
// paraphrased from packages/core/injector/module.ts — addExportedProviderOrModule
if (this.isDynamicModule(toExport)) {
  const { module: moduleClassRef } = toExport;
  return addExportedUnit(moduleClassRef);
}
addExportedUnit(toExport as Type<any>);
```

That single set is what the injector consults when it walks the graph. When it descends past a module that doesn't own the token it's looking for, it only follows children that the intermediate module re-exported — checking exactly this set. Re-exporting a module and exporting a provider are the same mechanism wearing two hats.

### You cannot export what you don't have

Exports are validated at boot:

```typescript
// paraphrased from module.ts — validateExportedProvider
if (this._providers.has(token)) return token;
const imports = [...this._imports.values()].map(({ metatype }) => metatype);
if (!imports.includes(token)) {
  throw new UnknownExportException(providerName, name);
}
```

A token may be exported if the module **provides** it or **imports** the module that owns it. Anything else fails the boot with `UnknownExportException`. This is a useful guardrail: a typo in `exports` is a startup error, not a mystery at request time.

### `@Global()` adds import edges — it does not bypass exports

`@Global()` writes metadata that the container reads, and then, after all modules are registered:

```typescript
// paraphrased from container.ts
public bindGlobalsToImports(moduleRef: Module) {
  this.globalModules.forEach(globalModule =>
    this.bindGlobalModuleToModule(moduleRef, globalModule),
  );
}

public bindGlobalModuleToModule(target: Module, globalModule: Module) {
  if (target === globalModule || target === this.internalCoreModule) return;
  target.addImport(globalModule);
}
```

Read that literally: a global module is **pushed into every other module's `imports` set**. There is no separate global lookup path and no priority. Two consequences worth holding on to:

- A global module's providers still have to be **exported**. `@Global()` supplies the import edge, nothing else. A global module with an empty `exports` array shares nothing.
- Everything downstream behaves as if you had typed the import yourself, including the resolution order from [providers and DI](./providers-and-di.md#how-it-works-under-the-hood) — own providers first, then imports.

### Resolution, in one line

Own `providers` → imported modules where the token is in **both** `providers` and `exports` → deeper, but only through modules the intermediate re-exported. That mechanism belongs to [article 01](./providers-and-di.md#how-it-works-under-the-hood); this article is about arranging the graph it walks.

## Basic usage

A feature module, exported and consumed.

```typescript
// src/ledger/ledger.service.ts
import { Injectable } from '@nestjs/common';

@Injectable()
export class LedgerService {
  private readonly entries: Array<{ account: string; amount: number }> = [];

  record(account: string, amount: number): void {
    this.entries.push({ account, amount });
  }

  balance(account: string): number {
    return this.entries
      .filter((entry) => entry.account === account)
      .reduce((total, entry) => total + entry.amount, 0);
  }
}
```

```typescript
// src/ledger/ledger.module.ts
import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';

@Module({
  providers: [LedgerService],
  exports: [LedgerService], // ← the module's public API
})
export class LedgerModule {}
```

```typescript
// src/orders/orders.module.ts
import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { OrdersService } from './orders.service';

@Module({
  imports: [LedgerModule], // ← without this, LedgerService is not injectable here
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
```

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { OrdersModule } from './orders/orders.module';

@Module({
  imports: [OrdersModule],
})
export class AppModule {}
```

Two lines carry the whole mechanism: `exports: [LedgerService]` in the owner and `imports: [LedgerModule]` in the consumer. Remove either and the boot fails.

## Walkthrough — growing a graph until it breaks, then fixing each break

We continue the `demos/foundations` app from [article 01](./providers-and-di.md), which already has a `NotificationsModule` exporting `NotificationsService`. We'll add orders and billing, and deliberately walk into each failure the graph can produce.

### Step 1 — a feature module that can't see its dependency

```typescript
// src/orders/orders.service.ts
import { Injectable } from '@nestjs/common';
import { LedgerService } from '../ledger/ledger.service';

@Injectable()
export class OrdersService {
  constructor(private readonly ledger: LedgerService) {}

  place(account: string, amount: number): void {
    this.ledger.record(account, amount);
  }
}
```

```typescript
// src/ledger/ledger.module.ts — first attempt
import { Module } from '@nestjs/common';
import { LedgerService } from './ledger.service';

@Module({
  providers: [LedgerService], // ✗ no exports
})
export class LedgerModule {}
```

```typescript
// src/orders/orders.module.ts — first attempt
import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { OrdersService } from './orders.service';

@Module({
  imports: [LedgerModule],
  providers: [OrdersService],
})
export class OrdersModule {}
```

Boot fails: `Nest can't resolve dependencies of the OrdersService (?)`. The import is there; the export is not. The TypeScript `import { LedgerService }` at the top of `orders.service.ts` is what makes this feel like it should work — it compiles fine and is completely irrelevant to DI. **File imports satisfy the compiler; `exports` satisfies the injector.**

Fix: add `exports: [LedgerService]` to `LedgerModule`.

### Step 2 — prove the instance is shared, not copied

Add a second consumer to confirm the singleton claim rather than trusting it:

```typescript
// src/billing/billing.service.ts
import { Injectable } from '@nestjs/common';
import { LedgerService } from '../ledger/ledger.service';

@Injectable()
export class BillingService {
  constructor(private readonly ledger: LedgerService) {}

  balanceFor(account: string): number {
    return this.ledger.balance(account);
  }
}
```

```typescript
// src/billing/billing.module.ts
import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { BillingService } from './billing.service';

@Module({
  imports: [LedgerModule],
  providers: [BillingService],
  exports: [BillingService],
})
export class BillingModule {}
```

Now `OrdersService.place()` writes and `BillingService.balanceFor()` reads the same ledger, because `LedgerModule` resolves to one module instance and therefore one `LedgerService`. Both modules importing it does not duplicate anything.

### Step 3 — the duplicate-registration trap

Suppose `BillingModule` had done this instead:

```typescript
// src/billing/billing.module.ts — ✗ registers its own copy
import { Module } from '@nestjs/common';
import { LedgerModule } from '../ledger/ledger.module';
import { LedgerService } from '../ledger/ledger.service';
import { BillingService } from './billing.service';

@Module({
  imports: [LedgerModule],
  providers: [BillingService, LedgerService], // ✗ the second entry is the bug
  exports: [BillingService],
})
export class BillingModule {}
```

Look closely at what that module does: it **imports `LedgerModule` and also registers `LedgerService` itself**. You might expect the import to win, or a conflict to be reported. Neither happens. Resolution checks the module's own `providers` first and stops there, so the local copy shadows the imported one — the mechanism from [article 01](./providers-and-di.md#how-it-works-under-the-hood), doing exactly what it says.

This **boots successfully**, which is what makes it dangerous. Two `LedgerService` instances now exist, and `BillingService` reads a ledger nobody writes to. Orders get recorded; balances stay at zero. No error, no stack trace — a wrong number.

The import line makes it worse, not better: it looks like correct wiring and it is even doing something, just not the thing you're relying on.

A controller makes it visible:

```typescript
// src/orders/orders.controller.ts
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { BillingService } from '../billing/billing.service';
import { OrdersService } from './orders.service';

@Controller('orders')
export class OrdersController {
  constructor(
    private readonly orders: OrdersService,
    private readonly billing: BillingService,
  ) {}

  @Post()
  place(@Body() body: { account: string; amount: number }): void {
    this.orders.place(body.account, body.amount);
  }

  @Get(':account/balance')
  balance(@Param('account') account: string): { balance: number } {
    return { balance: this.billing.balanceFor(account) };
  }
}
```

`POST /orders` then `GET /orders/acme/balance` returns `0` with the duplicate registration and the correct total without it. **The rule: register a provider in exactly one module, and import that module everywhere else.** Re-registering is not "making it available" — it is making a second one.

### Step 4 — depth, and the re-export rule

Now put `OrdersController` in `AppModule` instead, and have `AppModule` import only `OrdersModule`:

```typescript
// src/orders/orders.module.ts
import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { LedgerModule } from '../ledger/ledger.module';
import { OrdersService } from './orders.service';

@Module({
  imports: [LedgerModule, BillingModule],
  providers: [OrdersService],
  exports: [OrdersService],
})
export class OrdersModule {}
```

```typescript
// src/app.module.ts — ✗ OrdersController can't get BillingService
import { Module } from '@nestjs/common';
import { OrdersController } from './orders/orders.controller';
import { OrdersModule } from './orders/orders.module';

@Module({
  imports: [OrdersModule],
  controllers: [OrdersController],
})
export class AppModule {}
```

`AppModule → OrdersModule → BillingModule` does not make `BillingService` reachable from `AppModule`. The injector descends past `OrdersModule` only into modules `OrdersModule` re-exported, and it re-exported none.

Two honest options, with different costs:

```typescript
// src/orders/orders.module.ts
// (a) re-export: AppModule reaches BillingService through OrdersModule
import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { LedgerModule } from '../ledger/ledger.module';
import { OrdersService } from './orders.service';

@Module({
  imports: [LedgerModule, BillingModule],
  providers: [OrdersService],
  exports: [OrdersService, BillingModule],
})
export class OrdersModule {}
```

```typescript
// src/app.module.ts
// (b) import directly: AppModule states its own dependency
import { Module } from '@nestjs/common';
import { BillingModule } from './billing/billing.module';
import { OrdersController } from './orders/orders.controller';
import { OrdersModule } from './orders/orders.module';

@Module({
  imports: [OrdersModule, BillingModule],
  controllers: [OrdersController],
})
export class AppModule {}
```

Prefer **(b)** when the consumer genuinely depends on the thing — an explicit import is a truthful dependency edge, and it survives `OrdersModule` being refactored. Prefer **(a)** when the intermediate module is deliberately a facade whose job is to expose a curated surface (a `CoreModule` re-exporting `ConfigModule` and `LoggerModule` is the canonical case). The cost of over-using (a) is a graph where nothing states its real dependencies and every module transitively sees everything.

### Step 5 — `@Global()`, and what it costs

`NotificationsModule` from article 01 is now wanted in orders, billing, and two more places. The tempting fix:

```typescript
// src/notifications/notifications.module.ts
import { Global, Module } from '@nestjs/common';
import { NotificationsService } from './notifications.service';

@Global()
@Module({
  providers: [/* … as built in article 01 … */],
  exports: [NotificationsService], // ← still required
})
export class NotificationsModule {}
```

It works, and the `exports` line is not optional — `@Global()` only adds the import edge, so a global module that exports nothing shares nothing. Two rules that follow from the mechanism:

- **Register a global module exactly once**, at the root or in a core module. It is pushed into every module's imports; registering it twice registers two of them.
- **The dependency disappears from the graph.** Nothing in `OrdersModule` now records that it needs notifications. Moving `OrdersModule` to another app, or testing it in isolation, fails in a way that reads as "missing provider" with no import to trace back from.

Use it for genuinely ubiquitous infrastructure — config, logging, the database connection. For everything else the explicit import is worth its two lines.

### Verify the loop

Two checks. First, prove the sharing claim rather than asserting it:

```typescript
// src/ledger/ledger.module.spec.ts
import { Test } from '@nestjs/testing';
import { BillingService } from '../billing/billing.service';
import { OrdersService } from '../orders/orders.service';
import { BillingModule } from '../billing/billing.module';
import { OrdersModule } from '../orders/orders.module';

describe('module graph', () => {
  it('shares one LedgerService across importing modules', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [OrdersModule, BillingModule],
    }).compile();

    moduleRef.get(OrdersService).place('acme', 250);

    expect(moduleRef.get(BillingService).balanceFor('acme')).toBe(250);
  });
});
```

The assertion that matters is the second-to-last line: a write through one module is visible through the other. Reintroduce the Step 3 duplicate registration and this test fails with `0`, which is exactly the regression you want caught.

Second, when a resolution error is unclear, let the container tell you which module it searched:

```bash
NEST_DEBUG=true npm run start
```

Each line names the token and the module being searched. If you see it looking in a module you didn't expect, the graph is not shaped the way you think.

## Real-world patterns

**One provider, one owning module.** The single rule that prevents the Step 3 class of bug. If two features need it, it belongs to a third module both import.

**A `CoreModule` for app-wide infrastructure, imported once by the root.** Config, logging, database connection. Make it `@Global()` only if importing it everywhere is genuinely noise; otherwise let it be an ordinary module and re-export what it wraps.

**Feature modules own their controllers.** A controller registered in a module that doesn't own the feature's services forces re-exports upward and turns the root module into a junk drawer.

**`forRoot()` at the root, `forFeature()` at the leaves.** This convention exists because of the identity rule above: `forRoot()` produces a new module instance per call, so calling it in two feature modules gives you two connections, two config objects, two of whatever it wraps. `forFeature()` is designed to be called repeatedly and to reuse what `forRoot()` established.

**Modules can inject providers; they cannot be injected.** A module class may take a constructor dependency — occasionally useful for wiring at startup — but a module class is not a provider and cannot be injected anywhere.

**Circular module imports need `forwardRef()` on both sides**, and are usually a sign the boundary is wrong. When two modules genuinely need each other, the shared thing usually wants to be a third module. See [the circular dependency recipe](../recipes/di-and-modules/circular-dependency.md).

## API reference

| Symbol | Import | Purpose |
| --- | --- | --- |
| `@Module({ … })` | `@nestjs/common` | declares a module and its four metadata arrays |
| `providers` | `@Module()` key | providers instantiated by this module and injectable within it |
| `controllers` | `@Module()` key | controllers instantiated and route-bound by this module |
| `imports` | `@Module()` key | modules whose **exported** providers become injectable here |
| `exports` | `@Module()` key | provider tokens, or modules, opened to importers |
| `@Global()` | `@nestjs/common` | adds this module to every other module's imports; `exports` still required |
| `global: true` | dynamic module property | the `@Global()` equivalent for a dynamic module |
| `forwardRef(() => M)` | `@nestjs/common` | breaks a circular module or provider reference; needed on both sides |
| `moduleIdGeneratorAlgorithm: 'deep-hash'` | app options | identity by hashed metadata instead of by object reference |

## Common mistakes

**1. Exporting without providing or importing.**

```typescript
@Module({ exports: [LedgerService] })  // ✗ UnknownExportException at boot
```

A module may only export what it provides or what it imports. This one fails loudly — the useful case.

**2. Importing the file instead of the module.** A TypeScript import at the top of a service is not a DI edge. `imports: [LedgerModule]` is.

**3. Registering a provider in two modules.** Boots fine, produces two instances, diverges silently. Adding the owning module to `imports` as well does **not** rescue it — own `providers` are checked first, so the local copy shadows the imported one. Remove the local registration; the import is the fix. This is the most expensive mistake in the article because nothing tells you it happened.

**4. Assuming transitive reach.** `A → B → C` gives `A` nothing from `C` unless `B` re-exports `C`.

**5. `@Global()` with no `exports`.**

```typescript
@Global()
@Module({ providers: [ConfigService] })  // ✗ shares nothing
```

Global adds the import edge; exports still decide what crosses it.

**6. Registering a global module more than once.** It gets pushed into every module's imports either way; registering it twice creates two module instances, and now "global" means two different singletons depending on who resolves first.

**7. Calling `forRoot()` in more than one module.**

```typescript
// app.module.ts        → imports: [DatabaseModule.forRoot(options)]
// orders.module.ts     → imports: [DatabaseModule.forRoot(options)]   // ✗ second instance
```

Each call returns a fresh object, and module identity is by reference. Call it once at the root; use `forFeature()` elsewhere.

**8. Exporting a provider when you meant to re-export a module.** `exports: [LedgerService]` opens one provider; `exports: [LedgerModule]` opens everything `LedgerModule` exports. They compile identically and mean different things.

**9. Trying to inject a module class.**

```typescript
constructor(private readonly ledgerModule: LedgerModule) {}  // ✗
```

Module classes are not providers.

**10. Reaching for `@Global()` to fix a resolution error.** It will make the error go away and hide the fact that the boundary was wrong. Fix the graph first; make things global on purpose, never as a debugging shortcut.

## How this evolved

The observable behaviour of `imports` and `exports` has been stable. Module **identity** is the part with a seam in it: v11.1.28 ships two opaque-key factories, and the container picks `ByReferenceModuleOpaqueKeyFactory` unless you pass `moduleIdGeneratorAlgorithm: 'deep-hash'`, which selects the content-hashing one instead. The difference is observable only with dynamic modules — two `forRoot()` calls with identical options are two module instances by reference and one by deep hash. If you encounter advice that assumes dynamic modules deduplicate themselves by their options, it is describing the hashing factory, not the current default.

## Exercises

**1. Make the silent bug loud.** Reproduce Step 3's duplicate registration, then write a test that fails because of it. *Hint: the test needs to write through one module and read through the other; asserting on instance identity alone is a weaker check than asserting on shared state.*

**2. Minimum exports.** Build `A → B → C` where a provider in `C` is injected in `A`, using the fewest `exports` entries that work. Then remove each one in turn and record which error you get. *Hint: two entries, and they fail differently — one at boot with an export error, one with a resolution error.*

**3. Count the modules.** Take a dynamic module with a `forRoot()`, call it in two different feature modules, and prove that two instances exist. *Hint: give the module a provider that logs in its constructor, or increments a module-level counter.*

## Summary

- A module is a **visibility boundary** (`exports` decides what crosses) with an **identity** (the opaque token decides how many exist).
- `exports` is validated at boot: you may only export what you provide or import.
- Exporting a provider and re-exporting a module use the same flat set of tokens — which is why depth requires re-exports.
- Static module identity is the class reference, so a static module is one instance however many times it's imported. Dynamic module identity is the object `forRoot()` returned, so **each call is a new module**.
- `@Global()` adds the module to every other module's `imports`. It does not bypass `exports`, it does not change resolution order, and it deletes the dependency from the graph you can read.
- Registering the same provider in two modules boots cleanly and gives you two instances. Import the owning module instead.

## See also

- [Providers and dependency injection](./providers-and-di.md) — tokens, resolution order, and why file imports aren't DI edges
- [Custom providers and injection tokens](./custom-providers-and-injection-tokens.md) — what goes in the `providers` array beyond class names
- [Bootstrap and lifecycle hooks](./bootstrap-and-lifecycle-hooks.md) — when the graph is built and in what order instances come alive
- [Dynamic modules](../architecture/dynamic-modules.md) — `forRoot`/`forFeature`, `ConfigurableModuleBuilder`
- [Recipe: circular dependency between modules](../recipes/di-and-modules/circular-dependency.md) — `forwardRef()` and when to restructure instead

## References

- [Modules](https://docs.nestjs.com/modules) — official docs
- [Custom providers](https://docs.nestjs.com/fundamentals/custom-providers) — official docs
- [Common errors](https://docs.nestjs.com/faq/common-errors) — official docs, resolution and circular-dependency error catalogue
- [`packages/core/injector/module.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/injector/module.ts) — `addExportedProviderOrModule`, `validateExportedProvider`
- [`packages/core/injector/container.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/injector/container.ts) — `addModule`, `bindGlobalScope`, opaque-key factory selection
- [`packages/core/injector/opaque-key-factory/by-reference-module-opaque-key-factory.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/injector/opaque-key-factory/by-reference-module-opaque-key-factory.ts) — module identity

## Demo source

`demos/foundations/` — extends the article 01 app with `ledger/`, `orders/`, and `billing/`.