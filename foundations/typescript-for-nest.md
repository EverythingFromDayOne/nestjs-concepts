---
article_id: typescript-for-nest
description: Type erasure is a runtime property in Nest, because the framework reads your types back through reflection
concept_folder: foundations
wave: 1
write_order: 00
nest_baseline: "11.1.x"
node_baseline: "24"
typescript_baseline: "5.9.x"
related:
  - foundations/providers-and-di
  - foundations/decorators-and-metadata-reflection
  - request-lifecycle/pipes
  - validation/dtos-and-class-validator
  - validation/validationpipe-in-depth
  - recipes/di-and-modules/nest-cant-resolve-dependencies
status:
  drafted: true
  reviewed: false
v12_watch: true
---

# TypeScript for Nest

> **Lead with this.** In most TypeScript projects, type erasure is a compile-time curiosity: the types vanish, nothing notices, and the only cost of getting them wrong is a red squiggle. In NestJS it is a **runtime property**, because the framework reads your types back at runtime through reflection. Three consequences already measured elsewhere in this corpus: an `interface` used as a DTO **silently disables validation**, so the endpoint accepts arbitrary JSON; a parameter whose type erased makes dependency injection fail with a message naming `Object`; and `import type` — a free optimisation in a front-end project — **breaks dependency injection** if you apply it to a class you inject. So the organising question for this article is not "what does this TypeScript feature mean." It is **"what is still there when the program runs."**

## What it is

A prerequisite, not a TypeScript course. It covers the features whose *runtime* behaviour Nest depends on, at `typescript@5.9.x`, and it assumes you can already read an interface and a generic.

What it deliberately does not cover: the type system for its own sake — mapped types, variance, template literal types — except where Nest reads them. The handbook is better at that, and the References list points there.

Read it before [article 01](./providers-and-di.md) if you're new to TypeScript, or skim §How it works and §Common mistakes if you aren't. Everything here is measured against the corpus's own baseline rather than quoted.

> **If you know Angular.** Angular's compiler reads your decorators at **build** time and generates code from them; the metadata is a compilation input and is largely gone from the bundle afterwards. Nest reads decorators and emitted type metadata at **runtime**, when `NestFactory.create()` walks your classes. So the same TypeScript file behaves differently in the two frameworks: in Angular, a type that erases badly usually produces a build error or an AOT diagnostic; in Nest it produces a *running application that behaves wrongly*. The habit to bring is caring about `tsconfig.json`. The habit to drop is assuming the compiler will stop you.

## How it works under the hood

### The erasure ledger

Everything TypeScript-only disappears; everything with a runtime representation stays. Nest's behaviour depends on knowing which column a feature is in.

| Erased completely | Survives as JavaScript | Survives **only with a compiler flag** |
| --- | --- | --- |
`interface`, `type` aliases | `class` | `design:paramtypes` — constructor parameter types |
| type annotations (`: string`) | `enum` (compiles to an object) | `design:type` — property types |
| generics (`<T>`) | parameter properties (`private readonly x`) | `design:returntype` — method return types |
| `as` assertions, `satisfies` | decorators themselves | |
| `is` / `asserts` predicates | `const` objects, arrays | |
| `readonly`, `import type` | | |

