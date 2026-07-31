---
article_id: serialization-and-response-shaping
concept_folder: validation
wave: 2
nest_baseline: "11.1.x"
node_baseline: "24"
related:
  - validation/dtos-and-class-validator
  - validation/validationpipe-in-depth
  - request-lifecycle/interceptors
  - request-lifecycle/execution-order
  - foundations/typescript-for-nest
  - recipes/validation/password-leaked-in-the-response
status:
  drafted: true
  reviewed: false
v12_watch: true
---

# Serialization and response shaping

> **Lead with this.** Serialization is the direction where a mistake leaks data rather than rejecting it, and `@Exclude()` gives a false sense of safety in three measured ways. It works on **class instances** — a handler returning a plain object literal gets no filtering at all. It does **not descend into plain nested objects**: measured, a `@Exclude()`-free nested object came out with its `password` field intact even though the parent class was fully annotated. And **`groups` filter twice**, on the way in as well as the way out, so a field can be destroyed by `plainToInstance` before the serializer ever gets a chance to expose it. The default posture is a denylist — everything is exposed unless you say otherwise — which is the wrong default for a boundary where the failure mode is disclosure.

## What it is

`ClassSerializerInterceptor` runs `class-transformer` over whatever your handler returned, on the way out. `class-transformer`'s decorators decide what survives:

| Decorator | Effect |
| --- | --- |
| `@Exclude()` | drop this property from output |
| `@Expose()` | include it — and, under `excludeExtraneousValues`, the **only** way anything is included |
| `@Expose({ groups })` | include only when the serializer is called with a matching group |
| `@Transform(fn)` | rewrite the value on the way out |
| `@Type(() => X)` | construct a nested class so its own rules apply |

This is the mirror of [article 16](./dtos-and-class-validator.md), and the mirror is not symmetric: inbound work is about **rejecting**, outbound work is about **withholding**. Those need different classes, which §Real-world patterns argues for directly.

> **If you know Angular.** There is no analogue, and the absence is the point. Angular shapes what it *displays* — pipes, `*ngIf`, a view model — and the data has already arrived in the browser, so a field you didn't render is still in the network tab. Serialization here decides what **leaves the process**. The instinct to drop is "I'll just not show it": on a server, not showing it and not sending it are entirely different acts, and only one of them is a security property.

## How it works under the hood

### The interceptor is twelve lines

```typescript
// paraphrased from packages/common/serializer/class-serializer.interceptor.ts
intercept(context: ExecutionContext, next: CallHandler): Observable<any> {
  const contextOptions = this.getContextOptions(context);
  const options = { ...this.defaultOptions, ...contextOptions };
  return next.handle().pipe(map((res) => this.serialize(res, options)));
}

serialize(response, options) {
  if (!isObject(response) || response instanceof StreamableFile) {
    return response;                                    // ← primitives and streams pass through
  }
  return Array.isArray(response)
    ? response.map((item) => this.transformToPlain(item, options))
    : this.transformToPlain(response, options);
}

transformToPlain(plainOrClass, options) {
  if (!plainOrClass) return plainOrClass;
  if (!options.type) return classTransformer.classToPlain(plainOrClass, options);
  if (plainOrClass instanceof options.type) return classTransformer.classToPlain(plainOrClass, options);
  const instance = classTransformer.plainToInstance(options.type, plainOrClass, options);
  return classTransformer.classToPlain(instance, options);   // ← the escape hatch
}

protected getContextOptions(context) {
  return this.reflector.getAllAndOverride(CLASS_SERIALIZER_OPTIONS, [
    context.getHandler(), context.getClass(),
  ]);
}
```

Four things worth pulling out.

- **It's an interceptor**, so everything from [article 12](../request-lifecycle/interceptors.md) applies: it runs in the post-phase, it never sees a request a guard rejected, and its position relative to other interceptors matters — §Step 5.
- **`StreamableFile` is skipped explicitly**, along with primitives. A handler returning a string or a file stream is untouched.
- **Arrays are mapped element-wise**, so a returned `User[]` is serialized per element. Nothing special needed.
- **`options.type` is an escape hatch most people don't know exists.** With `@SerializeOptions({ type: SomeDto })`, a response that *isn't* an instance of that type is first run through `plainToInstance` and only then serialized. That is the documented fix for the plain-object problem below.

