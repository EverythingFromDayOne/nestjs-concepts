---
article_id: validationpipe-in-depth
description: Three of ValidationPipe's defaults are the opposite of its reputation, starting with transform being off
concept_folder: validation
wave: 2
nest_baseline: "11.1.x"
node_baseline: "24"
related:
  - validation/dtos-and-class-validator
  - request-lifecycle/pipes
  - validation/serialization-and-response-shaping
  - request-lifecycle/exception-filters
  - recipes/validation/nested-dto-not-validated
status:
  drafted: true
  reviewed: false
v12_watch: true
---

# ValidationPipe in depth

> **Lead with this.** Three of `ValidationPipe`'s defaults are the opposite of what almost everyone assumes, and each one has teeth. **`transform` is `false`** — so by default your handler receives a plain object, not a DTO instance, and `class-transformer`'s work is thrown away. **`forbidUnknownValues` is forced to `false`** by Nest itself, overriding `class-validator`'s own default — which silently re-enables the nested-`@Type()` bypass: measured, a `@ValidateNested()` property with no `@Type()` passes validation with **zero errors** through the pipe, while the same DTO validated directly is rejected. And with `transform: true`, a numeric query parameter is coerced with `+value`, so `?page=abc` reaches your handler as **`NaN`** with no error at all. This article is mostly about which options to turn on and what each one costs, but those three are why the defaults are not a starting point.

## What it is

One pipe, one options object, and a long tail of behaviour. The options split into three groups:

| Nest's own | What it does |
| --- | --- |
| `transform` | return the class instance instead of a plain object — **default `false`** |
| `transformOptions` | passed to `plainToInstance` (`enableImplicitConversion`, `excludeExtraneousValues`, …) |
| `disableErrorMessages` | throw the status with **no body detail** |
| `errorHttpStatusCode` | default `400` |
| `exceptionFactory` | replace the thrown exception entirely |
| `validateCustomDecorators` | validate `createParamDecorator` arguments — **default `false`** |
| `expectedType` | override the reflected `metatype` |
| `validatorPackage` / `transformerPackage` | inject the libraries (monorepo and test use) |

Everything else in the object is forwarded to `class-validator`: `whitelist`, `forbidNonWhitelisted`, `forbidUnknownValues`, `skipMissingProperties`, `skipNullProperties`, `skipUndefinedProperties`, `groups`, `always`, `strictGroups`, `stopAtFirstError`, `dismissDefaultMessages`, `validationError: { target, value }`.

The DTO side is [article 16](./dtos-and-class-validator.md); the mechanism that gets a pipe invoked at all is [article 13](../request-lifecycle/pipes.md).

## How it works under the hood

### `transform()`, start to finish

```typescript
// paraphrased from packages/common/pipes/validation.pipe.ts
public async transform(value: any, metadata: ArgumentMetadata) {
  if (this.expectedType) {
    metadata = { ...metadata, metatype: this.expectedType };      // 1
  }
  const metatype = metadata.metatype;
  if (!metatype || !this.toValidate(metadata)) {
    return this.isTransformEnabled ? this.transformPrimitive(value, metadata) : value;   // 2
  }
  const originalValue = value;
  value = this.toEmptyIfNil(value, metatype);                      // 3
  const isNil = value !== originalValue;
  const isPrimitive = this.isPrimitive(value);
  this.stripProtoKeys(value);                                      // 4
  let entity = classTransformer.plainToInstance(metatype, value, this.transformOptions);
  // …constructor fixup…
  const errors = await this.validate(entity, this.validatorOptions);
  if (errors.length > 0) {
    throw await this.exceptionFactory(errors);                     // 5
  }
  if (this.isTransformEnabled) return entity;                      // 6
  if (isNil) return originalValue;
  const shouldTransformToPlain = Object.keys(this.validatorOptions).length > 1;
  return shouldTransformToPlain
    ? classTransformer.classToPlain(entity, this.transformOptions)  // 7
    : value;
}
```

Seven things worth naming.

