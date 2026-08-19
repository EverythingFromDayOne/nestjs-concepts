---
article_id: dtos-and-class-validator
description: A DTO is not a type but a runtime object carrying metadata, so a nested property without @Type passes ValidationPipe silently
concept_folder: validation
wave: 2
nest_baseline: "11.1.x"
node_baseline: "24"
related:
  - request-lifecycle/pipes
  - validation/validationpipe-in-depth
  - validation/serialization-and-response-shaping
  - foundations/decorators-and-metadata-reflection
  - foundations/configuration-and-environment
  - recipes/validation/nested-dto-not-validated
status:
  drafted: true
  reviewed: false
v12_watch: true
---

# DTOs and class-validator

> **Lead with this.** A DTO is not a type. It's a **runtime object carrying metadata**, and that is the only reason validation can exist at all — so every rule in this article is about what survives compilation and what `class-transformer` actually builds, never about what TypeScript believes. One measured fact anchors it, and it depends on **who calls the validator**. Validated directly, a nested object without `@Type(() => X)` is rejected — with a useless message, but rejected. Validated **through `ValidationPipe`**, the same DTO **passes with zero errors**, because since `@nestjs/common` 9.3.2 the pipe seeds `forbidUnknownValues: false` as an overridable default. So inside a Nest application the folk warning is correct and it is a real validation bypass: invalid nested data reaches your handler silently. `@Type(() => X)` on every nested property is not a formality — it is the thing standing between the handler and unchecked input. The mechanism is [article 17](./validationpipe-in-depth.md#forbidunknownvalues-is-seeded-not-forced).

## What it is

Two libraries with a clean division of labour, at `class-validator@0.15.1` and `class-transformer@0.5.1`:

- **`class-transformer`** turns the parsed JSON into an **instance of your class**. That's `plainToInstance`, and it's what gives the value a constructor for metadata to be found on.
- **`class-validator`** reads the decorators registered against that constructor and produces `ValidationError`s.

`ValidationPipe` runs them in that order for you. Its options are [article 17](./validationpipe-in-depth.md); the *mechanism* by which a pipe is reached is [article 13](../request-lifecycle/pipes.md). What this article owns is the DTO itself: how to express required, optional, nested, and repeated fields such that both libraries can see them.

```typescript
// src/orders/dto/create-order.dto.ts
import { Type } from 'class-transformer';
import { ArrayMinSize, IsInt, IsOptional, IsString, Min, ValidateNested } from 'class-validator';

class OrderLineDto {
  @IsString()
  sku!: string;

  @IsInt()
  @Min(1)
  quantity!: number;
}

export class CreateOrderDto {
  @IsString()
  customerId!: string;

  @IsOptional()
  @IsString()
  note?: string;

  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  @ArrayMinSize(1)
  lines!: OrderLineDto[];
}
```

Every line in that file is load-bearing, including the `!`s. The rest of the article is why.

> **If you know Angular.** Reactive-form validators are the analogue, and the structural difference is who owns the rules. In Angular they live in a `FormGroup` built imperatively in a component — the shape and the rules are one object, created per form, and nothing else in the app can reuse them. Here the rules are **attached to a class** that both the transport layer and your services can hold, which is why a DTO can be shared, extended, and composed. The habit that transfers badly is treating validation as a UI concern: an Angular validator improves the experience, while a DTO is the API's actual contract and the only thing standing between a handler and arbitrary JSON. The habit worth keeping is cross-field validation — Angular's group-level validators map almost exactly onto class-level constraints in §Step 5.

## How it works under the hood

### Metadata is registered against the constructor, not the value

Each decorator call registers an entry in `class-validator`'s global metadata storage, keyed by the class. `validate(value)` looks up `value.constructor` and collects what's registered there. So a value's *identity as an instance* is the whole mechanism — which is why `plainToInstance` has to run first, and why [article 13](../request-lifecycle/pipes.md)'s `metatype` matters.

### An object with no metadata fails, it doesn't pass

```
validateSync({ anything: 1 })
→ [{ constraints: { unknownValue: 'an unknown value was passed to the validate function' } }]
```