`getContextOptions` uses `getAllAndOverride([handler, class])`, so `@SerializeOptions()` on a method overrides one on the controller — the precedence rule from [article 04](../foundations/decorators-and-metadata-reflection.md#how-it-works-under-the-hood).

### Measured: what actually gets stripped

One annotated class, one payload, four option sets. All measured on `class-transformer@0.5.1`:

```typescript
class Profile { @Expose() city!: string; @Exclude() secretNote!: string; }

class User {
  @Expose() id!: number;
  @Exclude() password!: string;
  @Expose({ groups: ['admin'] }) internalScore!: number;
  @Type(() => Profile) profile!: Profile;
  nested!: { password: string };                    // ← plain, no @Type
  @Expose() get display(): string { return `#${this.id}`; }
}
```

| Call | Output |
| --- | --- |
| `instanceToPlain(instance)` | `{ id, profile: { city }, nested: { password }, display }` |
| `instanceToPlain(instance, { excludeExtraneousValues: true })` | `{ id, display }` |
| `instanceToPlain(plainPayload)` | **everything, unfiltered** |

Read the first row twice. `password` is gone, `profile.secretNote` is gone, the `@Expose()`d getter is present — and **`nested.password` came through**. A plain nested object is copied wholesale, because there is no class for `class-transformer` to look rules up on. The parent being fully annotated buys nothing for its plain children.

The third row is the same fact at the top level: hand `class-transformer` a plain object and nothing is filtered. The `@Exclude()` on `User.password` is irrelevant if the handler returned an object literal — which is what happens with a raw ORM query, a hand-built mapper, or a `select` that returns rows rather than entities.

The second row is the fix and it changes the model: `excludeExtraneousValues: true` is an **allowlist**. Only `@Expose()`d properties survive. Note what disappeared — `profile`, despite its `@Type()`, because it has no `@Expose()`; and `nested`, which closes the leak by construction rather than by vigilance.

### Measured: `groups` filter on the way in, too

This one is genuinely surprising. Four combinations against `@Expose({ groups: ['admin'] }) internalScore`:

| Instance built | Serialized | `internalScore` |
| --- | --- | --- |
| `plainToInstance(User, raw)` — no groups | with `{ groups: ['admin'] }` | **absent** |
| `plainToInstance(User, raw, { groups: ['admin'] })` | with `{ groups: ['admin'] }` | present |
| `plainToInstance(User, raw, { groups: ['admin'] })` | no groups | absent |
| `new User()` + `Object.assign` | with `{ groups: ['admin'] }` | present |

Row 1 is the trap: the group filter runs during `plainToInstance` as well, so a field built without the group **was never on the instance** and no serialization option can resurrect it. Row 4 is the reassurance: an entity populated directly — which is how a TypeORM entity actually arrives, by assignment rather than by `plainToInstance` — only pays the output filter, and group exposure behaves as expected.

Where row 1 bites: any mapper that round-trips through `plainToInstance`, and anything that has already been through `ValidationPipe` with `transform: true` ([article 17](./validationpipe-in-depth.md)). If group-gated fields are mysteriously missing for a user who should see them, look at where the instance was built, not at the serializer.

## Minimal shapes

```typescript
// denylist — the default. Exposed unless excluded.
export class User {
  id!: number;
  @Exclude() password!: string;
}

// allowlist — safer, and more typing.
@Exclude()                                       // class-level: nothing by default
export class UserResponseDto {
  @Expose() id!: number;
  @Expose() email!: string;
}

// binding
providers: [{ provide: APP_INTERCEPTOR, useClass: ClassSerializerInterceptor }]   // global
@UseInterceptors(ClassSerializerInterceptor)                                     // controller/route

// options, method beats controller
@SerializeOptions({ excludeExtraneousValues: true, groups: ['admin'] })
@Get()
list(): UserResponseDto[] { /* … */ }
```

## Walkthrough — closing the three holes

We continue `demos/validation/`.

### Step 1 — the leak, reproduced

```typescript
// src/users/user.entity.ts
import { Exclude } from 'class-transformer';

