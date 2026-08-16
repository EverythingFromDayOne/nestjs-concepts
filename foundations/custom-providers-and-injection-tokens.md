---
article_id: custom-providers-and-injection-tokens
description: Four provider forms collapse into one runtime decision, construct the class or call the factory and await it
concept_folder: foundations
wave: 1
nest_baseline: "11.1.x"
node_baseline: "24"
related:
  - foundations/providers-and-di
  - foundations/modules-and-the-module-graph
  - foundations/scopes-and-lifetimes
  - foundations/configuration-and-environment
  - architecture/dynamic-modules
  - recipes/di-and-modules/nest-cant-resolve-dependencies
status:
  drafted: true
  reviewed: false
v12_watch: false
---

# Custom providers and injection tokens

> **Lead with this.** [Article 01](./providers-and-di.md) established that Nest injects tokens, not types. This is the other half: what a token may *be*, and what it may resolve *to*. There are four provider forms, and they look like four different features — but at runtime they collapse into one decision the container makes about your provider: **`new` it, or call it as a function.** `useClass` gets `new`. `useFactory` gets called. `useValue` skips both because the value already exists. And `useExisting` is a factory whose function is `instance => instance`. Holding that reduction in mind turns four sets of rules into one, and explains the otherwise-arbitrary behaviours — like why a value provider can't have dependencies, and why an async factory blocks your entire boot.

## What it is

A provider registration is a **token** plus **instructions for producing a value**. The shorthand `providers: [CatsService]` supplies both at once because the token and the class happen to be the same object. Everything else is the long form:

```typescript
{ provide: TOKEN, useClass:    SomeClass }
{ provide: TOKEN, useValue:    someValue }
{ provide: TOKEN, useFactory:  (…deps) => value, inject: [/* tokens */] }
{ provide: TOKEN, useExisting: OTHER_TOKEN }
```

A token may be a class reference, a string, a symbol, an enum member, or an abstract class. It may **not** be an interface or a type alias — those don't exist at runtime, which [article 04](./decorators-and-metadata-reflection.md#how-it-works-under-the-hood) covers in mechanical detail.

The reason to reach past the shorthand is always one of four: the value isn't a class; the class to use depends on something; the value needs computing, possibly asynchronously; or one thing needs two names.

## How it works under the hood

### Detection is by key presence, in a fixed order

Nest doesn't validate your provider object. It asks four questions in sequence and takes the first `true`:

```typescript
// paraphrased from packages/core/injector/module.ts — addCustomProvider
if (this.isCustomClass(provider))            this.addCustomClass(provider, …);
else if (this.isCustomValue(provider))       this.addCustomValue(provider, …);
else if (this.isCustomFactory(provider))     this.addCustomFactory(provider, …);
else if (this.isCustomUseExisting(provider)) this.addCustomUseExisting(provider, …);
```

So a provider carrying both `useClass` and `useFactory` is a **class provider**, silently — the extra key is never looked at and no error is raised.

There's an asymmetry inside those checks worth knowing, because it produces two very different failures from two similar typos:

```typescript
// paraphrased
isCustomClass:       !isUndefined(provider.useClass)
isCustomValue:       Object.prototype.hasOwnProperty.call(provider, 'useValue')
isCustomFactory:     !isUndefined(provider.useFactory)
isCustomUseExisting: !isUndefined(provider.useExisting)
```

`useValue` is detected by **key presence**, the other three by **value definedness**. Which means `{ provide: T, useValue: undefined }` is a perfectly valid value provider that injects `undefined` — deliberately, so you can.

`{ provide: T, useFactory: undefined }` matches none of the four branches. It isn't registered, and the failure is worse than an unresolvable dependency: measured, the boot dies with `Cannot read properties of undefined (reading 'metatype')`. Nothing in that message names your provider, your token, or your module. If you ever see it, look for a `use*` key whose value is `undefined`.

### What each form builds

Every provider becomes an `InstanceWrapper`. The differences are small and consequential:

| Form | `metatype` | `inject` | Notable |
| --- | --- | --- | --- |
| `useClass` | the class | *(unset)* | `scope` and `durable` **inherit from the class's own `@Injectable()`** if not specified on the provider |
| `useValue` | `null` | *(unset)* | created with `isResolved: true` and the instance already set; `async` is true if the value is a Promise |
| `useFactory` | the factory function | `inject ?? []` | — |
| `useExisting` | `instance => instance` | `[useExisting]` | an alias is literally a factory with the identity function |

Two of those rows are the whole article.

**`useValue` is already resolved.** The wrapper is constructed with the instance in place and `isResolved: true`. Nothing is ever built, so a value provider cannot have dependencies and cannot be given any — there is no phase in which they'd be injected.

