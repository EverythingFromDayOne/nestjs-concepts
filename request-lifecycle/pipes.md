---
article_id: pipes
concept_folder: request-lifecycle
wave: 1
nest_baseline: "11.1.x"
node_baseline: "24"
related:
  - request-lifecycle/execution-order
  - request-lifecycle/guards
  - foundations/decorators-and-metadata-reflection
  - validation/dtos-and-class-validator
  - validation/validationpipe-in-depth
  - recipes/validation/dto-silently-not-validated
status:
  drafted: true
  reviewed: false
v12_watch: true
---

# Pipes

> **Lead with this.** A pipe is the only layer that sees **one argument** rather than the request, and it runs **once per decorated parameter** — with all of a handler's parameters processed concurrently. That already makes two things true that people don't expect: pipes compose within a parameter but race across them, and a stateful pipe is a bug. But the fact worth the whole article is this. What a pipe knows about an argument's type comes from `design:paramtypes`, so a type that doesn't exist at runtime leaves `metatype` as `Object` — and `ValidationPipe` **skips** `Object`. A handler written `@Body() dto: CreateOrderDto` where `CreateOrderDto` is an `interface` has **no validation at all**, no warning, and no error. It just accepts anything.

## What it is

One method, and a description of the argument it received:

```typescript
@Injectable()
export class TrimPipe implements PipeTransform<unknown, unknown> {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    return typeof value === 'string' ? value.trim() : value;
  }
}
```

`ArgumentMetadata` is the second parameter and the interesting one:

| Field | Is |
| --- | --- |
| `type` | `'body' \| 'query' \| 'param' \| 'custom'` — which decorator produced the value |
| `metatype` | the parameter's runtime type, from `design:paramtypes` — or `undefined` |
| `data` | the decorator's argument, e.g. `'id'` in `@Param('id')` |

Pipes do two jobs: **transform** (a string becomes a number, a payload becomes a DTO instance) and **validate** (reject and throw). `@nestjs/common` ships **ten**, enumerated from `packages/common/pipes/index.ts` @ v11.1.28 so the list is complete rather than remembered: `ValidationPipe`, `ParseIntPipe`, `ParseFloatPipe`, `ParseBoolPipe`, `ParseArrayPipe`, `ParseUUIDPipe`, `ParseEnumPipe`, `ParseDatePipe`, `DefaultValuePipe`, and `ParseFilePipe`. `ValidationPipe`'s configuration belongs to [article 17](../validation/validationpipe-in-depth.md).

`ParseFilePipe` is the odd one out and worth flagging early: it doesn't coerce a scalar, it validates an **uploaded file object** against a list of `FileValidator`s. It only makes sense alongside `FileInterceptor`, so §API reference records the surface and the walkthrough leaves it alone.

Four binding levels, one more than the other enhancers: global, controller, route, and **parameter**.

> **If you know Angular.** Nest reuses the word for something narrower. An Angular pipe is a display transform inside a template — `{{ date | date:'short' }}` — pure, synchronous, and running on data you already own. A Nest pipe sits on the **untrusted edge**: its job is to turn caller-supplied input into something the handler may safely assume is correct, and it can reject the request. The closer Angular analogue is a `Validators` function on a reactive form control, and even that is only advisory — the API still has to check. Two habits to drop: pipes here are per-argument rather than per-template-expression, and "pure and synchronous" isn't guaranteed — a pipe may be async, which has costs §Step 5 gets to.

## How it works under the hood

### Within one parameter, pipes compose left to right

```typescript
// paraphrased from packages/core/pipes/pipes-consumer.ts
public async applyPipes(value, { metatype, type, data }, transforms) {
  return transforms.reduce(async (deferredValue, pipe) => {
    const val = await deferredValue;
    return pipe.transform(val, { metatype, type, data });
  }, Promise.resolve(value));
}
```