Measured on 0.15.1. Since 0.14.0 — unconditionally since 0.14.2 — `forbidUnknownValues` defaults to **true**, so `class-validator` **on its own** fails closed on anything whose constructor has no registered rules.

**On the request path, that fail-closed default is not in effect.** Since `@nestjs/common` 9.3.2, `ValidationPipe` seeds `forbidUnknownValues: false` unless you override it — [article 17](./validationpipe-in-depth.md#forbidunknownvalues-is-seeded-not-forced) owns how — so none of the fail-closed behaviour below applies through the pipe by default:

| Value | validated directly | through `ValidationPipe` |
| --- | --- | --- |
| plain object, no metadata | rejected (`unknownValue`) | **passes** |
| nested property without `@Type()` | rejected | **passes** |

The fail-closed behaviour is real and useful where *you* call the validator — config validation in [article 07](../foundations/configuration-and-environment.md), a queue payload, a webhook body. On an HTTP request it isn't there unless you ask for it.

(On `class-validator` before 0.14.0 the default was the other way, and unknown values passed silently. The default became unconditional in 0.14.2. Advice written against those versions is where the "nested validation silently passes" folklore comes from.)

### `@ValidateNested()` without `@Type()` fails uselessly

The two cases, measured side by side against `{ address: { city: 123 } }`:

```
// class WithoutType { @ValidateNested() address!: Address; }
[{ property: 'address',
   children: [{ constraints: { unknownValue: 'an unknown value was passed to the validate function' } }] }]

// class WithType { @ValidateNested() @Type(() => Address) address!: Address; }
[{ property: 'address',
   children: [{ property: 'city', constraints: { isString: 'city must be a string' } }] }]
```

Read the difference carefully — and then read the next paragraph, because it changes the conclusion:

- Without `@Type()`, `plainToInstance` leaves the nested value a plain object, so its constructor has no metadata, so the nested validation reports `unknownValue`. The child error has **no `property` field at all** — any formatter mapping `children` by property emits `undefined`.
- With `@Type()`, `class-transformer` constructs the nested class, its metadata is reachable, and you get `city must be a string`.

**Through `ValidationPipe`, the first case doesn't fail at all.** Since `@nestjs/common` 9.3.2 the pipe seeds `forbidUnknownValues: false`, so an unknown nested value is simply not an error — measured, `[]`. So on the request path the missing `@Type()` is a **silent bypass**, and the `unknownValue` error above is only what you'd see validating the DTO yourself in a test. That asymmetry is worth internalising: **your DTO spec can pass while the endpoint accepts garbage.**

`@Type(() => Address)` is what makes `class-transformer` construct the nested class. It isn't decoration; it's the instruction that makes nested metadata reachable.

### `plainToInstance` does not strip anything

```
plainToInstance(Wrapped, { keep: 'k', nested: { … }, junk: 1 })
→ instance keys: ['keep', 'nested', 'junk']
```

Extraneous properties survive transformation. Stripping is `ValidationPipe`'s `whitelist`, and it strips every property **without a validation decorator** — which has a DTO-side consequence covered in §Step 4.

### The error shape

`ValidationError` is `{ property, value, constraints, children }`. Top-level failures put their messages in `constraints`; nested failures put a `ValidationError` per level in `children` and leave `constraints` empty. Code that reads only `constraints` reports nothing for a nested DTO — the object it's inspecting is a container.

**Arrays add a level whose `property` is the index.** Measured for one bad element in `lines`:

```
property=lines     constraints={}
  property=0       constraints={}                     ← the array index, as a string
    property=quantity constraints={ min: 'quantity must not be less than 1' }
```

Three levels, not two. An error formatter that joins `property` values produces `lines.0.quantity`, which is usually what you want; one that assumes a field name at every level reports an index as a field.

## Walkthrough — building a DTO that both libraries can see

We start `demos/validation/`, the app for this folder.

### Step 1 — required, optional, and the `!` that isn't decoration

There is no `@IsRequired()`. A field is required because a validator fails on `undefined`:

```typescript
class OptionalDemo {
  @IsOptional()
  @IsInt()
  page?: number;

  @IsString()
  name!: string;
}
```

Measured:

| Input | Errors |
| --- | --- |
| `{}` | `['name']` — `page` is absent and optional, `name` is absent and required |
| `{ name: 'x', page: 'abc' }` | `['page']` — present, so validated, and it isn't an integer |
| `{ name: 'x', page: null }` | `[]` — **`@IsOptional()` skips every validator on `null` too** |

That last row is the one to internalise. `@IsOptional()` doesn't mean "may be absent"; it means **"skip all validation when the value is `null` or `undefined`."** If `null` is a meaningful value that still has rules — a nullable column, a tri-state flag — `@IsOptional()` is the wrong decorator and `@ValidateIf(o => o.page !== undefined)` expresses what you meant.

And the `!`: under `strictPropertyInitialization` a class field with no initializer is an error, so DTOs need `name!: string`. It's a definite-assignment assertion, and it's honest here — the value really is assigned, by `class-transformer`, after construction.

**A TypeScript `?` proves nothing at runtime.** `page?: number` is erased. `@IsOptional()` is the runtime statement; the `?` just keeps the compiler agreeing with it.

### Step 2 — nesting

```typescript
// ✗ rejects the request with an error that names nothing
export class CreateOrderDto {
  @ValidateNested({ each: true })
  lines!: OrderLineDto[];
}
```

```typescript
// ✓ nested metadata is reachable
export class CreateOrderDto {
  @ValidateNested({ each: true })
  @Type(() => OrderLineDto)
  lines!: OrderLineDto[];
}
```

The `() => OrderLineDto` closure — rather than the class directly — exists so the reference is resolved lazily, which matters when two DTOs reference each other. Same reasoning as `forwardRef` in the module graph.

Two further rules for nesting:

- **`{ each: true }` when the property is an array** of nested objects. Without it, `@ValidateNested()` treats the array itself as the object to validate and reports `unknownValue` against the array.
- **Depth is unbounded and so is the error tree.** A three-level DTO produces three levels of `children`, and flattening that into client-readable messages is `ValidationPipe`'s `exceptionFactory` — [article 17](./validationpipe-in-depth.md).

### Step 3 — arrays and repeated values

```typescript
// src/search/dto/search.dto.ts
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsInt, IsOptional, IsString } from 'class-validator';

export class SearchDto {
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(50)
  @IsString({ each: true })          // ← each element, not the array
  skus!: string[];

  @IsOptional()
  @IsInt({ each: true })
  @Type(() => Number)                // ← query strings arrive as strings
  categoryIds?: number[];
}
```

`{ each: true }` is the distinction that catches everyone: `@IsString()` on a `string[]` asserts the *array* is a string and fails. And for query parameters, remember that everything arrives as a string — `@Type(() => Number)` on the DTO is the local, explicit alternative to turning on global implicit conversion.

`ParseArrayPipe` from [article 13](../request-lifecycle/pipes.md#minimal-shapes) is the other route when the value is a bare query parameter rather than part of a body.

### Step 4 — the whitelist interaction

`ValidationPipe`'s `whitelist: true` strips every property with no **validation** decorator. `@Type()` is a `class-transformer` decorator, so it doesn't count:

```typescript
// src/widgets/dto/create-widget.dto.ts
// ✗ `metadata` is stripped before the handler sees it
import { Type } from 'class-transformer';
import { IsString } from 'class-validator';

export class CreateWidgetDto {
  @IsString()
  name!: string;

  @Type(() => MetadataDto)     // transformation only — no validator
  metadata!: MetadataDto;
}
```

The handler receives a DTO with `metadata` missing, no error, and no clue. Two fixes, and the choice says something:

```typescript
// ✓ if you want it validated
@ValidateNested()
@Type(() => MetadataDto)
metadata!: MetadataDto;

// ✓ if you genuinely want it unvalidated but kept
@Allow()
@Type(() => MetadataDto)
metadata!: MetadataDto;
```

`@Allow()` exists for exactly this: it registers a property as known without asserting anything about it. Reaching for it should feel slightly uncomfortable — an unvalidated field on an inbound DTO is a decision, and writing it down is better than a stripped field you never notice.

### Step 5 — reuse, and cross-field rules

**Mapped types** compose DTOs without duplicating decorators:

```typescript
import { IntersectionType, OmitType, PartialType, PickType } from '@nestjs/mapped-types';

export class UpdateOrderDto extends PartialType(CreateOrderDto) {}          // all optional
export class OrderIdDto extends PickType(CreateOrderDto, ['customerId'] as const) {}
export class PublicOrderDto extends OmitType(CreateOrderDto, ['note'] as const) {}
export class OrderQueryDto extends IntersectionType(PaginationDto, SortDto) {}
```

`PartialType` is the one that earns its keep — a PATCH DTO with every field optional, generated from the create DTO, so a new field can't be forgotten. Use `@nestjs/mapped-types` when you don't have Swagger; `@nestjs/swagger` exports the same helpers and additionally carries the OpenAPI metadata.

**Cross-field rules belong at the class level**, not spread across properties:

```typescript
// src/orders/dto/date-range.dto.ts
import {
  ValidationArguments, ValidatorConstraint, ValidatorConstraintInterface, Validate, IsDateString,
} from 'class-validator';

@ValidatorConstraint({ name: 'EndAfterStart', async: false })
export class EndAfterStartConstraint implements ValidatorConstraintInterface {
  validate(_value: unknown, args: ValidationArguments): boolean {
    const { startsAt, endsAt } = args.object as DateRangeDto;
    return Boolean(startsAt && endsAt) && new Date(endsAt) > new Date(startsAt);
  }

  defaultMessage(): string {
    return 'endsAt must be after startsAt';
  }
}

export class DateRangeDto {
  @IsDateString()
  startsAt!: string;

  @IsDateString()
  @Validate(EndAfterStartConstraint)
  endsAt!: string;
}
```

`args.object` is the whole DTO, which is what makes cross-field validation possible at all. Two notes: attach the constraint to the field the *client should fix*, because that's the `property` the error carries; and constraints can be `async: true` and injectable, but a constraint doing I/O has the same problems as [a pipe doing I/O](../request-lifecycle/pipes.md#step-5--concurrency-and-the-cost-of-io) — duplicate queries and a database in every DTO test.

### Verify the loop

A DTO is testable with no HTTP, no Nest, and no pipe — which makes it the cheapest validation to assert:

```typescript
// src/orders/dto/create-order.dto.spec.ts
import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';
import { CreateOrderDto } from './create-order.dto';

const validate = (payload: unknown): string[] =>
  validateSync(plainToInstance(CreateOrderDto, payload)).map((e) => e.property);

describe('CreateOrderDto', () => {
  const valid = { customerId: 'c1', lines: [{ sku: 's1', quantity: 2 }] };

  it('accepts a valid payload', () => {
    expect(validate(valid)).toEqual([]);
  });

  it('requires at least one line', () => {
    expect(validate({ ...valid, lines: [] })).toEqual(['lines']);
  });

  it('reports the nested property, not just the container', () => {
    const errors = validateSync(
      plainToInstance(CreateOrderDto, { ...valid, lines: [{ sku: 's1', quantity: 0 }] }),
    );
    expect(errors[0].children?.[0].children?.[0].property).toBe('quantity');
  });
});
```

The third test is the one that catches a missing `@Type()`, because without it that nested `property` is `undefined`. It's three lines and it protects the entire nesting mechanism.

Note `import 'reflect-metadata'` — outside a Nest bootstrap nothing has loaded it, the same fix article 07's validation spec needed.

## Real-world patterns

**One DTO per operation, not per entity.** `CreateOrderDto` and `UpdateOrderDto` differ in optionality and often in which fields exist at all. `PartialType` makes the second nearly free.

**`@Type()` on every nested and every numeric field.** Nested for reachability, numeric because transports deliver strings.

**Never share a DTO between input and output.** An inbound DTO's job is rejecting bad input; an outbound one's is hiding fields. The moment `@Exclude()` appears on an inbound DTO, they've been conflated — see [serialization](./serialization-and-response-shaping.md).

**Validate at every trust boundary, not just HTTP.** Queue payloads, webhook bodies, and configuration are all untrusted, and `validateSync` works everywhere. Article 07's config schema is the same tool.

**Keep messages client-safe.** `class-validator`'s defaults name properties and constraints, which is fine. Custom messages that quote database or internal identifiers are not.

**A DTO with no decorators is a lie.** If every field is `@Allow()`, delete the DTO and admit the endpoint takes `unknown`.

**Test the nested property name.** One assertion that a nested error carries its `property` catches the single most common DTO defect.

## API reference

| Symbol | From | Purpose |
| --- | --- | --- |
| `@IsString` `@IsInt` `@IsNumber` `@IsBoolean` `@IsDateString` `@IsEnum` `@IsUUID` `@IsEmail` `@IsUrl` | `class-validator` | per-field assertions |
| `{ each: true }` | option | apply the validator to **elements**, not the array |
| `@IsOptional()` | `class-validator` | skip **all** validators when the value is `null` or `undefined` |
| `@ValidateIf(fn)` | `class-validator` | conditional validation — what you want when `null` is meaningful |
| `@Allow()` | `class-validator` | mark a property known so `whitelist` keeps it, without asserting anything |
| `@ValidateNested({ each? })` | `class-validator` | descend into a nested object — **requires `@Type()`** |
| `@ArrayMinSize` `@ArrayMaxSize` `@IsArray` | `class-validator` | array-shape assertions |
| `@Validate(Constraint)` / `@ValidatorConstraint` | `class-validator` | custom and cross-field rules; `args.object` is the whole DTO |
| `@Type(() => X)` | `class-transformer` | construct a nested class or coerce a primitive |
| `plainToInstance(Cls, obj)` | `class-transformer` | build the instance — does **not** strip extraneous keys |
| `validateSync(instance)` | `class-validator` | returns `ValidationError[]`; nested errors live in `children` |
| `PartialType` `PickType` `OmitType` `IntersectionType` | `@nestjs/mapped-types` | compose DTOs without duplicating decorators |

## Common mistakes

**1. An `interface` or `type` instead of a `class`.** No metadata, `ValidationPipe` skips it entirely, endpoint accepts anything. [Article 13](../request-lifecycle/pipes.md#step-4--the-interface-trap-demonstrated) covers the mechanism.

**2. `@ValidateNested()` without `@Type()`.** Through `ValidationPipe` this is a **silent bypass** — measured, no errors at all, because since `@nestjs/common` 9.3.2 the pipe seeds `forbidUnknownValues: false`. Validated directly it's rejected with an unusable message. So a DTO spec can be green while the endpoint accepts anything nested.

**3. `@IsString()` on an array.** Asserts the array is a string. Add `{ each: true }`.

**4. `@ValidateNested()` on an array without `{ each: true }`.** Validates the array as a single object.

**5. `@IsOptional()` when `null` should still be validated.** It skips every validator on `null`. Use `@ValidateIf`.

**6. Trusting TypeScript's `?`.** Erased at runtime. `@IsOptional()` is the statement that survives.

**7. A property whose only decorator is `@Type()`.** `whitelist` strips it silently. Add `@ValidateNested()` or `@Allow()`.

**8. Reading nested errors from `constraints`.** Nested failures are in `children`; the container's `constraints` is empty.

**9. One DTO for input and output.** Two different jobs. Splitting them is cheaper than untangling them later.

**10. Missing `import 'reflect-metadata'` in a DTO spec.** Outside a Nest bootstrap nothing loads it, and every decorator silently does nothing.

## How this evolved

The consequential change is `forbidUnknownValues`, which **flipped to `true` by default in `class-validator` 0.14.0** — and became **unconditional in 0.14.2**. Since `@nestjs/common` 9.3.2, `ValidationPipe` has seeded the option back to `false` (overridable — [article 17](./validationpipe-in-depth.md#forbidunknownvalues-is-seeded-not-forced)), citing the breakage that flip caused. The result is a split brain: `class-validator` fails closed, Nest's pipe does not unless you override it, and which behaviour you observe depends on which one invoked the validation. That is the whole explanation for why advice on nested validation is so inconsistent, and it's worth checking both your lockfile and your pipe options before trusting any tutorial on this subject.

`@nestjs/mapped-types` was also split out so `PartialType` and friends don't require pulling in Swagger.

The largest change ahead is Nest 12's **Standard Schema** support in `@Body()` and `@Query()`, which would let a Zod or Valibot schema replace this entire file for an endpoint — and, because a schema is a runtime value rather than an erased type, would sidestep both the interface trap and the `@Type()` requirement. An addition rather than a replacement, per the release notes. Re-verify at GA.

## Exercises

**1. Break the nesting, then read the error.** Remove `@Type()` from a nested property and print the full `ValidationError` tree for a bad nested value. *Hint: look for what the child error is missing, not just what it says.*

**2. Find the stripped field.** Give a DTO a property whose only decorator is `@Type()`, post a payload containing it with `whitelist: true`, and log what the handler received. *Hint: there is no error to search for.*

**3. Make `null` meaningful.** Write a field where `null` is a legal value that still has to satisfy a rule, first with `@IsOptional()` and then with `@ValidateIf`. *Hint: only one of them rejects `null` from a field where `null` isn't allowed.*

## Summary

- A DTO is a **class**, because metadata registers against the constructor and `class-validator` looks it up from `value.constructor`.
- `class-transformer` builds the instance; `class-validator` checks it. Both are needed, in that order.
- `forbidUnknownValues` defaults **true** in `class-validator` 0.15.1 — since 0.14.0, unconditionally since 0.14.2 — but since `@nestjs/common` 9.3.2 **`ValidationPipe` seeds it to `false`**. So the validator fails closed only where you call it yourself, unless you override the pipe.
- `@ValidateNested()` without `@Type()` is therefore a **silent bypass on the request path** (measured: no errors), and an unusable `unknownValue` error when validated directly. Your DTO spec can pass while the endpoint accepts garbage.
- `{ each: true }` applies a validator to array **elements**; without it the array itself is validated.
- `@IsOptional()` skips **all** validators on `null` as well as `undefined`. `@ValidateIf` is what you want when `null` has rules.
- `plainToInstance` strips nothing; `whitelist` does, and it removes any property with no **validation** decorator — so `@Type()`-only fields vanish unless you add `@Allow()`.
- Nested errors live in `children`, not `constraints`.

## See also

- [Pipes](../request-lifecycle/pipes.md#metatype-is-the-emitted-paramtype-and-thats-the-trap) — why the class-versus-interface choice decides whether any of this runs
- [ValidationPipe in depth](./validationpipe-in-depth.md) — `whitelist`, `transform`, `exceptionFactory`, and the error response
- [Serialization and response shaping](./serialization-and-response-shaping.md) — the outbound half, and why it needs different classes
- [Decorators and metadata reflection](../foundations/decorators-and-metadata-reflection.md) — how the decorators store what they store
- [Configuration and environment](../foundations/configuration-and-environment.md#step-3--fail-the-boot-not-the-request) — the same libraries applied to `process.env`
- [Recipe: my nested DTO isn't being validated](../recipes/validation/nested-dto-not-validated.md)

## References

- [Validation](https://docs.nestjs.com/techniques/validation) — official docs
- [`class-validator` on npm](https://www.npmjs.com/package/class-validator) — decorator reference; 0.15.1 at this baseline
- [`class-transformer` on npm](https://www.npmjs.com/package/class-transformer) — `plainToInstance`, `@Type`
- [Mapped types](https://docs.nestjs.com/openapi/mapped-types) — `PartialType`, `PickType`, `OmitType`, `IntersectionType`

## Demo source

`demos/validation/` — the first app in this folder, with the order DTOs and their specs.