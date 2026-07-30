---
article_id: decorators-and-metadata-reflection
concept_folder: foundations
wave: 1
nest_baseline: "11.1.x"
node_baseline: "24"
related:
  - foundations/providers-and-di
  - foundations/controllers-and-routing
  - request-lifecycle/guards
  - request-lifecycle/execution-context-and-reflector
  - recipes/di-and-modules/nest-cant-resolve-dependencies
status:
  drafted: true
  reviewed: false
v12_watch: true
---

# Decorators and metadata reflection

> **Lead with this.** A decorator in Nest does almost nothing at runtime. `@Injectable()` doesn't register anything, `@Get('featured')` doesn't create a route, `@Roles('admin')` doesn't check anything. Each one writes a value into a side table keyed by your class or your method, and then something else — the injector, the router explorer, a guard — reads that table later and acts. Decorators are how you *annotate*; the framework is what *behaves*. Once that separation is clear, the two questions worth asking about any Nest decorator become obvious: **what key did it write, and onto what target?** Nearly every "my decorator isn't working" problem is a mismatch in one of those two answers.

## What it is

Three layers stack here, and conflating them is the usual source of confusion.

1. **TypeScript decorators** — the syntax. A decorator is a function called once, when the class is defined, with the decorated thing as an argument.
2. **`emitDecoratorMetadata`** — a compiler option that, for decorated declarations, writes the *design-time types* into the same side table. This is what lets Nest read a constructor's parameter types at runtime even though types are erased.
3. **`reflect-metadata`** — the library providing that side table: `Reflect.defineMetadata` and `Reflect.getMetadata`, keyed by a target object and an optional property key.

Nest sits on all three. Its own decorators are thin wrappers over layer 3; the DI system depends on layer 2; and layer 1's rules — including one that has since changed in TypeScript — constrain what Nest can do at all.

> **If you know Angular.** Angular's compiler reads your decorators **at build time** and erases them, generating code from what it found; that's why AOT exists and why Angular has been steadily reducing decorator reliance (`inject()`, standalone components). Nest reads decorators **at runtime**, through `reflect-metadata`, at the moment `NestFactory.create()` walks your classes. The consequence is practical: metadata must survive compilation into the emitted JavaScript, the `reflect-metadata` polyfill must actually be loaded, and a build tool that strips or reorders decorator emit will break your application in ways the type-checker cannot see.

## How it works under the hood

### There are two decorator systems, and Nest requires the old one

TypeScript shipped decorators years before TC39 standardised them. As of TypeScript 5.0, the **standard (Stage 3)** decorators are the default and need no flag; the older implementation lives behind `experimentalDecorators`. The TypeScript 5.0 release notes are explicit about two limitations of the standard proposal: it is **not compatible with `emitDecoratorMetadata`**, and it **does not allow decorating parameters**.

Nest needs both. `@Inject()`, `@Param()`, `@Body()` are parameter decorators, and constructor injection is built on emitted parameter types. So:

```jsonc
{
  "compilerOptions": {
    "experimentalDecorators": true,   // not legacy cruft — a hard requirement
    "emitDecoratorMetadata": true
  }
}
```

Turning these off, or "modernising" to standard decorators, does not degrade gracefully. Parameter decorators become a syntax error, and any decorator that still compiles loses its type metadata silently.

### What a legacy decorator actually receives

- **Class decorator** → `(constructor)`
- **Method decorator** → `(prototype, propertyKey, descriptor)`
- **Property decorator** → `(prototype, propertyKey)`
- **Parameter decorator** → `(prototype | constructor, propertyKey, parameterIndex)`

Two consequences worth memorising. A parameter decorator cannot change anything — it can only *observe* that a parameter exists at an index, which is why `@Inject()` records `{ index, param }` into an array rather than modifying anything. And a method decorator receives the property descriptor, so `descriptor.value` is the function itself — which is where Nest writes route and metadata keys.

### Evaluation order versus application order

Decorator *expressions* and decorator *functions* run at different times. This transcript is the measured output of a class with decorators on a property, a method, two parameters, the constructor parameter, and the class itself:

```
evaluated: PROP
  applied: PROP
evaluated: METHOD-first
evaluated: METHOD-second
evaluated: PARAM-a
evaluated: PARAM-b
  applied: PARAM-b (index 1)
  applied: PARAM-a (index 0)
  applied: METHOD-second
  applied: METHOD-first
evaluated: CLASS-first
evaluated: CLASS-second
evaluated: CTOR-PARAM
  applied: CTOR-PARAM (index 0)
  applied: CLASS-second
  applied: CLASS-first
```

Read off the rules:

- **Members are decorated before the class.** The class decorator sees a fully decorated prototype — which is exactly why `@Module()` and `@Controller()` can read what their members wrote.
- **Within one declaration, expressions evaluate top-to-bottom, functions apply bottom-to-top.**
- **A method's parameter decorators run before the method decorator that owns them**, and apply right-to-left (index 1 before index 0).
- **Constructor parameter decorators run with the class**, after its decorator expressions are evaluated and before they are applied.

This matters whenever two decorators on the same handler write the same key: the last one applied wins, and that's the *topmost* one.

### What `emitDecoratorMetadata` emits

Three keys, measured on a decorated class:

```
design:paramtypes on class   = [ 'Date' ]
design:type on prop          = String
design:paramtypes on method  = [ 'String', 'Number' ]
design:returntype on method  = Boolean
```

And the two behaviours that produce most of the confusing failures:

```
decorated   paramtypes = [ 'Object', 'Concrete', 'Date', 'Number' ]   // first param was an interface
undecorated paramtypes = undefined
```

- **A type that doesn't exist at runtime becomes `Object`.** Interfaces, type aliases, and anything imported with `import type` all collapse to `Object` — the mechanism behind the unresolvable-`Object` error in [providers and DI](./providers-and-di.md#common-mistakes).
- **A class with no decorator at all emits nothing.** Not `[Object, Object]` — `undefined`. This is a *different* failure from the one above, and the distinction is diagnostic:

| `design:paramtypes` is… | Means |
| --- | --- |
| `undefined` | the class carries no decorator — usually a missing `@Injectable()` |
| contains `Object` | a parameter's type erased — interface, type alias, or `import type` |
| contains the class | fine |

### Where the metadata lives, and that it inherits

`reflect-metadata` keys entries by target object plus optional property key. Lookup walks the prototype chain — measured:

```
getMetadata   on Child (inherited) = base-class
getOwnMetadata on Child            = undefined
method meta via Child.prototype.handle = base-method
```

So a subclass inherits its base class's metadata, and `Reflect.getMetadata` is the reason. Useful when you want a base controller to share `@Roles()`; surprising when a subclass silently inherits an annotation you thought you'd left behind. `getOwnMetadata` is the opt-out.

Note the third line: method metadata is read off **the function**, not off the prototype-plus-key. `Reflect.getMetadata('roles', SomeClass.prototype)` returns nothing useful; `Reflect.getMetadata('roles', SomeClass.prototype.handle)` is the lookup you want.

### Nest's layer on top

`SetMetadata` is the whole public API in eleven lines:

```typescript
// paraphrased from packages/common/decorators/core/set-metadata.decorator.ts
const decoratorFactory = (target, key?, descriptor?) => {
  if (descriptor) {
    Reflect.defineMetadata(metadataKey, metadataValue, descriptor.value);
    return descriptor;
  }
  Reflect.defineMetadata(metadataKey, metadataValue, target);
  return target;
};
decoratorFactory.KEY = metadataKey;
```

Two details do real work. It **branches on whether a descriptor was passed** — method usage writes onto the function, class usage writes onto the class — which is how one decorator works in both positions. And it hangs the key onto the returned function as `.KEY`, so a decorator built this way carries its own lookup key and you never have to export the string separately.

`Reflector` reads it back. `get` is a thin `Reflect.getMetadata`, so prototype inheritance applies. The two composite readers are where the semantics live:

- **`getAllAndOverride(key, targets)`** returns the **first non-`undefined`** value in target order. Called with `[handler, class]`, the handler wins — the behaviour you want for "method-level annotation overrides controller-level."
- **`getAllAndMerge(key, targets)`** concatenates arrays and spreads objects: `{ ...a, ...b }` reducing in target order. For arrays that's intuitive. For **objects it inverts the precedence you probably expect** — with `[handler, class]`, the class value is spread last and therefore *wins* on any colliding key. If you're merging object metadata and want the handler to win, reverse the targets.

Custom parameter decorators go through `createParamDecorator`, which stores into `ROUTE_ARGS_METADATA` on `target.constructor`, keyed by method name, and tags each entry with a generated unique id so two custom param decorators can never collide. It also inspects its own arguments: anything with a `transform` method is treated as a pipe rather than as decorator data.

`applyDecorators` is the least magical thing in the framework — it loops over the decorators you gave it and calls each one, choosing the class or method form based on whether a descriptor is present.

## Basic usage

A metadata decorator, and the two ways to read it.

```typescript
// src/common/roles.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'roles';
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
```

```typescript
// src/catalog/catalog.controller.ts
import { Controller, Delete, Get, Param } from '@nestjs/common';
import { Roles } from '../common/roles.decorator';

@Roles('viewer')            // controller-level default
@Controller('products')
export class CatalogController {
  @Get()
  findAll(): string {
    return 'all products';
  }

  @Roles('admin')           // handler-level override
  @Delete(':id')
  remove(@Param('id') id: string): void {
    // …
  }
}
```

```typescript
// reading it
import { Reflector } from '@nestjs/core';

const reflector = new Reflector();

// handler wins, falls back to the controller
reflector.getAllAndOverride<string[]>(ROLES_KEY, [
  CatalogController.prototype.remove,
  CatalogController,
]);
// => ['admin']

reflector.getAllAndOverride<string[]>(ROLES_KEY, [
  CatalogController.prototype.findAll,
  CatalogController,
]);
// => ['viewer']
```

In real code the two targets come from an `ExecutionContext` rather than being written out by hand — that's [guards](../request-lifecycle/guards.md) and [execution context](../request-lifecycle/execution-context-and-reflector.md). The mechanism is identical either way.

## Walkthrough — building a small decorator toolkit

We add `src/common/` to `demos/foundations`. Each step is a decorator you'd plausibly write, and each exposes a different part of the machinery.

### Step 1 — the stringly-typed starting point

```typescript
// ✗ workable, and fragile
import { SetMetadata } from '@nestjs/common';

export const Roles = (...roles: string[]) => SetMetadata('roles', roles);
```

The key `'roles'` is a bare string typed nowhere. A second library that also writes `'roles'` silently overwrites yours — last decorator applied wins, and you saw above that "last applied" means the topmost decorator, which is not where most people look. The value's type is `any` at the read site, so `getAllAndOverride('roles', …)` will happily hand you a `string` where you expected `string[]`.

### Step 2 — a key constant, and the `.KEY` shortcut

```typescript
// src/common/roles.decorator.ts
import { SetMetadata } from '@nestjs/common';

export const ROLES_KEY = 'catalog:roles';   // namespaced — collisions are silent
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);
```

Because `SetMetadata` attaches the key to the decorator it returns, you can skip exporting the constant at all:

```typescript
export const Roles = (...roles: string[]) => SetMetadata('catalog:roles', roles);

// at the read site — no separate import of the key
reflector.getAllAndOverride<string[]>(Roles().KEY, [handler, controller]);
```

That works but reads badly, because `Roles` is a *factory* — you have to call it to get at `.KEY`. Which is the exact problem the next step solves.

### Step 3 — a typed reflectable decorator

`Reflector.createDecorator` produces a decorator that carries both its key and its value type:

```typescript
// src/common/roles.decorator.ts
import { Reflector } from '@nestjs/core';

export const Roles = Reflector.createDecorator<string[]>();
```

```typescript
// usage is unchanged in shape, but now type-checked
@Roles(['admin'])
@Delete(':id')
remove(@Param('id') id: string): void {}
```

```typescript
// and the read site needs no string at all
const roles = reflector.getAllAndOverride(Roles, [handler, controller]);
//    ^? string[]
```