A `reduce` over an awaited chain: each pipe receives the **previous pipe's output**. That's why `DefaultValuePipe` has to come before `ParseIntPipe` — the default has to exist before something tries to parse it — and why the same `ArgumentMetadata` is handed to every pipe in the chain regardless of what the value has become.

### Across parameters, pipes run concurrently

```typescript
// paraphrased from packages/core/router/router-execution-context.ts — createPipesFn
const resolveParamValue = async (param) => {
  const { index, extractValue, type, data, metatype, pipes: paramPipes } = param;
  const value = extractValue(req, res, next);

  args[index] = this.isPipeable(type)
    ? await this.getParamValue(value, { metatype, type, data }, pipes.concat(paramPipes))
    : value;
};
await Promise.all(paramsOptions.map(resolveParamValue));
return paramsOptions.length ? pipesFn : null;
```

Four things:

- **`Promise.all` over the parameters.** A handler with three decorated parameters runs three independent pipe chains, in parallel. So a pipe instance shared across parameters — a global `ValidationPipe` is shared across every parameter of every handler — must be stateless. Holding per-call state on `this` is a race, not a subtle one.
- **First rejection wins.** With two invalid parameters, which error the client sees depends on which chain rejects first. Don't build error messages that assume a parameter order.
- **`pipes.concat(paramPipes)`** — global, then controller, then route (the shared ordering from [article 09](./execution-order.md#how-it-works-under-the-hood)), and **parameter-level pipes last**. So `@Param('id', ParseIntPipe)` runs *after* a global `ValidationPipe` saw the same argument as a raw string.
- **No decorated parameters means no pipe phase.** `pipesFn` is `null`, and `isPipeable(type)` also excludes arguments like `@Res()` and `@Next()` — a pipe attached to those never runs.

### `metatype` is the emitted paramtype, and that's the trap

`metatype` comes from the `design:paramtypes` array [article 04](../foundations/decorators-and-metadata-reflection.md#how-it-works-under-the-hood) measured. Now look at what `ValidationPipe` does with it:

```typescript
// paraphrased from packages/common/pipes/validation.pipe.ts
public async transform(value: any, metadata: ArgumentMetadata) {
  const metatype = metadata.metatype;
  if (!metatype || !this.toValidate(metadata)) {
    return value;                                   // ← untouched, no error
  }
  // …class-transformer, class-validator…
}

protected toValidate(metadata: ArgumentMetadata): boolean {
  const { metatype } = metadata;
  const types = [String, Boolean, Number, Array, Object /* … */];
  return !types.some(t => metatype === t) && !isNil(metatype);
}
```

`Object` is in the exclusion list. Combine that with article 04's measurement — **an interface or type alias erases to `Object`** — and you get a silent bypass:

```typescript
export interface CreateOrderDto { productId: string; quantity: number; }

@Post()
create(@Body() dto: CreateOrderDto) {}      // ✗ metatype is Object → ValidationPipe returns early
```

No decorators to run, nothing to validate against, and `return value` rather than a throw. The handler receives whatever JSON the caller sent. `whitelist: true` doesn't strip anything either, because the pipe exited before that. This is the highest-severity silent failure in the corpus so far, and its fix is one keyword: `class`.

### Errors from pipes land inside the interceptor chain

Because pipes run inside `next.handle()` ([article 12](./interceptors.md#how-it-works-under-the-hood)), a pipe's throw is visible to an interceptor's `catchError` and is then formatted by a [filter](./exception-filters.md). That's the opposite of a guard rejection, which happens before any interceptor exists. Practically: validation failures *can* be logged by your error-logging interceptor; authorization failures can't.

## Minimal shapes

```typescript
// built-in, parameter level, as a class (DI-capable)
@Get(':id')
findOne(@Param('id', ParseIntPipe) id: number) {}

// built-in, as an instance (configurable, no DI)
@Get(':id')
findOne(@Param('id', new ParseIntPipe({ errorHttpStatusCode: HttpStatus.NOT_ACCEPTABLE })) id: number) {}

// chained — order is left to right
@Get()
list(@Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number) {}

// route level, applying to every parameter of the handler
@UsePipes(new ValidationPipe({ whitelist: true }))
@Post()
create(@Body() dto: CreateOrderDto) {}

// global, with DI
providers: [{ provide: APP_PIPE, useClass: ValidationPipe }]
```

## Walkthrough — from a string to a guarantee

We extend the `pipeline/` module from articles 09–12.

### Step 1 — the string that claims to be a number

[Article 03](../foundations/controllers-and-routing.md#common-mistakes) established that a route parameter is always a string and the type annotation is a claim, not a conversion:

```typescript
@Get('items/:id')
findOne(@Param('id') id: number): string {
  return `${typeof id} ${id + 1}`;      // "string 11" for /items/1
}
```

`id + 1` concatenates. The annotation lied and nothing checked it.

```typescript
@Get('items/:id')
findOne(@Param('id', ParseIntPipe) id: number): string {
  return `${typeof id} ${id + 1}`;      // "number 2"
}
```

```bash
curl localhost:3000/pipeline/items/1     # number 2
curl -i localhost:3000/pipeline/items/x  # 400, "Validation failed (numeric string is expected)"
```

That 400 is the pipe throwing, and it's the point: the handler now has a guarantee rather than a hope.

### Step 2 — chaining, and why order isn't stylistic

```typescript
// ✓ default first, then parse
@Get('items')
list(@Query('page', new DefaultValuePipe(1), ParseIntPipe) page: number): number {
  return page;
}
```

```typescript
// ✗ parse first, then default
@Get('items')
list(@Query('page', ParseIntPipe, new DefaultValuePipe(1)) page: number): number {
  return page;
}
```

The second form fails on `/items` with no query string: `ParseIntPipe` receives `undefined` and throws before `DefaultValuePipe` ever gets a turn. The `reduce` in `applyPipes` hands each pipe the previous one's output, so the chain is a pipeline in the Unix sense — and `DefaultValuePipe` is `?? default`, which has to happen upstream of parsing.

### Step 3 — a custom pipe, using the metadata

The metadata is what lets one pipe serve different arguments:

```typescript
// src/pipeline/trim.pipe.ts
import { ArgumentMetadata, BadRequestException, Injectable, PipeTransform } from '@nestjs/common';

@Injectable()
export class TrimPipe implements PipeTransform<unknown, unknown> {
  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    if (metadata.type === 'param' || metadata.type === 'query') {
      if (typeof value !== 'string') {
        return value;
      }
      const trimmed = value.trim();
      if (trimmed.length === 0) {
        throw new BadRequestException(`${metadata.data ?? 'value'} must not be blank`);
      }
      return trimmed;
    }
    return value;                        // leave bodies alone
  }
}
```

`metadata.data` is the decorator's argument — `'id'` for `@Param('id')` — which is how the message names the offending field without the pipe being told twice. `metadata.type` is how one pipe can behave differently for a query string and a body.

**Two things a pipe cannot do**, both worth knowing before you reach for one:

- **See the request.** It gets one argument. Cross-field validation across a body and a header needs the body to carry both, or belongs in the handler.
- **See the response.** That's an [interceptor](./interceptors.md).

### Step 4 — the interface trap, demonstrated

```typescript
// src/pipeline/dto/create-item.interface.ts
export interface CreateItemInterface {
  name: string;
  quantity: number;
}
```

```typescript
@Post('items')
create(@Body() dto: CreateItemInterface): CreateItemInterface {
  return dto;
}
```

With a global `ValidationPipe({ whitelist: true })` registered:

```bash
curl -X POST localhost:3000/pipeline/items \
  -H 'content-type: application/json' \
  -d '{"name":"","quantity":"not-a-number","injected":"surprise"}'
```

The response echoes the payload **including `injected`**, with `quantity` still a string and `name` still empty. No 400. No log line. `whitelist` didn't strip anything. The pipe saw `metatype === Object` and returned early.

The fix is a class with decorators — the subject of [article 16](../validation/dtos-and-class-validator.md), reduced here to the minimum that proves the mechanism:

```typescript
// src/pipeline/dto/create-item.dto.ts
import { IsInt, IsString, Min, MinLength } from 'class-validator';

export class CreateItemDto {
  @IsString()
  @MinLength(1)
  name!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}
```

Same request now returns 400, and a valid request arrives with `injected` stripped.

One caveat on what you'll actually see: the **status** is the pipe's, but the **body shape** belongs to whichever [filter](./exception-filters.md) handles the `BadRequestException`. Bind a controller-level filter and the class-validator detail array is replaced by that filter's format — measured, and confusing if you're checking for the violation list rather than the status.

**Why this is worth being loud about:** every other mistake in this article produces an error. This one produces a success. A codebase can run for months with `@Body() dto: SomeInterface` on a write endpoint and look completely healthy — and a `type` alias behaves identically, which matters because "use a type, not an interface" is common style advice that silently disables validation here.

The mechanical tell, from article 04's diagnostic table: print `Reflect.getMetadata('design:paramtypes', Controller.prototype, 'create')`. If you see `[Object]` where you expected `[CreateItemDto]`, you've found it.

### Step 5 — concurrency, and the cost of I/O

Because parameters resolve under `Promise.all`, a pipe holding state across calls corrupts:

```typescript
// ✗ shared instance, per-call state
import { ArgumentMetadata, Injectable, PipeTransform } from '@nestjs/common';

@Injectable()
export class BrokenPipe implements PipeTransform {
  private lastType?: string;                     // ← races across parameters

  transform(value: unknown, metadata: ArgumentMetadata): unknown {
    this.lastType = metadata.type;
    return value;
  }
}
```

Keep pipes pure: input and metadata in, value out, nothing on `this` but injected dependencies.

The related trap is I/O:

```typescript
// ✗ tempting, and wrong on three counts
import { Injectable, NotFoundException, PipeTransform } from '@nestjs/common';
import { ItemsService } from './items.service';

@Injectable()
export class ItemExistsPipe implements PipeTransform {
  constructor(private readonly items: ItemsService) {}

  async transform(value: string): Promise<string> {
    if (!(await this.items.exists(value))) {
      throw new NotFoundException(`No item ${value}`);
    }
    return value;
  }
}
```

It works, and it's the wrong shape: the handler will query the same row again (so you've paid twice), the check and the use are separated by a gap in which the row can vanish, and the pipe now needs a database in every unit test that touches the handler. Existence is the handler's problem; a pipe's job is *shape*.

Where a lookup in a pipe is defensible is when the pipe **returns the entity** so nobody queries twice — the "resolve the id to the thing" pattern. Even then it costs testability, and it hides a query behind a parameter annotation.

### Verify the loop

Pipes are the easiest layer to unit-test, because `transform` is a function:

```typescript
// src/pipeline/trim.pipe.spec.ts
import { ArgumentMetadata } from '@nestjs/common';
import { TrimPipe } from './trim.pipe';

const meta = (type: ArgumentMetadata['type'], data?: string): ArgumentMetadata =>
  ({ type, data, metatype: String });

describe('TrimPipe', () => {
  const pipe = new TrimPipe();

  it('trims query strings', () => {
    expect(pipe.transform('  a  ', meta('query', 'q'))).toBe('a');
  });

  it('names the field when blank', () => {
    expect(() => pipe.transform('   ', meta('param', 'id'))).toThrow(/id/);
  });

  it('leaves bodies untouched', () => {
    const body = { name: '  a  ' };
    expect(pipe.transform(body, meta('body'))).toBe(body);
  });
});
```

Then confirm the trap with a real request, because a unit test can't reproduce it — the bug lives in what the compiler *didn't* emit:

```bash
# with @Body() dto: CreateItemInterface — expect 201 and the extra field echoed
curl -X POST localhost:3000/pipeline/items -H 'content-type: application/json' \
  -d '{"name":"","quantity":"x","injected":"surprise"}'

# with @Body() dto: CreateItemDto — expect 400 and `injected` gone on a valid payload
```

## Real-world patterns

**One global `ValidationPipe`, configured once.** Per-route pipes for the exceptions. Options belong to [article 17](../validation/validationpipe-in-depth.md); what matters here is that global means every parameter of every handler shares the instance, so it must be stateless.

**Classes for DTOs, always.** Not interfaces, not type aliases. This is the load-bearing rule of the layer.

**Built-ins over custom pipes for coercion.** `ParseIntPipe`, `ParseUUIDPipe`, `ParseEnumPipe` cover most parameter work and produce consistent error messages.

**`DefaultValuePipe` first in any chain.** Downstream parsers assume a value exists.

**Keep pipes pure and synchronous where possible.** No `this` state, no I/O. A pure pipe is trivially testable and can't race.

**Prefer a class ref to an instance when the pipe needs DI**; use an instance when it needs options. `@Param('id', ParseIntPipe)` versus `@Param('id', new ParseIntPipe({ … }))`.

**Don't validate authorization-relevant input in a pipe and re-read it in a guard.** The guard already ran, and it saw the raw value — see [guards](./guards.md#step-4--the-raw-body-trap).

**Cross-field rules belong on the DTO**, via a class-validator custom constraint, not spread across pipes that each see one field.

## API reference

| Symbol | Import | Purpose |
| --- | --- | --- |
| `PipeTransform<T, R>` | `@nestjs/common` | `transform(value, metadata)` |
| `ArgumentMetadata` | `@nestjs/common` | `{ type, metatype, data }` |
| `@UsePipes(...)` | `@nestjs/common` | controller or method binding |
| `APP_PIPE` | `@nestjs/core` | global binding with DI |
| `app.useGlobalPipes(...)` | — | global binding without DI |
| `@Param('id', Pipe)` | `@nestjs/common` | parameter-level binding — runs **last** |
| `ValidationPipe` | `@nestjs/common` | class-validator integration; skips native metatypes |
| `ParseIntPipe` `ParseFloatPipe` `ParseBoolPipe` | `@nestjs/common` | primitive coercion |
| `ParseArrayPipe` | `@nestjs/common` | comma-separated or repeated values, with `items` |
| `ParseUUIDPipe` `ParseEnumPipe` | `@nestjs/common` | format and membership checks |
| `ParseDatePipe` | `@nestjs/common` | string → `Date`; `optional` and `default` options |
| `DefaultValuePipe` | `@nestjs/common` | substitute a value for `undefined`/`null` — put it first |
| `ParseFilePipe` | `@nestjs/common` | validates an **uploaded file**, not a scalar; takes `validators`, `fileIsRequired`, `errorHttpStatusCode` |
| `ParseFilePipeBuilder` | `@nestjs/common` | fluent construction: `.addMaxSizeValidator().addFileTypeValidator().build()` |
| `MaxFileSizeValidator` `FileTypeValidator` | `@nestjs/common` | the two built-in `FileValidator`s; implement the interface for your own |

## Common mistakes

**1. An `interface` or `type` as a DTO.** `metatype` becomes `Object`, `ValidationPipe` returns early, and the endpoint accepts anything with no error. Use a `class`.

**2. Assuming a pipe runs once per request.** It runs once per decorated parameter, and the chains run concurrently.

**3. State on `this` in a pipe.** The global instance is shared across every parameter of every handler. Guaranteed race.

**4. `DefaultValuePipe` after a parser.** The parser sees `undefined` and throws first.

**5. Expecting parameter-level pipes to run before global ones.** `pipes.concat(paramPipes)` — global, controller, route, then parameter.

**6. Depending on which invalid parameter reports first.** `Promise.all`, so it's whichever rejects first.

**7. Expecting a pipe to see the whole request.** One argument, plus metadata. Nothing else.

**8. A pipe on `@Res()` or `@Next()`.** `isPipeable(type)` excludes them; the pipe never runs.

**9. Existence checks in a pipe.** Duplicate query, a race between check and use, and a database in every handler test. Unless the pipe returns the entity, leave it to the handler.

**10. `useGlobalPipes(new ValidationPipe())` when the pipe needs DI.** Constructed outside the container. Use `APP_PIPE`.

## How this evolved

The `transform(value, metadata)` contract is unchanged, and the built-in set has grown steadily — `ParseArrayPipe`, `ParseUUIDPipe`, `ParseEnumPipe`, and configurable error statuses on the parsers arrived after the originals. The part that hasn't changed is the `toValidate` exclusion list, which is why the interface trap has been silently costing people validation for years.

This is also the layer with the largest known change ahead. Nest 12 adds **Standard Schema** support to `@Body()` and `@Query()`, so a Zod or Valibot schema can validate an argument without a `class-validator` DTO or a `ValidationPipe` at all — an addition rather than a replacement, per the release notes, with `class-validator` staying the documented default. That would also sidestep the `metatype` problem entirely, since a schema is a runtime value rather than an erased type. Re-verify this section after GA.

## Exercises

**1. Make the compiler's silence visible.** Write a handler with `@Body() dto: SomeInterface`, post a payload with an extra field and a wrong type, and confirm the 201. Then print `design:paramtypes` for that method. *Hint: what you're looking for is a single word in the output.*

**2. Break the chain.** Put `DefaultValuePipe` after `ParseIntPipe` on a query parameter and request the route without that parameter. *Hint: read `applyPipes` before predicting the error.*

**3. Race two parameters.** Give a handler two parameters, both invalid, and see which error the client gets. Run it twenty times. *Hint: if it's stable, add an `await` to one of the pipes.*

## Summary

- A pipe sees **one argument** plus `ArgumentMetadata`, never the request.
- Within a parameter, pipes **compose left to right** via an awaited `reduce` — so `DefaultValuePipe` goes first.
- Across parameters, chains run **concurrently** under `Promise.all` — so pipes must be stateless, and the first rejection wins.
- Binding order is global → controller → route → **parameter**; parameter-level pipes run last.
- `metatype` comes from `design:paramtypes`. `ValidationPipe` **skips** `Object` and other native types, so an `interface` or `type` DTO disables validation **silently**.
- No decorated parameters means no pipe phase at all; `@Res()`-style arguments are never piped.
- Pipe errors land inside the interceptor chain, so they're catchable by interceptors — unlike guard rejections.

## See also

- [Execution order](./execution-order.md#how-it-works-under-the-hood) — why pipes run inside the interceptor chain
- [Guards](./guards.md#step-4--the-raw-body-trap) — the layer that saw this input before any pipe touched it
- [Interceptors](./interceptors.md#how-it-works-under-the-hood) — what wraps the pipe phase
- [Decorators and metadata reflection](../foundations/decorators-and-metadata-reflection.md#how-it-works-under-the-hood) — where `metatype` comes from, and why it can be `Object`
- [DTOs and class-validator](../validation/dtos-and-class-validator.md) — the classes pipes validate against
- [ValidationPipe in depth](../validation/validationpipe-in-depth.md) — `whitelist`, `transform`, and the rest of the options
- [Recipe: my DTO isn't being validated](../recipes/validation/dto-silently-not-validated.md)

## References

- [Pipes](https://docs.nestjs.com/pipes) — official docs
- [`packages/core/pipes/pipes-consumer.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/pipes/pipes-consumer.ts) — the awaited `reduce` that composes a chain
- [`packages/core/router/router-execution-context.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/router/router-execution-context.ts) — `createPipesFn`, `Promise.all` over parameters, `pipes.concat(paramPipes)`
- [`packages/common/pipes/validation.pipe.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/common/pipes/validation.pipe.ts) — `toValidate` and the native-metatype exclusion list

## Demo source

`demos/foundations/` — extends `pipeline/` with `trim.pipe.ts`, the interface-vs-class DTO pair, and the chained-query handler.