**1. `expectedType` replaces the reflected metatype.** The escape hatch for parameter-level validation, where the metatype is a primitive and [article 13](../request-lifecycle/pipes.md#metatype-is-the-emitted-paramtype-and-thats-the-trap)'s `toValidate` would bail.

**2. The early exit.** No metatype, a native metatype, or a custom-decorator argument with `validateCustomDecorators: false` — and nothing is validated. With `transform: true`, primitives detour through `transformPrimitive` instead.

**3. `toEmptyIfNil`.** A missing body against a class metatype becomes `{}` so validation *runs* and reports every required field, rather than passing because there was nothing to check. That's why `POST` with no body returns a useful 400.

**4. `stripProtoKeys` — prototype-pollution defence, recursively.** It deletes `__proto__`, `prototype`, and `constructor` from the payload and every nested object, skipping `Date`/`RegExp`/`Map`/`Set` and friends. Undocumented, free, and a genuine reason to run the pipe on every route rather than selectively.

**5. Errors go through `exceptionFactory`**, which defaults to §The error body below.

**6/7. Three different return values**, and this is the part nobody knows:

| Config | Handler receives |
| --- | --- |
| `transform: true` | the **class instance** — methods, getters, `instanceof` all work |
| `transform: false` **and more than one validator option set** | `classToPlain(entity)` — a plain object built from the validated (and whitelisted) entity |
| `transform: false` with no other options | **the original `value`** — untouched, unstripped |

That middle row is decided by `Object.keys(this.validatorOptions).length > 1`, with a source comment explaining the `> 1`: `forbidUnknownValues` always occupies one slot, so "more than one key" is the proxy for "the user passed something." The practical upshot is blunt — **`new ValidationPipe()` with no options validates but strips nothing and transforms nothing.** Whitelisting only reaches your handler if you asked for at least one option.

### `forbidUnknownValues` is forced off

```typescript
// paraphrased — the constructor
// @see https://github.com/nestjs/nest/issues/10683#issuecomment-1413690508
this.validatorOptions = { forbidUnknownValues: false, ...validatorOptions };
```

`class-validator` has defaulted this to `true` since 0.14, meaning it rejects objects whose constructor carries no metadata. Nest turns it back off, for compatibility reasons recorded in that issue. Measured consequences, same DTO both ways:

| Case | validated directly | through `ValidationPipe` |
| --- | --- | --- |
| `@ValidateNested()` **without** `@Type()` | rejected | **passes — no errors** |
| `@ValidateNested()` **with** `@Type()` | rejected | rejected ✓ |
| a plain object with no metadata | rejected | **passes — no errors** |

So inside a Nest application the folk wisdom is correct: **a nested DTO with no `@Type()` is not validated at all.** Invalid nested data reaches the handler silently. That is a validation bypass, not a cosmetic issue, and it's the strongest argument in the corpus for the `@Type()`-on-every-nested-property rule.

You can set `forbidUnknownValues: true` explicitly. Do it deliberately: it also makes the pipe reject anything else it can't find metadata for, which is the behaviour you want and may surface payloads that used to pass.

### `transformPrimitive` coerces without validating

```typescript
// paraphrased
protected transformPrimitive(value: any, metadata: ArgumentMetadata) {
  if (!metadata.data) return value;                        // unnamed @Query() object — untouched
  const { type, metatype } = metadata;
  if (type !== 'param' && type !== 'query') return value;   // bodies are not coerced here
  if (metatype === Boolean) {
    if (isUndefined(value)) return undefined;
    return value === true || value === 'true';              // ← everything else is false
  }
  if (metatype === Number) {
    if (isUndefined(value)) return undefined;
    return +value;                                          // ← NaN for garbage
  }
  if (metatype === String && !isUndefined(value)) return String(value);
  return value;
}
```

Two traps in nine lines:

- **`?flag=1` is `false`.** Only the literal string `'true'` (or a real `true`) is truthy. `1`, `yes`, `on` all become `false`, silently.
- **`?page=abc` is `NaN`.** `+value` with no check, and because the metatype is `Number` the validator was skipped, so nothing rejects it. Your handler gets `NaN` typed as `number`.

This is exactly why `ParseIntPipe` and `ParseBoolPipe` exist: they *throw*. `transform: true` gives you convenience; the parse pipes give you a guarantee.

### The error body

```typescript
// paraphrased
public createExceptionFactory() {
  return (validationErrors: ValidationError[] = []) => {
    if (this.isDetailedOutputDisabled) {
      return new HttpErrorByCode[this.errorHttpStatusCode]();
    }
    return new HttpErrorByCode[this.errorHttpStatusCode](
      this.flattenValidationErrors(validationErrors),
    );
  };
}
```

`flattenValidationErrors` returns a **`string[]`** of constraint messages, so the default response is:

```json
{ "message": ["customerId must be a string"], "error": "Bad Request", "statusCode": 400 }
```

Nested errors are flattened by **gluing the parent path onto the front of the message**, not into a separate field:

```
"lines.0.quantity must not be less than 1"
```

That's `prependConstraintsWithParentProp` building `` `${parentPath}.${message}` ``. It reads oddly and it's machine-hostile — a client wanting a field-keyed map of errors has to parse the prefix back out, which is the usual reason to replace `exceptionFactory`.

## Minimal shapes

```typescript
// the configuration this article argues for
app.useGlobalPipes(
  new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
  }),
);
```

```typescript
// same thing with DI, which you want as soon as exceptionFactory needs a logger
providers: [
  {
    provide: APP_PIPE,
    useFactory: () =>
      new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true }),
  },
]
```

```typescript
// parameter level, where the metatype is a primitive
@Get()
list(@Query(new ValidationPipe({ expectedType: SearchDto, transform: true })) query: SearchDto) {}
```

## Walkthrough — building the configuration, one cost at a time

We continue `demos/validation/`.

### Step 1 — the default, and what it doesn't do

```typescript
app.useGlobalPipes(new ValidationPipe());
```

Post an invalid payload and you get a 400 — validation works. Now post a *valid* payload with an extra field and log what the handler received:

```bash
curl -X POST localhost:3000/orders -H 'content-type: application/json' \
  -d '{"customerId":"c1","lines":[{"sku":"s","quantity":1}],"injected":"surprise"}'
```

`injected` is there, `dto instanceof CreateOrderDto` is `false`, and `lines[0]` is a plain object. Nothing was stripped and nothing was transformed, because `transform` defaults to `false` and the no-other-options branch returns the original value.

**The lesson to carry:** `new ValidationPipe()` is a validator, not a sanitiser. Every guarantee beyond "the shape was checked" requires an option.

### Step 2 — `transform: true`

```typescript
new ValidationPipe({ transform: true })
```

Now the handler gets a real `CreateOrderDto`, `lines[0]` is an `OrderLineDto`, and getters and methods on the DTO work. Three things this buys and one it costs:

- **`instanceof` works**, so a service that narrows on the class type is honest.
- **`@Type(() => Number)` on DTO fields takes effect** in what the handler sees, not just in what was validated.
- **`@Transform()` and `@Exclude()` on the DTO apply** — which is why an inbound DTO should not carry them ([article 16](./dtos-and-class-validator.md#real-world-patterns)).
- **Cost:** every request pays a `plainToInstance` pass over the whole payload, including nested arrays. On large bodies it's measurable, and it's the reason the default is off.

It also switches on `transformPrimitive` for named `@Param`/`@Query` arguments — with the `NaN` and `false` behaviour above. If you enable `transform` globally, be deliberate about primitives: prefer `ParseIntPipe` at the parameter, or a DTO with `@Type(() => Number)` and `@IsInt()`.

### Step 3 — `whitelist` and `forbidNonWhitelisted`

```typescript
new ValidationPipe({ transform: true, whitelist: true })
```

`injected` is now gone from what the handler sees. Two consequences worth knowing before you rely on it:

- **`whitelist` keeps only properties with a validation decorator.** A `@Type()`-only property is stripped — [article 16's](./dtos-and-class-validator.md#step-4--the-whitelist-interaction) `@Allow()` case.
- **Stripping is silent.** A client sending a misspelled field gets a 201 and wonders why the value didn't take.

`forbidNonWhitelisted: true` converts that silence into a 400 naming the offending property. It's the better default for an internal API and a breaking change for a public one — old clients sending harmless extra fields start failing. Pick per API, and if you're adding it to something with existing clients, log first and enforce later.

### Step 4 — `forbidUnknownValues: true`, deliberately

```typescript
new ValidationPipe({ transform: true, whitelist: true, forbidNonWhitelisted: true, forbidUnknownValues: true })
```

This restores `class-validator`'s own default and closes the nested-`@Type()` bypass. Turning it on in an existing application is worth doing carefully, because it can surface payloads that were passing without being validated — which is the point, and also a deploy-day incident if you do it silently. Run it in a staging environment first, or with a temporary `exceptionFactory` that logs instead of throwing.

### Step 5 — `exceptionFactory`, for a client-usable error

The default's `"lines.0.quantity must not be less than 1"` strings are readable and hard to consume. A field-keyed map is usually what a form wants:

```typescript
// src/validation/validation-exception.factory.ts
import { BadRequestException, ValidationError } from '@nestjs/common';

function collect(errors: ValidationError[], path = ''): Record<string, string[]> {
  return errors.reduce<Record<string, string[]>>((acc, error) => {
    const key = path ? `${path}.${error.property}` : error.property;
    if (error.constraints) {
      acc[key] = Object.values(error.constraints);
    }
    if (error.children?.length) {
      Object.assign(acc, collect(error.children, key));
    }
    return acc;
  }, {});
}

export const validationExceptionFactory = (errors: ValidationError[]) =>
  new BadRequestException({
    statusCode: 400,
    error: 'Validation failed',
    fields: collect(errors),
  });
```

```json
{ "statusCode": 400, "error": "Validation failed",
  "fields": { "lines.0.quantity": ["quantity must not be less than 1"] } }
```

Two notes. The recursion mirrors the three-level tree [article 16](./dtos-and-class-validator.md#the-error-shape) measured, so the array index appears in the path — usually what a client wants. And because the returned exception is an `HttpException` carrying an object, `getResponse()` makes that object the response body verbatim, per [article 14](../request-lifecycle/exception-filters.md#what-the-built-in-filter-actually-does) — no filter needed.

Also consider `validationError: { target: false, value: false }`, which keeps the offending **value** out of the error object. Without it, an error can carry the submitted value into your logs — passwords included.

### Verify the loop

Config behaviour is worth asserting because the defaults are surprising:

```typescript
// src/validation/validation.pipe.spec.ts
import { ValidationPipe } from '@nestjs/common';
import { CreateOrderDto } from '../orders/dto/create-order.dto';

const meta = { type: 'body' as const, metatype: CreateOrderDto, data: undefined };
const payload = { customerId: 'c1', lines: [{ sku: 's', quantity: 1 }], injected: 'x' };

describe('ValidationPipe options', () => {
  it('default: validates but neither strips nor transforms', async () => {
    const out = await new ValidationPipe().transform(payload, meta);
    expect(out).toHaveProperty('injected');
    expect(out).not.toBeInstanceOf(CreateOrderDto);
  });

  it('whitelist + transform: strips and instantiates', async () => {
    const out = await new ValidationPipe({ transform: true, whitelist: true }).transform(payload, meta);
    expect(out).not.toHaveProperty('injected');
    expect(out).toBeInstanceOf(CreateOrderDto);
  });

  it('rejects a nested violation', async () => {
    await expect(
      new ValidationPipe({ transform: true }).transform(
        { ...payload, lines: [{ sku: 's', quantity: 0 }] },
        meta,
      ),
    ).rejects.toThrow(/quantity/);
  });
});
```

And the one that protects against the bypass:

```bash
# with a nested DTO missing @Type(), post invalid nested data
curl -i -X POST localhost:3000/orders -H 'content-type: application/json' \
  -d '{"customerId":"c1","lines":[{"sku":123,"quantity":"x"}]}'
# expect 400. If it's 201, either @Type() is missing or forbidUnknownValues is off.
```

That single `curl` is the highest-value validation check in the corpus — it catches the one failure mode that produces a success.

## Real-world patterns

**One global pipe, four options on:** `transform`, `whitelist`, `forbidNonWhitelisted`, `forbidUnknownValues`. Deviate per route, not per project.

**Register with `APP_PIPE` once the `exceptionFactory` needs anything injected.** `useGlobalPipes(new …)` gets no DI, per [article 09](../request-lifecycle/execution-order.md#minimal-shapes).

**Replace `exceptionFactory` early.** The default's prefixed strings are hard to consume and hard to change later without breaking clients.

**Set `validationError: { value: false }`.** Submitted values in error objects end up in logs.

**Don't reach for `enableImplicitConversion`.** It coerces every field by declared type globally, which turns typos into values instead of errors. `@Type(() => Number)` on the two fields that need it is explicit and local.

**Parse primitives with parse pipes, not with `transform`.** `transformPrimitive` coerces without validating; `ParseIntPipe` throws.

**`forbidNonWhitelisted` is a breaking change for public APIs.** Log-then-enforce.

**`groups` is a last resort.** Validation groups let one DTO serve create and update, and they make the DTO's contract conditional on a flag set somewhere else. `PartialType` is usually clearer.

**`disableErrorMessages: true` in production is a trade, not a hardening step.** It removes the field names an attacker could enumerate — and the field names your own client needs. If you use it, make sure the detail is logged.

## API reference

| Option | Default | Effect |
| --- | --- | --- |
| `transform` | `false` | return the class instance; enables `transformPrimitive` for named params |
| `whitelist` | `false` | keep only properties with a **validation** decorator |
| `forbidNonWhitelisted` | `false` | 400 instead of silently stripping |
| `forbidUnknownValues` | **`false`** (Nest overrides class-validator) | reject values with no metadata — closes the nested bypass |
| `skipMissingProperties` | `false` | skip validation for absent properties |
| `skipNullProperties` / `skipUndefinedProperties` | `false` | narrower versions of the above |
| `stopAtFirstError` | `false` | one constraint message per property |
| `groups` / `always` / `strictGroups` | — | conditional validation sets |
| `dismissDefaultMessages` | `false` | drop the built-in messages |
| `validationError.target` / `.value` | `true` | include the object / the submitted value in errors |
| `transformOptions` | — | forwarded to `plainToInstance` |
| `errorHttpStatusCode` | `400` | e.g. `422` |
| `disableErrorMessages` | `false` | status only, no body detail |
| `exceptionFactory` | flattened `string[]` | replace the thrown exception |
| `validateCustomDecorators` | `false` | validate `createParamDecorator` arguments |
| `expectedType` | — | override the reflected metatype |

## Common mistakes

**1. Assuming `new ValidationPipe()` strips or transforms.** It does neither. `transform` is `false`, and with no other options set the original value is returned untouched.

**2. Assuming `instanceof` works.** Only with `transform: true`.

**3. Relying on `class-validator`'s `forbidUnknownValues` default.** Nest forces it to `false`, which silently disables validation for nested properties missing `@Type()`.

**4. `?flag=1` meaning true.** `transformPrimitive` only accepts `'true'`. Everything else is `false`.

**5. `?page=abc` under `transform: true`.** Coerced with `+value` to `NaN`, and never validated. Use `ParseIntPipe`.

**6. Turning on `forbidNonWhitelisted` for a public API without warning.** Clients sending extra fields start getting 400s.

**7. Leaving `validationError.value` on.** Submitted values travel into error objects and logs.

**8. `enableImplicitConversion` globally.** Silent coercion everywhere; a typo becomes a value.

**9. Parsing the default error strings.** `"lines.0.quantity must not be less than 1"` is one string with the path glued on. Replace `exceptionFactory` instead.

**10. Expecting custom param decorators to be validated.** `validateCustomDecorators` is `false`, so a `@CurrentUser()` argument is never checked.

## How this evolved

The consequential history here is one line: `forbidUnknownValues: false` was added to Nest's constructor to work around breakage after `class-validator` 0.14 flipped its own default, with the issue linked in the source. That workaround is still present at 11.1.28, which is why the nested-`@Type()` bypass exists *inside Nest* and not outside it. `stripProtoKeys` grew from a flat delete into a recursive walk with a built-in-types exclusion list, after it interfered with fake timers in tests. And `toEmptyIfNil` plus the empty-string fallbacks are accommodations for SWC's compilation of nil values — the kind of detail that explains an otherwise inexplicable branch.

Nest 12's **Standard Schema** support in `@Body()`/`@Query()` is an alternative route past all of this: a Zod or Valibot schema is a runtime value, so there is no metatype to reflect, no `@Type()` to forget, and no `forbidUnknownValues` question. Documented as an addition, with `class-validator` staying the default. Re-verify this article at GA.

## Exercises

**1. Watch the default do nothing.** With `new ValidationPipe()`, post a valid payload plus an extra field and log `Object.keys(dto)` and `dto instanceof YourDto`. *Hint: both answers are the opposite of the reputation.*

**2. Reproduce the bypass.** Remove `@Type()` from a nested array property and post invalid nested data through the pipe. Then set `forbidUnknownValues: true` and post it again. *Hint: the first response is a 201.*

**3. Break a boolean.** With `transform: true`, send `?flag=1`, `?flag=yes`, and `?flag=true` to a handler taking `@Query('flag') flag: boolean`, and log all three. *Hint: only one of them is what the caller meant.*

## Summary

- **`transform` defaults to `false`.** The handler gets a plain object; `instanceof` fails.
- With `transform: false`, the return value depends on whether you passed **any other option** — original value if not, `classToPlain(entity)` if so. So stripping only reaches your handler when at least one option is set.
- **Nest forces `forbidUnknownValues: false`**, overriding `class-validator`. Measured: a `@ValidateNested()` property with no `@Type()` **passes with no errors** through the pipe, and is rejected when validated directly.
- `transformPrimitive` coerces named `@Param`/`@Query` values **without validating**: `'true'` only for booleans, `+value` for numbers, so `?page=abc` is `NaN`.
- `toEmptyIfNil` turns a missing body into `{}` so required-field errors are reported.
- `stripProtoKeys` recursively deletes `__proto__`, `prototype`, and `constructor` — free prototype-pollution defence.
- The default error body is a **flat `string[]`** with nested paths glued onto the message text.
- `whitelist` keeps only decorated properties and strips silently; `forbidNonWhitelisted` makes it loud and is a breaking change for existing clients.

## See also

- [DTOs and class-validator](./dtos-and-class-validator.md) — the classes this pipe validates, and the `@Type()` rule this article explains the cost of
- [Pipes](../request-lifecycle/pipes.md#metatype-is-the-emitted-paramtype-and-thats-the-trap) — how `metatype` decides whether the pipe runs at all
- [Serialization and response shaping](./serialization-and-response-shaping.md) — the outbound direction, and why `@Exclude()` doesn't belong on an inbound DTO
- [Exception filters](../request-lifecycle/exception-filters.md#what-the-built-in-filter-actually-does) — why an object-carrying `HttpException` needs no filter
- [Execution order](../request-lifecycle/execution-order.md#minimal-shapes) — `APP_PIPE` versus `useGlobalPipes`
- [Recipe: my nested DTO isn't being validated](../recipes/validation/nested-dto-not-validated.md)

## References

- [Validation](https://docs.nestjs.com/techniques/validation) — official docs
- [`packages/common/pipes/validation.pipe.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/common/pipes/validation.pipe.ts) — the constructor's `forbidUnknownValues: false`, the three return paths, `transformPrimitive`, `stripProtoKeys`, and `flattenValidationErrors`
- [nestjs/nest#10683](https://github.com/nestjs/nest/issues/10683) — the issue the `forbidUnknownValues` override cites
- [`class-validator` validator options](https://www.npmjs.com/package/class-validator) — the forwarded options

## Demo source

`demos/validation/` — the pipe configurations, the custom `exceptionFactory`, and the bypass reproduction.