**The trade-off, since this looks strictly better.** The value is now a single argument rather than variadic — `@Roles(['admin'])`, not `@Roles('admin')` — which is uglier at every call site. The key becomes an opaque generated value, so anything reading your metadata from outside (another library, a debugging script, a `Reflect.getMetadata` call in a test) can no longer guess it. And it ties the decorator to `@nestjs/core`, where `SetMetadata` only needs `@nestjs/common`. Use `createDecorator` for application code where you own both ends; use a namespaced `SetMetadata` key for anything a third party might need to read.

### Step 4 — reading it, and the merge trap

Both composite readers are one call:

```typescript
// override: first non-undefined wins → handler beats controller
const roles = reflector.getAllAndOverride(Roles, [handler, controller]);

// merge: arrays concatenate → handler roles AND controller roles
const allRoles = reflector.getAllAndMerge(Roles, [handler, controller]);
```

Array metadata merges the way you'd guess. **Object metadata does not.** `getAllAndMerge` reduces with `{ ...a, ...b }` in target order, so with `[handler, controller]` the *controller's* value is spread last and wins every colliding key:

```typescript
// const RateLimit = Reflector.createDecorator<{ limit: number; window?: number }>();
//
// @RateLimit({ limit: 100, window: 60 }) on the controller
// @RateLimit({ limit: 10 })              on the handler

reflector.getAllAndMerge(RateLimit, [handler, controller]);
// => { limit: 100, window: 60 }   ← the handler's limit: 10 was overwritten
```

If you want handler-wins semantics for object metadata, reverse the targets — `[controller, handler]` — or use `getAllAndOverride` and merge yourself. This is the kind of bug that ships, because the array case behaves correctly and nobody re-tests with objects.

### Step 5 — a custom parameter decorator, and composing

Parameter decorators built with `createParamDecorator` receive the decorator's own argument and the execution context, and return whatever the handler should be given:

```typescript
// src/common/tenant.decorator.ts
import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Request } from 'express';

export const Tenant = createParamDecorator(
  (data: unknown, ctx: ExecutionContext): string => {
    const request = ctx.switchToHttp().getRequest<Request>();
    return (request.headers['x-tenant-id'] as string) ?? 'public';
  },
);
```

```typescript
@Get()
findAll(@Tenant() tenant: string): string {
  return `products for ${tenant}`;
}
```

The factory runs **per request**, unlike the metadata decorators above which run once at class definition. That difference catches people out: a `createParamDecorator` factory doing expensive work does it on every call.

When several decorators always travel together, `applyDecorators` bundles them:

```typescript
// src/common/admin-only.decorator.ts
import { applyDecorators } from '@nestjs/common';
import { Roles } from './roles.decorator';

export const AdminOnly = () => applyDecorators(Roles(['admin']));
// later: applyDecorators(Roles(['admin']), UseGuards(RolesGuard), ApiBearerAuth())
```

### Verify the loop

Metadata is directly observable, so a unit test needs no HTTP and no bootstrap. This assumes the Step 3 decorator, so the controller's annotations read `@Roles(['viewer'])` and `@Roles(['admin'])`:

```typescript
// src/common/roles.decorator.spec.ts
import { Reflector } from '@nestjs/core';
import { CatalogController } from '../catalog/catalog.controller';
import { Roles } from './roles.decorator';

describe('Roles metadata', () => {
  const reflector = new Reflector();

  it('lets a handler override the controller', () => {
    expect(
      reflector.getAllAndOverride(Roles, [
        CatalogController.prototype.remove,
        CatalogController,
      ]),
    ).toEqual(['admin']);
  });

  it('falls back to the controller when the handler has none', () => {
    expect(
      reflector.getAllAndOverride(Roles, [
        CatalogController.prototype.findAll,
        CatalogController,
      ]),
    ).toEqual(['viewer']);
  });
});
```

And when a decorator "isn't working", the fastest diagnostic is to ask the side table directly:

```typescript
console.log(Reflect.getMetadataKeys(CatalogController.prototype.remove));
console.log(Reflect.getMetadataKeys(CatalogController));
```

That prints every key written onto the handler and onto the class. If your key isn't in either list, the decorator never ran or wrote to a different target — which narrows the problem to two lines of code.

## Real-world patterns