export class User {
  id!: number;
  email!: string;
  @Exclude() password!: string;
  meta!: { lastPasswordHash: string };      // plain nested — no class, no @Type
}
```

```typescript
@Get(':id')
findOne(@Param('id') id: string): User {
  return this.users.findOne(id);            // a real User instance
}
```

With the serializer registered, `password` is gone from the response — and `meta.lastPasswordHash` is not. Measured behaviour, not a hypothetical: the nested object is plain, so no rules exist for it, so it is copied through.

Two ways to close it, and they're not equivalent:

```typescript
// ✓ give the nested object a class, so its own rules apply
import { Exclude, Type } from 'class-transformer';

class UserMeta {
  @Exclude() lastPasswordHash!: string;
}

export class User {
  // …
  @Type(() => UserMeta) meta!: UserMeta;
}
```

```typescript
// ✓✓ or flip to an allowlist and stop enumerating what to hide
@Exclude()
export class UserResponseDto {
  @Expose() id!: number;
  @Expose() email!: string;
}
```

The first fixes this field. The second fixes the category. §Step 3 argues for the second.

### Step 2 — the plain-object hole

```typescript
// ✗ nothing is filtered — the handler returned an object literal
@Get('summary')
summary(): unknown {
  return { id: 1, email: 'a@b.c', password: 'hunter2' };
}
```

```typescript
// ✗ also unfiltered — a raw query returns rows, not entities
@Get('report')
async report(): Promise<unknown> {
  return this.dataSource.query('select * from users');
}
```

`class-transformer` has no metadata for `Object`, so `@Exclude()` anywhere else in your codebase is irrelevant here. Three fixes, in increasing order of how much they protect:

```typescript
// (a) construct the class before returning — `plainToInstance` from class-transformer
return plainToInstance(UserResponseDto, row, { excludeExtraneousValues: true });

// (b) tell the serializer what to build — the escape hatch from the source
@SerializeOptions({ type: UserResponseDto, excludeExtraneousValues: true })
@Get('report')
async report(): Promise<unknown> { return this.dataSource.query('…'); }

// (c) type the handler's return as the DTO and let review catch the mismatch
async report(): Promise<UserResponseDto[]> { /* … */ }
```

(b) is the one worth knowing about: `transformToPlain` sees the response isn't an instance of `options.type`, runs `plainToInstance` first, and then serializes — so a raw row is upgraded into your response DTO before anything leaves. It's per-handler and explicit, which is right for the handful of endpoints that legitimately return raw rows.

(c) is not a protection at all — a `Promise<UserResponseDto[]>` annotation is [erased](../foundations/typescript-for-nest.md#the-erasure-ledger), and nothing checks that the rows match. It's a comment that reviewers might read.

### Step 3 — allowlist, and what it costs

```typescript
// src/users/dto/user-response.dto.ts
import { Exclude, Expose, Transform, Type } from 'class-transformer';

@Exclude()
export class AddressResponseDto {
  @Expose() city!: string;
  @Expose() country!: string;
}

@Exclude()
export class UserResponseDto {
  @Expose() id!: number;
  @Expose() email!: string;

  @Expose()
  @Transform(({ value }) => (value as Date).toISOString())
  createdAt!: Date;

  @Expose()
  @Type(() => AddressResponseDto)
  address!: AddressResponseDto;