**`useExisting` isn't a special aliasing feature.** It's a factory provider whose function returns whatever it was handed and whose single declared dependency is the target token. That's why an alias resolves to the *same instance* rather than a copy, and why the aliased token has to be resolvable from the same module.

### Instantiation: one branch, two behaviours

Everything above funnels into a single conditional:

```typescript
// paraphrased from packages/core/injector/injector.ts — instantiateClass
if (isNil(inject) && isInContext) {
  instanceHost.instance = new (metatype as Type<any>)(...instances);
} else if (isInContext) {
  const factoryReturnValue = (targetMetatype.metatype as any as Function)(...instances);
  instanceHost.instance = await factoryReturnValue;
}
```

**If `inject` is nil, `new` it. Otherwise, call it and `await` the result.** Three things fall out:

- **Async factories work for free.** The return value is awaited, so a factory may be `async` or return a Promise. The cost is that `NestFactory.create()` does not resolve until it settles — an async provider blocks the entire boot, and a factory that hangs hangs your deploy with no timeout of its own.
- **`inject: []` is not nil.** An empty array still routes to the call branch, which is why a zero-dependency factory works exactly as you'd expect.
- **`useExisting` needs no special case.** Identity function, one dependency, done.

### Optional factory dependencies

The `inject` array accepts an object form for dependencies that may legitimately be absent:

```typescript
inject: [ConfigService, { token: 'METRICS', optional: true }]
```

Detection requires **both** `token` and `optional` to be defined, and the object to have no `prototype` — that last condition is what stops a class from being mistaken for an options object. An optional token that resolves to nothing arrives as `undefined` rather than failing the boot.

## Minimal shapes

```typescript
// useClass — the container constructs it
{ provide: PAYMENT_GATEWAY, useClass: StripeGateway }

// useValue — you constructed it, or it isn't a class at all
{ provide: RATE_TABLE, useValue: { USD: 1, EUR: 0.92 } }

// useFactory — compute it, optionally from other providers
{
  provide: RATE_TABLE,
  useFactory: (config: ConfigService) => loadRates(config.get('RATES_URL')),
  inject: [ConfigService],
}

// useExisting — a second name for the same instance
{ provide: 'LegacyRateTable', useExisting: RATE_TABLE }
```

## Choosing a form

| Use | When | What it costs |
| --- | --- | --- |
| `useClass` | the value is a class the container should build, and which class may vary | the choice is fixed at authoring time unless computed inline; **scope silently inherits from the class** |
| `useValue` | a constant, a pre-built object, a third-party client, or a test double | no DI at all — the value can't depend on anything, and you own its lifetime |
| `useFactory` | the value depends on config or other providers, or needs async setup | positional `inject`; async factories block boot; the factory becomes a place logic hides |
| `useExisting` | one instance genuinely needs two names — usually a rename in progress | two tokens for one thing is invisible at the call site; a permanent alias is a permanent confusion |

And for the token itself:

| Token | When | What it costs |
| --- | --- | --- |
| Class reference | the token and the implementation are the same class | consumers import the concrete class — the coupling the other options exist to avoid |
| `Symbol` | library code, or anywhere collisions matter | unique runtime identity, but requires `@Inject()` at every consumer |
| String | quick, readable, greppable | collides silently across packages; namespace it (`'catalog:rates'`) |
| Abstract class | you want one artifact to be both contract and token | works with plain constructor injection, no `@Inject()`; consumers take a hard import on the contract file |

## Walkthrough — an exchange-rate provider, four ways

We extend `demos/foundations` with `src/rates/`. The ledger from [article 02](./modules-and-the-module-graph.md) records amounts; now they need converting. Each step arrives because the previous one stopped being enough.

### Step 1 — a value provider

```typescript
// src/rates/rates.tokens.ts
export const RATE_TABLE = Symbol('RATE_TABLE');

export interface RateTable {
  // `| undefined` is load-bearing under `strict`: without it, `rates[x]` is
  // typed `number` and the missing-key guard below is a compile error.
  readonly [currency: string]: number | undefined;
}
```

```typescript
// src/rates/rates.module.ts
import { Module } from '@nestjs/common';
import { RATE_TABLE } from './rates.tokens';

@Module({
  providers: [{ provide: RATE_TABLE, useValue: { USD: 1, EUR: 0.92, VND: 26150 } }],
  exports: [RATE_TABLE],
})
export class RatesModule {}
```