**Namespace metadata keys.** `'catalog:roles'`, not `'roles'`. Collisions are silent and the loser is whichever decorator was applied first.

**One decorator, one key.** A decorator that writes three keys is three decorators wearing a trench coat; compose them with `applyDecorators` instead, so each can be read and tested alone.

**Put the read in a guard or interceptor, not in the handler.** A handler that reads its own metadata has re-implemented the framework badly. The read belongs where the cross-cutting decision is made.

**Prefer `getAllAndOverride` for policy, `getAllAndMerge` for accumulation.** "Which role is required here" is override. "Every tag on this route" is merge. Choosing merge for policy is how a handler ends up accidentally permitting the union of everything.

**Don't reach for a decorator when a parameter would do.** Decorators are for cross-cutting annotation read by framework machinery. If only one function ever reads it, it's an argument.

**Watch the build tool.** Anything that recompiles TypeScript — SWC, esbuild, Rspack — must be configured for legacy decorators *and* metadata emit. SWC needs both `decorators: true` and `decoratorMetadata: true`; miss the second and the app compiles and then fails to resolve every dependency at boot.

## API reference

| Symbol | Import | Purpose |
| --- | --- | --- |
| `SetMetadata(key, value)` | `@nestjs/common` | writes metadata; works on classes and methods; result carries `.KEY` |
| `Reflector.createDecorator<T>()` | `@nestjs/core` | typed metadata decorator with a generated key |
| `reflector.get(key, target)` | `@nestjs/core` | single target; inherits through the prototype chain |
| `reflector.getAll(key, targets)` | `@nestjs/core` | one value per target, in order |
| `reflector.getAllAndOverride(key, targets)` | `@nestjs/core` | first non-`undefined` value |
| `reflector.getAllAndMerge(key, targets)` | `@nestjs/core` | concatenates arrays; spreads objects **later-target-wins** |
| `createParamDecorator(factory)` | `@nestjs/common` | custom parameter decorator; factory runs per request |
| `applyDecorators(...decorators)` | `@nestjs/common` | bundles several decorators into one |
| `Reflect.getMetadata(key, target[, prop])` | `reflect-metadata` | raw read; walks the prototype chain |
| `Reflect.getOwnMetadata(key, target[, prop])` | `reflect-metadata` | raw read; no inheritance |
| `Reflect.getMetadataKeys(target)` | `reflect-metadata` | every key on a target — the debugging tool |
| `design:type` `design:paramtypes` `design:returntype` | emitted | the compiler's type metadata |

## Common mistakes

**1. "Modernising" to standard decorators.** Removing `experimentalDecorators` is not a cleanup. Parameter decorators become syntax errors and metadata emission stops.

**2. `emitDecoratorMetadata` missing.** The app compiles, then fails to resolve every constructor dependency at once. Whole-app failure points at tsconfig, not at your modules.

**3. Expecting metadata from an undecorated class.** No decorator means no `design:paramtypes` at all — `undefined`, not an array of `Object`. Add `@Injectable()`.

**4. Injecting an erased type.** Interfaces, type aliases, and `import type` all become `Object`. Use a token.

**5. Reading method metadata off the prototype.** `Reflect.getMetadata(key, Ctrl.prototype)` finds nothing; the target is `Ctrl.prototype.handle`, the function itself.

**6. Bare string keys.** `'roles'` will collide eventually, silently, and the decorator applied *last* — the topmost one — wins.

**7. Being surprised by inheritance.** `Reflect.getMetadata` walks the prototype chain, so subclasses inherit base-class annotations. If you meant "only if declared here", use `getOwnMetadata`.

**8. `getAllAndMerge` with object metadata.** The later target overwrites the earlier on colliding keys, so `[handler, controller]` lets the controller win — the opposite of `getAllAndOverride`.

**9. Forgetting to call the factory.**

```typescript
@Roles         // ✗ passes the factory itself as the decorator
@Roles('admin') // ✓
```

The first form usually fails with an unhelpful runtime error about arguments.

**10. Expensive work in a `createParamDecorator` factory.** It runs on every request, not once at boot. Cache outside the factory or move the work to a provider.