The third column is `emitDecoratorMetadata`, and [article 04](./decorators-and-metadata-reflection.md#how-it-works-under-the-hood) measured exactly what it emits. Two results from that measurement are the whole reason this article exists:

```
decorated class, interface-typed param  → design:paramtypes = [ 'Object', … ]
undecorated class                       → design:paramtypes = undefined
```

An erased type becomes `Object`. A class with **no** decorator emits nothing at all. Those are different bugs with different fixes, and neither is a compile error.

### Nest's three reflection channels

1. **Emitted type metadata** — `design:paramtypes` powers constructor injection ([article 01](./providers-and-di.md)) and `metatype` in pipes ([article 13](../request-lifecycle/pipes.md)).
2. **Your own metadata** — `SetMetadata`, `Reflector.createDecorator`, read by guards and interceptors ([article 04](./decorators-and-metadata-reflection.md)).
3. **Constructor identity** — `class-validator` looks rules up by `value.constructor`, which is why a DTO must be a class ([article 16](../validation/dtos-and-class-validator.md)).

All three need something to exist at runtime. That's the entire thesis.

### The two `tsconfig.json` flags that are not optional

```jsonc
{
  "experimentalDecorators": true,   // parameter decorators (@Inject, @Param, @Body)
  "emitDecoratorMetadata": true     // design:* metadata
}
```

Per the TypeScript 5.0 release notes, the **standard** (Stage 3) decorators — the default since 5.0, with no flag — support neither `emitDecoratorMetadata` nor parameter decorators. Nest needs both. So `experimentalDecorators: true` in a Nest project is a current requirement, not legacy baggage, and "modernising" it away breaks the application in a way the type-checker will not report.

### Node 24 cannot run idiomatic Nest source directly

Node's built-in type stripping runs `.ts` files by deleting types — it never *generates* code. Measured:

```
$ node service.ts
SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]:
  TypeScript parameter property is not supported in strip-only mode

$ node status.ts
SyntaxError [ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX]:
  TypeScript enum is not supported in strip-only mode
```

A plain interface-and-annotation file runs fine. But **parameter properties** — `constructor(private readonly catsService: CatsService)`, the shape of every service in this corpus — require generated code (`this.catsService = catsService`), and strip-only mode won't generate it. So `node src/some.service.ts` cannot run idiomatic Nest code, and neither can any tool in strip-only mode. That's why the demos build with `nest build`/`tsc` and test through `ts-jest` rather than Node's loader.

`enum` fails for the same reason: it compiles to a runtime object, which is generation, not stripping. §Step 3 replaces it.

### `verbatimModuleSyntax` doesn't apply to this baseline

The flag that *forces* `import type` where it's needed is `verbatimModuleSyntax` (TypeScript 5.0). Measured against our own `tsconfig.base.json`:

```
error TS1484: 'Customer' is a type and must be imported using a type-only
              import when 'verbatimModuleSyntax' is enabled.

error TS1295: ECMAScript imports and exports cannot be written in a CommonJS
              file under 'verbatimModuleSyntax'.
```

The first is the diagnostic you want. The second is the problem: `verbatimModuleSyntax` is **incompatible with `module: commonjs`**, which is this corpus's baseline. So the flag is not available to us until the ESM move — you write `import type` by discipline, or with the `@typescript-eslint/consistent-type-imports` lint rule, not because the compiler insists.

## Minimal shapes

```typescript
// class — the only shape Nest can reflect on
export class CreateOrderDto { @IsString() customerId!: string; }

// literal union — a closed set with no runtime object
export type OrderStatus = 'pending' | 'shipped' | 'delivered';

// as const + keyof typeof — a closed set you can also iterate
export const ORDER_STATUS = { pending: 'pending', shipped: 'shipped' } as const;
export type OrderStatusValue = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];

// satisfies — check the shape, keep the literals
export const rateLimits = { default: 100, export: 5 } satisfies Record<string, number>;

// type predicate — narrowing you own
function isRetryable(e: unknown): e is { code: string } {
  return typeof e === 'object' && e !== null && 'code' in e;
}

// assertion signature — narrowing by throwing
function assertIsPayload(v: unknown): asserts v is JobPayload { /* throw if not */ }

// module augmentation — extend someone else's runtime object's type
declare global { namespace Express { interface Request { correlationId?: string } } }
```

## Walkthrough — following types to the runtime boundary

We use `demos/foundations`, which already contains everything these steps instrument.

### Step 1 — read the ledger with your own eyes

```typescript
// src/typescript/erasure.probe.ts
import 'reflect-metadata';
import { Injectable } from '@nestjs/common';

interface Shape { area(): number }
class Concrete {}

@Injectable()
class Decorated {
  constructor(shape: Shape, concrete: Concrete, when: Date) {}
}

class Undecorated {
  constructor(concrete: Concrete) {}
}

export function probe(): void {
  const names = (t: unknown[] | undefined) => t?.map((x) => (x as { name?: string })?.name);
  console.log('decorated  :', names(Reflect.getMetadata('design:paramtypes', Decorated)));
  console.log('undecorated:', Reflect.getMetadata('design:paramtypes', Undecorated));
}
```

```
decorated  : [ 'Object', 'Concrete', 'Date' ]
undecorated: undefined
```

`Shape` is gone — it became `Object`, and `Object` is a real constructor, so nothing looks wrong until the injector tries to resolve a provider registered under it. `Undecorated` emitted nothing, because emission is per-decorated-declaration.

**The diagnostic to remember**, from [article 04](./decorators-and-metadata-reflection.md#how-it-works-under-the-hood): `undefined` means a missing decorator; `Object` means an erased type. Print this before reading module files.

### Step 2 — `interface`, `type`, or `class`

The usual front-end advice — prefer `type`, or prefer `interface`, or use whichever reads better — is fine for internal shapes and actively dangerous at a runtime boundary. In Nest:

| Use | For |
| --- | --- |
| `class` | **anything Nest reflects on**: DTOs, entities, injectable providers, and abstract classes used as DI tokens |
| `interface` | contracts between your own code — a service's port, a strategy's shape, a repository interface paired with a symbol token |
| `type` | unions, tuples, function types, mapped and conditional types — everything `interface` can't express |

The consequence of getting the first row wrong, measured in [article 13](../request-lifecycle/pipes.md#step-4--the-interface-trap-demonstrated) and [article 17](../validation/validationpipe-in-depth.md#forbidunknownvalues-is-forced-off):

```typescript
export interface CreateItemDto { name: string; quantity: number }

@Post()
create(@Body() dto: CreateItemDto) { /* … */ }   // ✗ no validation, no error, no log
```

`metatype` is `Object`, `ValidationPipe.toValidate` returns early, and the handler receives whatever was posted — extra fields included, `whitelist` notwithstanding. Changing one keyword to `class` and adding decorators fixes it. Nothing else in the file changes.

Two related rules from elsewhere in the corpus, both consequences of the same mechanism:

- An **interface cannot be a DI token** ([article 01](./providers-and-di.md)). Use a `Symbol` or an **abstract class** — abstract classes exist at runtime, so they can be both the contract and the token.
- A **class used only as a type** still emits into `design:paramtypes`, which is why the next step is a trap rather than an optimisation.

### Step 3 — `import type` is not free here

In a front-end codebase, marking a type-only import saves bundle weight and breaks import cycles at no cost. In Nest it can silently switch off dependency injection:

```typescript
// ✗ DI now fails — the class reference is erased
import type { CatsService } from './cats.service';

@Injectable()
export class CatsController {
  constructor(private readonly catsService: CatsService) {}
}
```

`import type` guarantees the import is erased, so `design:paramtypes` records `Object` and boot fails with a message that names `Object` rather than `CatsService`. It looks like a harmless lint fix. It is [article 01's mistake #7](./providers-and-di.md#common-mistakes).

The rule, stated as a rule:

- **Value import** for anything that appears in a constructor Nest resolves, in a `providers` array, in `@Catch()`, in `@Type(() => X)`, or as a DI token.
- **`import type`** for everything else — and it is genuinely valuable there, because it's the clean way to break the circular imports [article 02](./modules-and-the-module-graph.md#common-mistakes) and [article 05](./custom-providers-and-injection-tokens.md#real-world-patterns) both warn about, without `forwardRef`.

Since `verbatimModuleSyntax` isn't available on a CommonJS baseline, nothing enforces this. `@typescript-eslint/consistent-type-imports` will do it — but configure it to leave decorated files alone, or its auto-fix will helpfully break your injection.

### Step 4 — closed sets without `enum`

`enum` compiles to a runtime object, which means it can't be stripped, has a reverse-mapping surface people trip on, and — measured above — won't run under Node's type stripping. Two better shapes, chosen by whether you need to *iterate* the set.

**Type-only set** — no runtime footprint at all:

```typescript
export type OrderStatus = 'pending' | 'shipped' | 'delivered';
```

**`as const` object** — when you also need the values at runtime, for a dropdown, a database check constraint, or a validator:

```typescript
// src/orders/order-status.ts
export const ORDER_STATUS = {
  pending: 'pending',
  shipped: 'shipped',
  delivered: 'delivered',
} as const;

export type OrderStatus = (typeof ORDER_STATUS)[keyof typeof ORDER_STATUS];
//   → 'pending' | 'shipped' | 'delivered'

export const ORDER_STATUSES = Object.values(ORDER_STATUS);   // real array, no reverse keys
```

Three pieces, each doing one job:

- **`as const`** freezes the object *and* narrows each value from `string` to its literal. Without it, the extracted type is `string` and you've gained nothing.
- **`keyof typeof X`** collects the keys as a union — `typeof` lifts a runtime value into the type world, `keyof` reads its keys.
- **`(typeof X)[keyof typeof X]`** indexes that type by all its keys, yielding the union of *values*.

In a DTO this pairs with `@IsIn(ORDER_STATUSES)` or `@IsEnum(ORDER_STATUS)`, so the runtime check and the compile-time type come from one declaration. Add a status and both update.

**On `readonly` versus `as const`**, since they're often confused: `readonly` is a *modifier you write in a type* and it's shallow — nested objects stay mutable and values keep their wide types. `as const` is an *assertion on a value*, applies recursively, and narrows to literals. For constants you want `as const`; for a function parameter you promise not to mutate, `readonly T[]` is the right tool.

### Step 5 — narrowing where Nest hands you nothing

Nest validates HTTP input for you. Everywhere else — a queue payload, a webhook body, `catch (error)` — you are on your own, and `catch` gives you `unknown` under `strict`.

**Type predicates** for branching:

```typescript
// src/typescript/errors.ts
export function isPgUniqueViolation(error: unknown): error is { code: string } {
  return typeof error === 'object' && error !== null && 'code' in error
    && (error as { code?: unknown }).code === '23505';
}
```

```typescript
try {
  await this.orders.insert(dto);
} catch (error) {
  if (isPgUniqueViolation(error)) {
    throw new ConflictException('Order already exists');
  }
  throw error;                                   // ← re-throw, per article 12
}
```

The `is` in the return type is what makes the narrowing stick; a plain `boolean` leaves `error` as `unknown` inside the branch. Note that `is` is a **return-type annotation only** — there is no `if (error is X)` syntax, because the check has to be a real function call that survives to runtime.

**Assertion signatures** when there's no sensible branch:

```typescript
export function assertIsJobPayload(value: unknown): asserts value is JobPayload {
  const result = jobPayloadSchema.safeParse(value);      // or class-validator
  if (!result.success) {
    throw new Error(`Invalid job payload: ${result.error.message}`);
  }
}
```

After the call, everything below is narrowed. This is the right shape for a queue consumer's entry point — the same trust-boundary discipline [article 16](../validation/dtos-and-class-validator.md#real-world-patterns) argues for, expressed in the type system.

**Exhaustiveness with `never`**, which is how you make adding a variant a compile error rather than a silent fall-through:

```typescript
function label(status: OrderStatus): string {
  switch (status) {
    case 'pending': return 'Pending';
    case 'shipped': return 'Shipped';
    case 'delivered': return 'Delivered';
    default: return assertNever(status);
  }
}

function assertNever(value: never): never {
  throw new Error(`Unhandled variant: ${String(value)}`);
}
```

Add `'cancelled'` to `OrderStatus` and this file fails to compile — which is exactly what you want when the union is a database column, a state machine, or an API contract.

**And a limit worth stating plainly:** `satisfies` does none of this. It is compile-time only, so it cannot validate anything that arrives at runtime. It's excellent for a config object you typed by hand — it checks the shape while keeping the literal types, so `rateLimits.export` stays `5` rather than widening to `number` — and it is useless against an API response. For that you need `class-validator` or a schema library, which is a *runtime* check.

### Step 6 — declaration merging, and the cast this corpus keeps making

[Article 10](../request-lifecycle/middleware.md#step-1--a-correlation-id-and-why-it-has-to-be-here) attaches a correlation ID to the request. [Article 11](../request-lifecycle/guards.md#real-world-patterns) attaches the authenticated user. Both said "augment the type once rather than casting at every read site" and neither showed how. Here it is:

```typescript
// src/typescript/express.d.ts
export interface AuthUser {
  id: string;
  roles: string[];
}

declare global {
  namespace Express {
    interface Request {
      correlationId?: string;
      user?: AuthUser;
    }
  }
}
```

```typescript
// anywhere — no cast
import type { Request } from 'express';

export function describe(req: Request): string {
  return `${req.correlationId ?? '-'} ${req.user?.roles.join(',') ?? 'anonymous'}`;
}
```

Verified: this compiles clean under `strict` with `@types/express@5`, and `req.correlationId` and `req.user` are typed everywhere in the project — middleware, guards, interceptors, handlers — with no cast at any read site.

Three details that decide whether it works:

- **`@types/express` declares a global `Express` namespace** as its extension point. Merging into it reaches every `Request` in the program.
- **A file containing any top-level `import`/`export` is a module**, so the augmentation must be wrapped in `declare global`. Without a top-level import or export the file is a script and you can declare `namespace Express` directly — the wrapper is what people usually miss.
- **The file must be inside `tsconfig.json`'s `include`.** It's never imported by anything, so if it falls outside `include` it silently does nothing and every property is an error again.

Mark the properties **optional** (`?`). Middleware sets `correlationId` and a guard sets `user`, so on any given request they may genuinely be absent — and an optional property forces the `?.` that reflects reality.

The same technique types other people's runtime objects. `process.env` is the other one worth doing:

```typescript
declare global {
  namespace NodeJS {
    interface ProcessEnv {
      NODE_ENV: 'development' | 'production' | 'test';
      DATABASE_URL: string;
    }
  }
}
```

With the honest caveat: this is a *claim*, not a check. `process.env.DATABASE_URL` is typed `string` and is `undefined` if nobody set it. The runtime guarantee comes from [article 07](./configuration-and-environment.md#step-3--fail-the-boot-not-the-request)'s boot-time validation; the augmentation only stops you writing `NODE_ENV === 'prod'`.

### Verify the loop

Two checks, both fast:

```bash
# 1. the flags are actually on — everything else here depends on them
node -e "const t=require('./demos/foundations/tsconfig.json');console.log(t)"
#    or just: grep -A2 emitDecoratorMetadata tsconfig.base.json

# 2. the ledger, from the running app
pnpm --filter foundations-demo start   # the probe logs paramtypes at bootstrap
```

And one test that catches the whole class of error before it ships:

```typescript
// src/typescript/erasure.spec.ts
import 'reflect-metadata';
import { CatsController } from '../cats/cats.controller';
import { CatsService } from '../cats/cats.service';
import { PipelineController } from '../pipeline/pipeline.controller';
import { CreateItemDto } from '../pipeline/dto/create-item.dto';

describe('runtime type metadata', () => {
  it('records the service class on the controller constructor', () => {
    expect(Reflect.getMetadata('design:paramtypes', CatsController)).toEqual([CatsService]);
  });

  it('records the DTO class on the body parameter', () => {
    const types: unknown[] | undefined = Reflect.getMetadata(
      'design:paramtypes',
      PipelineController.prototype,
      'createFromDto',
    );
    expect(types?.[0]).toBe(CreateItemDto);
  });
});
```

The first assertion fails the moment someone adds `import type` to the controller. The second fails the moment a DTO becomes an interface. Both are one line, and both catch failures that otherwise produce a *running* application.

## Real-world patterns

**Class at every runtime boundary.** DTOs, entities, injectable providers, abstract-class tokens. `interface` and `type` for shapes that never cross into reflection.

**Value imports for anything Nest resolves; `import type` for the rest.** And use `import type` deliberately to break circular imports rather than reaching for `forwardRef`.

**`as const` objects instead of `enum`.** One declaration yields the literal union, the runtime array, and compatibility with every stripping-based tool.

**`satisfies` for hand-written config, never for input.** It keeps literal types while checking shape. It cannot see runtime data.

**`asserts` at every non-HTTP trust boundary.** Queue payloads, webhook bodies, cache reads. Nest validates HTTP for you and nothing else.

**`assertNever` in every switch over a union you own.** It converts "someone added a variant" from a production surprise into a build failure.

**One augmentation file per third-party global**, inside `include`, with optional properties, and referenced by no one.

**Never type your way past a runtime unknown.** `as`, `satisfies`, and declaration merging are all claims. If the value came from outside the process, something has to *check* it.

## Feature reference

| Feature | Runtime? | Nest cares because |
| --- | --- | --- |
| `class` | yes | the only shape reflection can find |
| `interface` / `type` | **no** | as a DTO it disables validation; as a token it's unresolvable |
| `enum` | yes (object) | not supported by strip-only tooling; prefer `as const` |
| parameter properties | yes (generated) | **not** supported by strip-only tooling |
| `experimentalDecorators` | flag | parameter decorators — required |
| `emitDecoratorMetadata` | flag | `design:paramtypes` — required for DI |
| `import type` | erased | **breaks DI** if applied to an injected class |
| `verbatimModuleSyntax` | flag | would enforce `import type`; incompatible with `module: commonjs` |
| `as const` | narrows | literal unions plus an iterable runtime object |
| `keyof typeof X` | erased | extracts a union from a runtime constant |
| `satisfies` | erased | checks config shape without widening; useless on input |
| `x is T` | erased | makes a runtime check narrow the type |
| `asserts x is T` | erased | narrows everything after the call |
| `never` | erased | exhaustiveness — a missed variant becomes a build error |
| `readonly` | erased | shallow, and does not narrow — not a substitute for `as const` |
| `declare global` merging | erased | types `Request`, `ProcessEnv`, and other foreign runtime objects |

## Common mistakes

**1. An `interface` or `type` as a DTO.** Validation is skipped silently and the endpoint accepts anything. Use a `class`.

**2. `import type` on an injected class.** The reference is erased, `design:paramtypes` records `Object`, and DI fails naming `Object`.

**3. Removing `experimentalDecorators`.** Parameter decorators become syntax errors and metadata emission stops.

**4. Assuming `node file.ts` works.** Measured: parameter properties and `enum` are both unsupported in strip-only mode, and parameter properties are how every Nest service is written.

**5. `enum` in a project that uses stripping-based tooling.** It compiles to a runtime object; it can't be stripped.

**6. Omitting `as const` on a constant map.** Values widen to `string`, so `keyof typeof` extraction yields nothing useful.

**7. Confusing `readonly` with `as const`.** `readonly` is shallow and doesn't narrow. It won't give you literal types.

**8. Expecting `satisfies` to validate API data.** It's compile-time only. Nothing survives into the running program.

**9. A predicate returning `boolean` instead of `x is T`.** The narrowing doesn't stick, and you cast at every use site instead.

**10. An augmentation file outside `include`, or missing `declare global`.** Both fail silently — the properties simply aren't there, and the error points at your read site rather than at the augmentation.

## How this evolved

The two changes that matter both pull away from what Nest needs. **TypeScript 5.0** made standard Stage-3 decorators the default; they support neither parameter decorators nor `emitDecoratorMetadata`, so Nest is pinned to `experimentalDecorators` and will be until it has another way to learn a constructor's parameter types. **Node's built-in type stripping** — on by default in recent versions — deliberately refuses to generate code, which rules out `enum` and parameter properties, the second of which is Nest's dominant idiom.

Meanwhile `satisfies` (5.0), `asserts` predicates (3.7), and `verbatimModuleSyntax` (5.0) each made the type-level work sharper, and `const` type parameters and `NoInfer` (5.4) continued that. The gap between "TypeScript the language is moving on" and "Nest reads types at runtime" is the tension this whole article documents.

Nest 12's ESM move touches every flag here, and its **Standard Schema** support in `@Body()`/`@Query()` would let a runtime schema replace reflected metadata entirely — sidestepping the erasure traps rather than teaching people to avoid them. Re-verify this article at GA.

## Exercises

**1. Read the ledger.** Add the erasure probe to the demo and print `design:paramtypes` for a decorated class with an interface parameter, and for an undecorated class. *Hint: the two answers are different in a way that names two different bugs.*

**2. Break DI with a lint fix.** Add `import type` to a controller's service import, boot the app, and read the error. *Hint: the message names a type you didn't write.*

**3. Make a new variant a build error.** Write a `switch` over an `as const`-derived union with `assertNever` in the default arm, then add a member to the constant. *Hint: the error appears in the switch, not in the constant — which is the point.*

## Summary

- Type erasure is a **runtime** concern in Nest, because the framework reflects on types at bootstrap.
- Erased: `interface`, `type`, annotations, generics, `as`, `satisfies`, predicates, `readonly`, `import type`. Survives: `class`, `enum`, parameter properties, decorators, `const` values.
- `emitDecoratorMetadata` emits `design:paramtypes` **only for decorated declarations**. `undefined` means a missing decorator; `Object` means an erased type.
- `experimentalDecorators` is a **requirement** — standard decorators support neither parameter decorators nor metadata emission.
- Measured: Node's strip-only mode rejects **parameter properties** and **`enum`**, so `node service.ts` cannot run idiomatic Nest code.
- `verbatimModuleSyntax` would enforce `import type` but is **incompatible with `module: commonjs`**, this corpus's baseline.
- `import type` on an injected class **breaks DI**; it's the right tool for breaking circular imports.
- `as const` + `keyof typeof` replaces `enum` with a literal union *and* an iterable runtime object.
- `satisfies` checks hand-written config without widening and does nothing for runtime input; `is` and `asserts` are how you narrow what Nest doesn't validate for you.
- `declare global` merging is how `Request.user` and `Request.correlationId` get typed once instead of cast everywhere.

## See also

- [Providers and dependency injection](./providers-and-di.md) — what `design:paramtypes` becomes
- [Decorators and metadata reflection](./decorators-and-metadata-reflection.md#how-it-works-under-the-hood) — the measured emission behaviour this article summarises
- [Pipes](../request-lifecycle/pipes.md#metatype-is-the-emitted-paramtype-and-thats-the-trap) — `metatype`, and the interface trap
- [DTOs and class-validator](../validation/dtos-and-class-validator.md) — why a DTO must be a class
- [ValidationPipe in depth](../validation/validationpipe-in-depth.md#forbidunknownvalues-is-forced-off) — how the trap becomes a silent bypass
- [Middleware](../request-lifecycle/middleware.md#step-1--a-correlation-id-and-why-it-has-to-be-here) — the request property this article finally types
- [Configuration and environment](./configuration-and-environment.md#step-3--fail-the-boot-not-the-request) — the runtime check behind a `ProcessEnv` augmentation

## References

- [TypeScript Handbook](https://www.typescriptlang.org/docs/handbook/intro.html)
- [TypeScript 5.0 release notes — Decorators](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html) — the standard-decorator limitations Nest is pinned by
- [`satisfies` operator (TypeScript 4.9)](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-4-9.html)
- [Declaration merging](https://www.typescriptlang.org/docs/handbook/declaration-merging.html)
- [Node.js — running TypeScript natively](https://nodejs.org/api/typescript.html) — strip-only mode and its unsupported syntax
- [Nest first steps](https://docs.nestjs.com/first-steps) — the baseline `tsconfig.json` Nest generates

## Demo source

`demos/foundations/` — adds `typescript/` with the erasure probe, the `express.d.ts` augmentation, and the metadata spec.