```typescript
// src/rates/rates.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { RATE_TABLE, RateTable } from './rates.tokens';

@Injectable()
export class RatesService {
  constructor(@Inject(RATE_TABLE) private readonly rates: RateTable) {}

  convert(amount: number, currency: string): number {
    const rate = this.rates[currency];
    if (rate === undefined) {
      throw new Error(`No rate for ${currency}`);
    }
    return amount * rate;
  }
}
```

Note what's already true and easy to miss: `RATE_TABLE` is exported, not `RatesModule`'s providers wholesale, and the exported thing is the **token**, not a class. Note also that the value provider cannot read configuration — it has no dependencies and no phase in which to acquire any.

### Step 2 — the rates depend on configuration

Hard-coding stops working the moment staging and production want different tables. A factory can depend on other providers:

```typescript
// src/rates/rates.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '../config/config.module';
import { ConfigService } from '../config/config.service';
import { RATE_TABLE, RateTable } from './rates.tokens';
import { RatesService } from './rates.service';

const STATIC_TABLES: Record<string, RateTable> = {
  test: { USD: 1, EUR: 1, VND: 1 },
  default: { USD: 1, EUR: 0.92, VND: 26150 },
};

@Module({
  imports: [ConfigModule],
  providers: [
    RatesService,
    {
      provide: RATE_TABLE,
      useFactory: (config: ConfigService): RateTable =>
        STATIC_TABLES[config.get('RATES_PROFILE') ?? 'default'] ?? STATIC_TABLES.default,
      inject: [ConfigService],
    },
  ],
  exports: [RatesService],
})
export class RatesModule {}
```