  @Expose({ groups: ['admin'] })
  internalNotes?: string;
}
```

```typescript
@SerializeOptions({ excludeExtraneousValues: true })
@Controller('users')
export class UsersController {}
```

Class-level `@Exclude()` and `excludeExtraneousValues: true` overlap — either alone produces an allowlist. Using both is deliberate belt-and-braces: the decorator makes the intent visible in the file, the option makes it true even if someone binds the serializer without reading the class.

The argument for paying this cost: with a denylist, a new column on an entity is **exposed by default**, so the failure mode of forgetting is disclosure. With an allowlist, forgetting means a field is missing — a bug report, not an incident. Adding a column to a table should not be able to publish it.

The costs, stated:

- **Every field is typed twice**, once on the entity and once on the response DTO.
- **`@Expose()` is required on nested properties too**, not just `@Type()` — measured, `profile` vanished without it, and that surprises people once each.
- **A separate class per response shape** — sometimes several per entity, which is the point but is also more files.

`@Transform()` is where date and money formatting belongs, so that every consumer gets the same representation instead of each handler formatting its own.

### Step 4 — groups, and where they actually apply

```typescript
@Get(':id')
@SerializeOptions({ excludeExtraneousValues: true })
findOne(@CurrentUser() actor: AuthUser, @Param('id') id: string) {
  return this.users.findOne(id);          // @CurrentUser() is the param decorator from article 04
}
```

To vary exposure by role, the group has to reach the serializer, and `@SerializeOptions()` is static metadata. Two honest options:

```typescript
// (a) a second route with its own options — explicit, duplicated
@SerializeOptions({ excludeExtraneousValues: true, groups: ['admin'] })
@Get(':id/admin')
findOneAsAdmin(@Param('id') id: string) { /* … */ }
```

```typescript
// (b) serialize in the handler, where the actor is known
@Get(':id')
async findOne(@CurrentUser() actor: AuthUser, @Param('id') id: string): Promise<unknown> {
  const user = await this.users.findOne(id);
  return instanceToPlain(user, {
    excludeExtraneousValues: true,
    groups: actor.roles.includes('admin') ? ['admin'] : [],
  });
}
```

(b) trades the interceptor's uniformity for per-request accuracy. Choose it when exposure genuinely depends on the caller, and keep it to those routes — the moment two handlers do this, extract a small mapper so the group logic lives in one place.

And the measured caveat that ruins an afternoon otherwise: **if the instance was built with `plainToInstance` without the group, the field is already gone.** Row 1 of the table above. An entity from the ORM is fine because it's populated by assignment; a mapper that round-trips through `plainToInstance` is not.

### Step 5 — interceptor order, and the envelope collision

[Article 12](../request-lifecycle/interceptors.md#step-2--a-response-envelope-and-what-it-costs) built a global envelope interceptor that maps `data` into `{ data, meta }`. Combine the two and order decides whether serialization happens at all:

```typescript
providers: [
  { provide: APP_INTERCEPTOR, useClass: EnvelopeInterceptor },          // outer
  { provide: APP_INTERCEPTOR, useClass: ClassSerializerInterceptor },   // inner
]
```

Declaration order is application order, and the post-phase unwinds inside-out — so the **serializer runs first** on the raw handler result, which is the instance, and the envelope then wraps the already-plain object. That's the order you want.

Reverse them and the serializer receives `{ data: instance, meta }` — a plain object wrapper. Given the measured behaviour that plain containers are copied through without their children's rules being applied, this is the arrangement most likely to leak, and it's the one you get by adding the serializer second. **I have not measured this exact case**, so treat it as the reason to fix the order rather than as a description of the leak: put the serializer innermost and the question doesn't arise.

`@RawResponse()`-style opt-outs from article 12 apply here too — a file download or a fixed-contract webhook response wants neither wrapper.

### Verify the loop

Serialization is testable without HTTP, and the test that matters is the negative one:

```typescript
// src/users/dto/user-response.dto.spec.ts
import 'reflect-metadata';
import { instanceToPlain, plainToInstance } from 'class-transformer';
import { UserResponseDto } from './user-response.dto';

const raw = {
  id: 1, email: 'a@b.c', password: 'hunter2',
  createdAt: new Date('2026-01-01'),
  address: { city: 'HCMC', country: 'VN', internalCode: 'X' },
  internalNotes: 'private',
};

const serialize = (groups: string[] = []): Record<string, unknown> =>
  instanceToPlain(plainToInstance(UserResponseDto, raw, { groups }), {
    excludeExtraneousValues: true,
    groups,
  }) as Record<string, unknown>;