## How this evolved

The decorator landscape moved and Nest deliberately did not. TypeScript 5.0 made the standard Stage-3 decorators the default, leaving the older implementation behind `experimentalDecorators`. The standard proposal doesn't support `emitDecoratorMetadata` and doesn't allow parameter decorators, and Nest's DI depends on both — so `experimentalDecorators: true` in a Nest `tsconfig.json` is a current requirement rather than legacy baggage. TypeScript 5.2 added a metadata channel for standard decorators via `Symbol.metadata` and `context.metadata`, but it is manual: nothing writes parameter types for you.

This is the article most exposed to Nest 12's move to ESM, since decorator emit and module format interact. The mechanics described here are all v11.1.28 behaviour, measured; re-verify the emit details after that release.

## Exercises

**1. Reproduce the ordering transcript.** Write a class with decorators on a property, a method, two method parameters, a constructor parameter, and the class, each logging on evaluation and on application. Predict the output before running it. *Hint: most people get the parameter direction wrong — they apply right-to-left.*

**2. Diagnose by metadata.** Take a provider that fails with an unresolvable dependency and, before reading any module file, print `Reflect.getMetadata('design:paramtypes', TheClass)`. Work out from the three-row table above which of the two failure modes you have. *Hint: `undefined` and `[Object]` mean different bugs with different fixes.*

**3. Break the merge.** Build a decorator whose value is an object, apply it at both controller and handler level with one overlapping key, and observe which wins under `getAllAndMerge`. Then make the handler win. *Hint: you don't need to change the decorator.*

## Summary

- Decorators annotate; the framework behaves. The only two questions are **what key** and **onto what target**.
- Nest requires `experimentalDecorators` — the standard Stage-3 decorators support neither `emitDecoratorMetadata` nor parameter decorators.
- Members are decorated before the class; expressions evaluate top-down and apply bottom-up; parameter decorators run before their method's.
- `emitDecoratorMetadata` writes `design:type`, `design:paramtypes`, `design:returntype` — but only for declarations that carry a decorator. No decorator means no metadata at all, which is a different bug from an erased type showing up as `Object`.
- `SetMetadata` writes onto `descriptor.value` for methods and onto the class otherwise, and exposes its key as `.KEY`.
- `Reflect.getMetadata` inherits through the prototype chain; `getOwnMetadata` doesn't.
- `getAllAndOverride` takes the first non-`undefined`; `getAllAndMerge` concatenates arrays but spreads objects later-target-wins, inverting the precedence you probably want.

## See also

- [Providers and dependency injection](./providers-and-di.md) — how `design:paramtypes` becomes a resolved dependency
- [Controllers and routing](./controllers-and-routing.md) — route metadata written onto the handler function
- [Guards](../request-lifecycle/guards.md) — the usual consumer of `@Roles()`-style metadata
- [Execution context and Reflector](../request-lifecycle/execution-context-and-reflector.md) — where `[handler, class]` targets come from
- [Recipe: "Nest can't resolve dependencies of…"](../recipes/di-and-modules/nest-cant-resolve-dependencies.md)

## References

- [Custom decorators](https://docs.nestjs.com/custom-decorators) — official docs
- [Execution context — reflection and metadata](https://docs.nestjs.com/fundamentals/execution-context) — official docs
- [TypeScript 5.0 release notes — Decorators](https://www.typescriptlang.org/docs/handbook/release-notes/typescript-5-0.html) — Stage-3 decorators, and the `emitDecoratorMetadata` / parameter-decorator limitations
- [TypeScript handbook — Decorators (legacy)](https://www.typescriptlang.org/docs/handbook/decorators.html) — the experimental implementation Nest uses
- [`packages/common/decorators/core/set-metadata.decorator.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/common/decorators/core/set-metadata.decorator.ts)
- [`packages/core/services/reflector.service.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/services/reflector.service.ts) — `getAllAndOverride` and `getAllAndMerge` semantics
- [`packages/common/decorators/http/create-route-param-metadata.decorator.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/common/decorators/http/create-route-param-metadata.decorator.ts)

## Demo source

`demos/foundations/` — adds `common/` with the roles and tenant decorators.