Two rules from [article 01](./providers-and-di.md#real-world-patterns) apply unchanged and are worth restating because factories are where people forget them: `inject` is **positional** — Nest passes the resolved tokens to the factory in array order, and the parameter names mean nothing — and the factory's dependencies must be resolvable **from this module**, which is why `ConfigModule` is imported.

### Step 3 — fetching rates at boot, and what that costs

Real rates come from somewhere. The factory can be async, and the container awaits it:

```typescript
// src/rates/rates.module.ts (provider only)
{
  provide: RATE_TABLE,
  useFactory: async (config: ConfigService): Promise<RateTable> => {
    const url = config.get('RATES_URL');
    if (!url) {
      return STATIC_TABLES.default;
    }
    const response = await fetch(url);
    return (await response.json()) as RateTable;
  },
  inject: [ConfigService],
}
```

This works, and it is the point in the article where you should be uneasy. `await factoryReturnValue` is inside the container's instantiation path, so **`NestFactory.create()` does not return until this settles**. Measured on the demo app: bootstrap goes from 211 ms to 3208 ms when the factory awaits a three-second delay — the whole delay, paid on every start. A rejecting factory fails the boot outright, through `[ExceptionHandler]`, with exit status 1.

Concretely:

- A slow rates endpoint is a slow deploy. A hanging one is a deploy that never completes, with no built-in timeout.
- A failing fetch is a boot failure. That may be exactly right — if the app is useless without rates, failing loudly at boot beats failing per request. But it is a decision, and doing it by accident is how a third-party outage takes down your rolling deploy.
- Nothing retries. The value is computed once, and there is no refresh without a scheduler.

The alternative is to provide something that fetches *later* — a class provider with an `onModuleInit` hook, or a service that caches on first use. The trade-off is honest either way: **async factory** gives you a guarantee that the value exists before the first request, at the cost of boot-time coupling. **Lazy fetch** gives you a fast, resilient boot at the cost of handling absence in every consumer. Choose deliberately; the default should be a timeout around the fetch whichever you pick.

### Step 4 — an optional dependency in the inject array

Suppose a metrics sink should be used when present:

```typescript
{
  provide: RATE_TABLE,
  useFactory: async (
    config: ConfigService,
    metrics?: { increment(metric: string): void },
  ): Promise<RateTable> => {
    const table = await /* … the Step 3 factory body … */ fetchRates(config);
    metrics?.increment('rates.loaded');
    return table;
  },
  // METRICS_SINK is the token from article 01; nothing registers it here,
  // which is the point — `optional` means that's allowed.
  inject: [ConfigService, { token: METRICS_SINK, optional: true }],
}
```

The object form is recognised only when **both** `token` and `optional` are present, so `{ token: METRICS_SINK }` alone is not an optional dependency — it's an object that isn't a valid token, and you'll get a resolution error naming something you don't recognise. Match the factory's optional parameter (`?`) to the array entry, or `strict` mode will let you dereference something that isn't there.

### Step 5 — renaming a token without breaking consumers

Four other modules inject `RATE_TABLE`. You want to rename it `EXCHANGE_RATES`. `useExisting` lets both names resolve to one instance during the migration:

```typescript
// src/rates/rates.tokens.ts
export const EXCHANGE_RATES = Symbol('EXCHANGE_RATES');
/** @deprecated use EXCHANGE_RATES — removal planned for the next release */
export const RATE_TABLE = Symbol('RATE_TABLE');
```

```typescript
// src/rates/rates.module.ts (providers)
providers: [
  RatesService,
  { provide: EXCHANGE_RATES, useFactory: /* … as above … */, inject: [ConfigService] },
  { provide: RATE_TABLE, useExisting: EXCHANGE_RATES },  // ← alias, same instance
],
exports: [RatesService, EXCHANGE_RATES, RATE_TABLE],
```

Both tokens now resolve to the same object — not a copy, because the alias is an identity factory over the real token. The reason to keep this temporary: at a consumer's call site, `@Inject(RATE_TABLE)` gives no hint that it's an alias. A permanent alias is a permanent second name for one thing, and the next person will assume they're different.

**The `useClass` variant of the same idea**, with a trap worth naming. This is a different provider — a *source* that fetches, rather than the table itself:

```typescript
// src/rates/rates.tokens.ts
export const RATE_SOURCE = Symbol('RATE_SOURCE');

export abstract class RateSource {
  abstract load(): Promise<RateTable>;
}
```

```typescript
{ provide: RATE_SOURCE, useClass: process.env.NODE_ENV === 'test' ? FakeRates : LiveRates }
```

If `LiveRates` is declared `@Injectable({ scope: Scope.REQUEST })`, the provider inherits that scope — the wrapper takes `scope` from the class when the provider doesn't specify one. So a token that looks like a singleton becomes request-scoped, and every consumer above it in the graph becomes request-scoped too. That propagation is [scopes and lifetimes](./scopes-and-lifetimes.md); the thing to carry here is that **`useClass` imports the class's scope along with the class.**

### Verify the loop

A custom token's payoff is substitution, so test exactly that. This assumes the Step 5 rename, so `RatesService` now injects `EXCHANGE_RATES`:

```typescript
// src/rates/rates.service.spec.ts
import { Test } from '@nestjs/testing';
import { RatesService } from './rates.service';
import { EXCHANGE_RATES } from './rates.tokens';

describe('RatesService', () => {
  it('converts using the injected table', async () => {
    const moduleRef = await Test.createTestingModule({
      providers: [
        RatesService,
        { provide: EXCHANGE_RATES, useValue: { EUR: 0.5 } },
      ],
    }).compile();

    expect(moduleRef.get(RatesService).convert(100, 'EUR')).toBe(50);
  });
});
```

No network, no config, no mocking library — the token was pointed somewhere else. That is the return on everything above.

And when a factory-heavy module won't boot:

```bash
NEST_DEBUG=true npm run start
```

Each dependency is logged as it resolves, with the module being searched. For a factory, the tokens in `inject` appear individually — so an `inject` entry that isn't resolvable shows up by name rather than as a generic failure on the factory.

## Real-world patterns

**Tokens live in their own file.** `*.tokens.ts` per feature. Tokens defined in a module file, imported by a provider that the module also imports, is the standard route to a circular import — and the error names an undefined dependency rather than the cycle.

**Export the token, not just the service.** A consumer injecting `@Inject(EXCHANGE_RATES)` needs that token in the module's `exports`. Exporting `RatesService` alone opens the service and nothing else.

**Prefer a factory over a value for anything environment-dependent.** A `useValue` that reads `process.env` at module-definition time is evaluated when the file is imported, which is before configuration is validated and outside any test's control.

**Wrap third-party clients in a token.** A Redis client, an S3 client, a payment SDK — `useFactory` to construct, a symbol as the token, and consumers never import the vendor package. This is the pattern that makes replacing a vendor a module-level change.

**Async factory or lifecycle hook, chosen on purpose.** Async factory when the app is meaningless without the value. `onModuleInit` or lazy caching when a degraded start beats no start.

**Don't let a factory become a service.** A factory that branches five ways is logic in a place with no tests and no name. Give it a class and use `useClass`.

## API reference

| Symbol | Purpose |
| --- | --- |
| `{ provide, useClass }` | container constructs the class; scope inherits from the class unless overridden |
| `{ provide, useValue }` | pre-built value; resolved immediately, no dependencies possible |
| `{ provide, useFactory, inject }` | factory return value, awaited if async; `inject` is positional |
| `{ provide, useExisting }` | alias — identity factory over another token, same instance |
| `{ token, optional: true }` | optional entry in an `inject` array; needs both keys |
| `scope`, `durable` | per-provider overrides; on `useClass` they default to the class's own decorator |
| `@Inject(TOKEN)` | required at the consumer for any non-class token |
| `exports: [TOKEN]` | what makes the token visible outside its module |

## Common mistakes

**1. Two `use*` keys on one provider.**

```typescript
{ provide: T, useClass: A, useFactory: () => b }  // ✗ silently a class provider
```

Detection order is `useClass` → `useValue` → `useFactory` → `useExisting`, first match wins, no error.

**2. A typo'd factory key vanishes; a typo'd value key doesn't.** `useFactory: undefined` registers nothing at all. `useValue: undefined` registers a provider that injects `undefined`. Same-looking mistakes, completely different symptoms.

**3. Expecting a value provider to have dependencies.** It's created already resolved. If it needs anything, it's a factory.

**4. `inject` order not matching the factory signature.** Positional, always. Reordering one list and not the other gives you a type error at best and a wrong object at worst.

**5. A factory dependency the module can't see.** The factory gets no special access — its `inject` tokens resolve from the declaring module like anything else.

**6. Async factory with no timeout.** A hanging fetch hangs the boot. Nest will not intervene.

**7. `useClass` importing a scope you didn't want.** A request-scoped class behind a token makes that token request-scoped, and the scope propagates upward through everything that injects it.

**8. Expecting `useExisting` to give you a copy.** It's the same instance. Mutating through one token mutates the other.

**9. Forgetting to export the token.** The provider exists, the consumer's module imports the right module, and resolution still fails — because `exports` lists the service and not the token.

**10. A plain interface as a token.** It doesn't exist at runtime; the unresolvable token shows up as `Object`. Use a symbol or an abstract class.

## How this evolved

The four forms have been stable. The refinement worth knowing is the `inject` array's object entry — `{ token, optional: true }` — which replaced defaulting inside the factory body for dependencies that may be absent. It's detected structurally rather than by a marker class, which is why the check also requires the object to have no `prototype`: without that condition, a class in the `inject` array could be misread as an options object.

## Exercises

**1. Predict the winner.** Write a provider with `useValue` and `useFactory` on the same object, boot it, and see which one takes effect. Then work out from the detection order why. *Hint: it is not the one you wrote second.*

**2. Feel the boot cost.** Make an async factory that resolves after ten seconds, then time `NestFactory.create()`. Then make it reject and observe what the app does. *Hint: the second case is arguably the correct behaviour — decide whether it's correct for your app.*

**3. Alias and prove it.** Register a token and an alias to it, inject both into one service, and assert they are the same object. Then change one through its own token and observe the other. *Hint: `toBe`, not `toEqual`.*

## Summary

- A provider is a **token plus instructions**. Four forms, and at runtime one branch: if `inject` is nil, `new` the metatype; otherwise call it and await the result.
- Detection is by key presence in a fixed order — `useClass`, `useValue`, `useFactory`, `useExisting` — with no validation and no error for extra keys.
- `useValue` is created already resolved, so it can never have dependencies; it's also the only form detected by key *presence*, which makes `useValue: undefined` legal.
- `useExisting` is an identity factory over another token — hence the same instance, not a copy.
- Async factories are awaited inside boot: the value is guaranteed before the first request, and the boot is hostage to whatever the factory calls.
- `useClass` inherits the class's `scope` and `durable` unless the provider overrides them.
- Tokens may be classes, strings, symbols, enums, or abstract classes — never interfaces.

## See also

- [Providers and dependency injection](./providers-and-di.md) — tokens, resolution order, the `@Inject()` overlay
- [Modules and the module graph](./modules-and-the-module-graph.md) — exporting a token so consumers can see it
- [Scopes and lifetimes](./scopes-and-lifetimes.md) — what a request-scoped `useClass` propagates
- [Configuration and environment](./configuration-and-environment.md) — the usual `inject` dependency of a factory
- [Dynamic modules](../architecture/dynamic-modules.md) — `forRoot`/`forFeature` built on these forms
- [Recipe: "Nest can't resolve dependencies of…"](../recipes/di-and-modules/nest-cant-resolve-dependencies.md)

## References

- [Custom providers](https://docs.nestjs.com/fundamentals/custom-providers) — official docs
- [Asynchronous providers](https://docs.nestjs.com/fundamentals/async-providers) — official docs
- [`packages/core/injector/module.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/injector/module.ts) — `addCustomProvider` detection order and the four wrapper shapes
- [`packages/core/injector/injector.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/injector/injector.ts) — `instantiateClass` new-vs-call branch, `getFactoryProviderDependencies`

## Demo source

`demos/foundations/` — adds `rates/` to the app built in articles 01–04.