describe('UserResponseDto', () => {
  it('exposes only allowlisted fields', () => {
    expect(Object.keys(serialize()).sort()).toEqual(['address', 'createdAt', 'email', 'id']);
  });

  it('never exposes password, at any nesting level', () => {
    expect(JSON.stringify(serialize())).not.toContain('hunter2');
    expect(JSON.stringify(serialize(['admin']))).not.toContain('hunter2');
  });

  it('gates internalNotes behind the admin group', () => {
    expect(serialize()).not.toHaveProperty('internalNotes');
    expect(serialize(['admin'])).toHaveProperty('internalNotes');
  });
});
```

The second test is the one to copy into every response DTO spec: **assert on the serialized string, not on property names.** A key-based assertion passes when a secret hides one level deeper; a substring assertion on the JSON catches it wherever it is. Note the helper passes `groups` to *both* calls, per the measured double filter.

Then confirm the wire format once:

```bash
curl -s localhost:3000/users/1 | jq
curl -s localhost:3000/users/report | jq       # the raw-query route — check it's shaped
curl -s localhost:3000/users/1 | grep -c hunter2   # expect 0
```

## Real-world patterns

**Separate classes for in and out.** An inbound DTO rejects; an outbound DTO withholds. When `@Exclude()` appears on a class that also carries `@IsString()`, the two jobs have been conflated and the entity is now the API.

**Allowlist by default** — class-level `@Exclude()` plus `@Expose()` per field, with `excludeExtraneousValues: true`. Forgetting then hides a field instead of publishing one.

**Never serialize an entity directly.** An ORM entity's shape is a database concern; a new column should not be able to become a public field.

**Give every nested object a class.** Plain nested objects are copied through with no filtering — measured. This is the leak that survives a careful review of the parent.

**Assert on the serialized JSON string** in tests, not on key lists.

**`@Transform()` for representation** — dates, money, enums — so consumers get one format rather than per-handler improvisation.

**Register the serializer innermost** among global interceptors, so it sees the handler's instance rather than another interceptor's wrapper.

**Group-based exposure needs the group at build time and at serialize time.** If the instance came from the ORM you only pay the output filter; if it went through `plainToInstance`, pass the groups there too.

**`disableErrorMessages` has a sibling problem here:** hiding fields is not the same as hiding their existence. If a field's presence is itself sensitive, a different response shape — not `@Exclude()` — is the answer.

## API reference

| Symbol | From | Purpose |
| --- | --- | --- |
| `ClassSerializerInterceptor` | `@nestjs/common` | runs `class-transformer` over the response |
| `@SerializeOptions(options)` | `@nestjs/common` | per-controller or per-handler options; **method overrides class** |
| `@Exclude()` | `class-transformer` | on a property, drop it; on a class, drop everything not `@Expose()`d |
| `@Expose({ groups?, name? })` | `class-transformer` | include; rename; gate by group |
| `@Transform(({ value, obj }) => …)` | `class-transformer` | rewrite the outgoing value |
| `@Type(() => X)` | `class-transformer` | construct a nested class so **its** rules apply |
| `excludeExtraneousValues` | option | allowlist mode — only `@Expose()`d properties survive |
| `groups` | option | applies on `plainToInstance` **and** `instanceToPlain` |
| `strategy: 'excludeAll'` | option | equivalent of class-level `@Exclude()` |
| `excludePrefixes` | option | drop properties by name prefix, e.g. `_` |
| `instanceToPlain(obj, options)` | `class-transformer` | serialize by hand, when the actor decides the shape |
| `StreamableFile` | `@nestjs/common` | skipped by the serializer — file responses pass through |

## Common mistakes

**1. Returning a plain object and expecting `@Exclude()` to apply.** There's no metadata for `Object`. Construct the class, or use `@SerializeOptions({ type })`.

**2. Assuming annotations protect nested plain objects.** Measured: a plain nested object is copied through with its secrets. Give it a class.

**3. Serializing the entity.** Adding a database column then publishes a field. Use a response DTO.

**4. Denylist by default.** The failure mode of forgetting is disclosure. Flip to allowlist.

**5. `@Type()` without `@Expose()` under `excludeExtraneousValues`.** The property disappears entirely — measured.

**6. Expecting `groups` at serialize time to be enough.** They filter on `plainToInstance` too; a field built without the group is already gone.

**7. Registering the serializer outside a response-shaping interceptor.** It then sees a wrapper rather than your instance.

**8. Testing with `expect(Object.keys(...))`.** Passes while a secret hides one level down. Assert on the JSON string.

**9. One class for request and response.** `@IsString()` and `@Exclude()` on the same class means the entity is the contract.

**10. Forgetting the serializer is an interceptor.** It doesn't run for guard-rejected requests, and error responses are shaped by [filters](../request-lifecycle/exception-filters.md), not by it — so an `@Exclude()`d field can still surface in an error body.

## How this evolved

The interceptor has been stable; the interesting detail is `options.type`, which turns it from "serialize whatever you're given" into "build this class, then serialize" and makes raw rows safe to return from a specific handler. `StreamableFile` was carved out explicitly so file responses aren't mangled. And `class-transformer` renamed `classToPlain`/`plainToClass` to `instanceToPlain`/`plainToInstance` in 0.4 — the old names are still exported and still used inside Nest's own interceptor, which is why both spellings appear in examples across the internet.

Nest 12's schema-first direction reaches this layer too: a serializer driven by a Standard Schema rather than by class metadata would sidestep the plain-object hole entirely, since a schema is a runtime value and doesn't need the response to be an instance of anything. Re-verify at GA.

## Exercises

**1. Leak on purpose.** Put a secret one level deep in a plain nested object on a fully annotated class, serialize, and find it in the output. Then give the nested object a class. *Hint: the parent's annotations look complete throughout.*

**2. Flip the default.** Convert a denylist response class to class-level `@Exclude()` plus `@Expose()`, then add a new field to the entity and observe that it does *not* appear. *Hint: that non-appearance is the feature.*

**3. Lose a group field before serialization.** Build an instance with `plainToInstance` and no groups, then serialize with `{ groups: ['admin'] }` and look for the gated field. *Hint: no serialize option can bring it back.*

## Summary

- `ClassSerializerInterceptor` maps the response through `class-transformer`; primitives and `StreamableFile` pass through, arrays are mapped element-wise.
- **Plain objects aren't filtered** — no metadata exists for `Object`. `@SerializeOptions({ type })` upgrades them via `plainToInstance` first.
- **Plain nested objects aren't filtered either** — measured, `nested.password` survived a fully annotated parent.
- `excludeExtraneousValues: true` is an **allowlist**: only `@Expose()`d properties survive, which closes the nested hole by construction — and requires `@Expose()` on nested properties too.
- **`groups` filter twice**, on `plainToInstance` and on `instanceToPlain`. A field built without the group cannot be exposed later. ORM-populated entities only pay the output filter.
- `@SerializeOptions()` resolves with `getAllAndOverride([handler, class])`, so method beats controller.
- Register the serializer **innermost** among global interceptors so it sees the instance, not a wrapper.
- Test by asserting on the serialized JSON **string**; key-based assertions miss nested leaks.

## See also

- [DTOs and class-validator](./dtos-and-class-validator.md) — the inbound mirror, and why the classes should be different
- [ValidationPipe in depth](./validationpipe-in-depth.md) — `transform: true`, which builds the instances this article serializes
- [Interceptors](../request-lifecycle/interceptors.md#step-2--a-response-envelope-and-what-it-costs) — the envelope this one has to run inside
- [Execution order](../request-lifecycle/execution-order.md#how-it-works-under-the-hood) — why the post-phase unwinds inside-out
- [Exception filters](../request-lifecycle/exception-filters.md) — error bodies, which the serializer never touches
- [TypeScript for Nest](../foundations/typescript-for-nest.md#the-erasure-ledger) — why a return-type annotation protects nothing
- [Recipe: a password leaked in the response](../recipes/validation/password-leaked-in-the-response.md)

## References

- [Serialization](https://docs.nestjs.com/techniques/serialization) — official docs
- [`packages/common/serializer/class-serializer.interceptor.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/common/serializer/class-serializer.interceptor.ts) — `serialize`, the `StreamableFile` carve-out, and the `options.type` escape hatch
- [`class-transformer` on npm](https://www.npmjs.com/package/class-transformer) — `@Exclude`, `@Expose`, `@Transform`, `excludeExtraneousValues`, groups

## Demo source

`demos/validation/` — the response DTOs, the raw-query route with `@SerializeOptions({ type })`, and the leak specs.