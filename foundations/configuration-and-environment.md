---
article_id: configuration-and-environment
concept_folder: foundations
wave: 1
nest_baseline: "11.1.x"
node_baseline: "24"
related:
  - foundations/custom-providers-and-injection-tokens
  - foundations/modules-and-the-module-graph
  - foundations/bootstrap-and-lifecycle-hooks
  - validation/dtos-and-class-validator
  - architecture/dynamic-modules
  - recipes/deployment/config-validated-too-late
status:
  drafted: true
  reviewed: false
v12_watch: false
---

# Configuration and environment

> **Lead with this.** Configuration is the only part of your application that is **untyped, unvalidated, and supplied by someone else** — a deploy pipeline, a container orchestrator, a colleague's `.env` file. TypeScript cannot help you here: `process.env.PORT` is `string | undefined` and every other guarantee you have is a comment. So the entire job is converting that at exactly one moment — boot — from an unknown bag of strings into a typed, validated object, and failing loudly if it can't. An app that starts successfully with a missing database password has not been configured; it has been armed.

## What it is

`@nestjs/config` (4.0.4 at this baseline) is a dynamic module wrapping `dotenv`. It does four things:

1. Reads one or more `.env` files and merges them with `process.env`.
2. Optionally **validates** the result, throwing at startup if it doesn't match.
3. Registers a `ConfigService` you inject to read values.
4. Optionally lets you define **namespaced, typed config objects** that are injectable in their own right.

The parts people underuse are 2 and 4. Reading `process.env` through a service instead of directly is a small win; failing the boot on a missing variable, and injecting a typed object instead of stringly-keyed lookups, are the ones that change how the application behaves in production.

> **If you know Angular.** `environment.ts` is a **compile-time** artifact: the values are baked into the bundle at build, the file is type-checked, and a missing property is a build error. Nest's configuration is **runtime** and comes from outside the program, so nothing type-checks it and nothing tells you it's missing until the code path runs — possibly weeks later. The habit that transfers badly is treating config as trustworthy because you can see it in a file. The one to build instead: validate it at boot, because that's the only moment where failing is cheap.

## How it works under the hood

### `forRoot()` runs early, but fails late

`ConfigModule.forRoot()` does its work when it's *called* — while your `@Module({ imports: [...] })` decorator argument is being evaluated. Reading the files, merging `process.env`, and validating all happen there, before any provider is constructed.

But `forRoot` is declared `async`, so a validation failure does not throw synchronously. It becomes a **rejected promise**, and the rejection is only observed when Nest awaits the dynamic module during scanning. Measured, that means you see this:

```
[Nest] LOG   [NestFactory] Starting Nest application...
[Nest] ERROR [ExceptionHandler] Error: An instance of EnvironmentVariables has failed the validation:
 - property DATABASE_PASSWORD has failed the following constraints: isString
    at Object.validateEnv (.../env.validation.ts:37:11)
    at ConfigModule.forRoot (...)
Exit status 1
```

So it *is* reported as a Nest bootstrap error, banner and all — but nothing was constructed, no route was bound, no lifecycle hook ran, and the process exits non-zero. The property that matters holds: the app never reaches a state where it could accept traffic.

### The merge order, which is not what most people assume

```typescript
// paraphrased from lib/config.module.ts — forRoot
const envFilePaths = Array.isArray(options.envFilePath)
  ? options.envFilePath
  : [options.envFilePath || resolve(process.cwd(), '.env')];

let config = options.ignoreEnvFile ? {} : this.loadEnvFile(envFilePaths, options);

if (!options.ignoreEnvVars && options.validatePredefined !== false) {
  config = { ...config, ...process.env };
}
```

Two facts, both easy to get backwards:

- **The default path is `process.cwd()/.env`** — resolved from the *working directory*, not from the file that calls `forRoot()`. Run the app from a monorepo root instead of the package directory and it finds nothing. Whether that's silent is up to you: with no validation the app starts with everything `undefined`; with validation it fails at boot naming the missing key. Another argument for §Step 3.
- **`process.env` is spread last, so real environment variables beat `.env` files.** This is what you want in production and what confuses people locally when a stale exported shell variable overrides the file they're editing.

And inside the file loader:

```typescript
// paraphrased — loadEnvFile
for (const envFilePath of envFilePaths) {
  if (fs.existsSync(envFilePath)) {
    config = Object.assign(dotenv.parse(fs.readFileSync(envFilePath)), config);
    // …expandVariables…
  }
}
```

Look at the `Object.assign` argument order: the newly parsed file is the **target**, the accumulated config is the **source**. So already-loaded values overwrite the new file's. **With `envFilePath: ['.env.local', '.env']`, the first entry wins.** Reading that array as "later overrides earlier", the way a cascade usually works, gets it exactly wrong.

### Validation happens at call time, and writes defaults back

```typescript
// paraphrased
if (options.validate) {
  const validatedConfig = options.validate(config);
  this.assignVariablesToProcess(validatedConfig);
} else if (options.validationSchema) {
  const { error, value: validatedConfig } = options.validationSchema.validate(config, validationOptions);
  if (error) throw new Error(`Config validation error: ${error.message}`);
  this.assignVariablesToProcess(validatedConfig);
} else {
  this.assignVariablesToProcess(config);
}
```

The `Error` is raised inside `forRoot`, which — as above — reaches you through `[ExceptionHandler]` during bootstrap rather than as a bare synchronous throw. The stack trace is the useful part: it names your validation function and the file it lives in, so the message points at the schema rather than at framework internals.

Then:

```typescript
// paraphrased — assignVariablesToProcess
const keys = Object.keys(config).filter(key => !(key in process.env));
keys.forEach(key => {
  const value = config[key];
  if (typeof value === 'string')       process.env[key] = value;
  else if (typeof value === 'boolean' || typeof value === 'number') process.env[key] = `${value}`;
});
```

Validated values — **including defaults your schema filled in** — are written back into `process.env`, but only for keys not already there. Real environment variables are never clobbered. Note also that only strings, booleans, and numbers make the trip; an object-valued default silently doesn't.

### `ConfigService.get()` checks four places in order

```typescript
// paraphrased from lib/config.service.ts — get
const internalValue = this.getFromInternalConfig(propertyPath);
if (!isUndefined(internalValue)) return internalValue;

const validatedEnvValue = this.getFromValidatedEnv(propertyPath);
if (!isUndefined(validatedEnvValue)) return validatedEnvValue;

if (!this._skipProcessEnv) {
  const processEnvValue = this.getFromProcessEnv(propertyPath, defaultValue);
  if (!isUndefined(processEnvValue)) return processEnvValue;
}
return defaultValue as T;
```

1. **Internal config** — everything from `load: [...]` factories and `registerAs` namespaces.
2. **Validated env** — the output of your `validate` function or Joi schema.
3. **`process.env`** — unless `skipProcessEnv` is set.
4. The default you passed.

The ordering matters more than it looks: a `load` factory that returns a hard-coded value **shadows the environment variable of the same name**, because internal config is consulted first. Factories should read from `process.env` themselves, not substitute for it.

`getOrThrow()` is `get()` plus a check, throwing `TypeError: Configuration key "X" does not exist` on `undefined`. Its real value is the type: it returns `Exclude<T, undefined>`, so the compiler stops making you handle an absence that would have crashed anyway.

## Basic usage

```bash
npm i @nestjs/config
```

```typescript
// src/app.module.ts
import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,                 // available everywhere without re-importing
      envFilePath: ['.env.local', '.env'],  // first match wins — see above
      cache: true,
    }),
  ],
})
export class AppModule {}
```

```typescript
// any provider
import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class MailService {
  private readonly host: string;

  constructor(private readonly config: ConfigService) {
    this.host = config.getOrThrow<string>('SMTP_HOST');
  }
}
```

`isGlobal: true` sets `global` on the dynamic module, which — per [article 02](./modules-and-the-module-graph.md#how-it-works-under-the-hood) — pushes it into every module's imports. Register it **once**, at the root: each `forRoot()` call returns a new object, and module identity is by reference, so a second call is a second module.

## Walkthrough — from `process.env` to a validated, typed object

`demos/foundations` has a hand-rolled `ConfigService` from [article 01](./providers-and-di.md), used by the notifications factory. We'll replace it, and each step fixes a specific failure mode.

### Step 1 — what's wrong with the hand-rolled version

```typescript
// src/config/config.service.ts — from article 01
@Injectable()
export class ConfigService {
  get(key: string): string | undefined {
    return process.env[key];
  }
}
```

Three problems, in increasing order of how much they cost:

1. **Nothing loads a `.env` file**, so local development means exporting variables by hand.
2. **Every value is `string | undefined`**, so every consumer either coerces or lies to the compiler.
3. **A missing variable is discovered at use time**, which for a rarely-hit code path means production, at 3am, in a request that fails for no visible reason.

### Step 2 — real loading, and the precedence surprises

```typescript
// src/app.module.ts
ConfigModule.forRoot({
  isGlobal: true,
  envFilePath: ['.env.local', '.env'],
  cache: true,
})
```

```bash
# .env — committed, safe defaults
NOTIFY_MODE=console
RATES_PROFILE=default
PORT=3000
# a placeholder, not a secret — real credentials come from the orchestrator.
# Step 3 makes this required, so the committed file has to carry something.
DATABASE_PASSWORD=demo-only-not-a-secret

# .env.local — gitignored, per-developer overrides
NOTIFY_MODE=buffer
```

`NOTIFY_MODE` resolves to `buffer`, because `.env.local` is **first** in the array and first wins. Now try the thing that catches everyone:

```bash
NOTIFY_MODE=console npm run start
# → console, not buffer
```

A real environment variable beats both files, always, because `process.env` is spread over the file config. That's correct for deployment and startling on a laptop where a variable was exported in a shell three days ago. `printenv NOTIFY_MODE` before debugging further.

`cache: true` is worth setting: it memoizes lookups so repeated `get()` calls don't re-walk `process.env`.

### Step 3 — fail the boot, not the request

This is the step that changes production behaviour. Validation with `class-validator`, which the corpus already uses for [DTOs](../validation/dtos-and-class-validator.md) — `npm i class-validator class-transformer` if they aren't installed yet:

```typescript
// src/config/env.validation.ts
import { plainToInstance } from 'class-transformer';
import {
  IsEnum, IsInt, IsOptional, IsString, IsUrl, Max, Min, validateSync,
} from 'class-validator';

enum NotifyMode {
  Console = 'console',
  Buffer = 'buffer',
}

class EnvironmentVariables {
  @IsEnum(NotifyMode)
  NOTIFY_MODE!: NotifyMode;

  @IsInt()
  @Min(1)
  @Max(65535)
  PORT!: number;

  @IsString()
  DATABASE_PASSWORD!: string;

  // optional on purpose: article 05's factory falls back to a static table
  // when this is absent, so the app is not required to have it
  @IsOptional()
  @IsUrl({ require_tld: false })
  RATES_URL?: string;
}

export function validateEnv(config: Record<string, unknown>): EnvironmentVariables {
  const validated = plainToInstance(EnvironmentVariables, config, {
    enableImplicitConversion: true, // "3000" → 3000
  });

  const errors = validateSync(validated, { skipMissingProperties: false });
  if (errors.length > 0) {
    throw new Error(errors.map((error) => error.toString()).join('\n'));
  }
  return validated;
}
```

```typescript
ConfigModule.forRoot({
  isGlobal: true,
  envFilePath: ['.env.local', '.env'],
  cache: true,
  validate: validateEnv,
})
```

Delete `DATABASE_PASSWORD` and the process exits non-zero with the property and the failing constraint named — measured output in the mechanism section above. Compare that against the alternative: a successful boot, a passing health check, a green deploy, and a failure hours later at the first database write.

Two mechanical details from the source that make this behave well:

- `enableImplicitConversion` matters because **everything arriving from the environment is a string**. Without it, `@IsInt()` on `PORT` fails against `"3000"`.
- The **returned object** is what gets written back into `process.env` (for keys not already set) and what `ConfigService` consults as validated env. So schema defaults become real values, which is why returning the validated instance rather than the raw input is not optional.

Joi is the documented alternative via `validationSchema`; the trade-off is one more dependency and one more schema language against a slightly terser definition. Using `class-validator` here means the same decorators, the same mental model, and the same error formatting as your request DTOs.

### Step 4 — typed, namespaced config

Stringly-typed lookups scattered across the app are the remaining problem. `registerAs` produces a namespace that is itself injectable:

```typescript
// src/config/notifications.config.ts
import { registerAs } from '@nestjs/config';

export default registerAs('notifications', () => ({
  mode: process.env.NOTIFY_MODE === 'buffer' ? ('buffer' as const) : ('console' as const),
  retries: Number(process.env.NOTIFY_RETRIES ?? 3),
}));
```

```typescript
// src/app.module.ts
ConfigModule.forRoot({
  isGlobal: true,
  envFilePath: ['.env.local', '.env'],
  cache: true,
  validate: validateEnv,
  load: [notificationsConfig],
})
```

```typescript
// src/notifications/notifications.service.ts
import { Inject, Injectable } from '@nestjs/common';
import { ConfigType } from '@nestjs/config';
import notificationsConfig from '../config/notifications.config';

@Injectable()
export class NotificationsService {
  constructor(
    @Inject(notificationsConfig.KEY)
    private readonly config: ConfigType<typeof notificationsConfig>,
  ) {}

  // this.config.mode is 'buffer' | 'console'; this.config.retries is number
}
```

`registerAs` attaches a `KEY` to the returned factory — the same `.KEY` convention [article 04](./decorators-and-metadata-reflection.md#how-it-works-under-the-hood) covered for `SetMetadata` — so the token travels with the config object and there's no string to keep in sync. `ConfigType<typeof …>` infers the shape from the factory's return, so adding a field to the factory types it everywhere immediately.

**The trap this introduces:** values from `load` factories land in *internal config*, which `get()` checks **first**. A factory returning a literal shadows the environment variable of the same name. Factories should read `process.env` — as above — not replace it.

### Step 5 — configuration where the module graph is built

The awkward case: another module's `forRoot()` needs config, but config is itself a module. `forRootAsync` exists for exactly this, and is an ordinary factory provider underneath ([article 05](./custom-providers-and-injection-tokens.md)):

```typescript
// hypothetical database module, shown for the shape
SomeModule.forRootAsync({
  imports: [ConfigModule],
  inject: [ConfigService],
  useFactory: (config: ConfigService) => ({
    host: config.getOrThrow<string>('DB_HOST'),
    port: config.getOrThrow<number>('DB_PORT'),
  }),
})
```

And the mistake this replaces:

```typescript
// ✗ evaluated when the file is imported — possibly before forRoot() ran
SomeModule.forRoot({ host: process.env.DB_HOST! })
```

A decorator argument is evaluated at module-definition time. If that file is imported before `ConfigModule.forRoot()` executes, `.env` hasn't been read and `process.env.DB_HOST` is `undefined` — with a non-null assertion cheerfully hiding it. The `!` is the tell: it's a promise about a value nothing has loaded yet.

### Verify the loop

Config is worth two tests, and they're both cheap.

**That validation actually rejects.** This is the test people skip, and it's the one that protects the property that matters:

```typescript
// src/config/env.validation.spec.ts
// `@nestjs/core` normally loads this for you; a spec that never boots Nest
// has to load it itself, or class-transformer sees no type metadata.
import 'reflect-metadata';
import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const valid = {
    NOTIFY_MODE: 'console',
    PORT: '3000',
    DATABASE_PASSWORD: 'hunter2',
    RATES_URL: 'http://localhost:9000/rates',
  };

  it('coerces and accepts a valid environment', () => {
    expect(validateEnv(valid).PORT).toBe(3000); // string → number
  });

  it('rejects a missing required variable', () => {
    const { DATABASE_PASSWORD, ...incomplete } = valid;
    expect(() => validateEnv(incomplete)).toThrow(/DATABASE_PASSWORD/);
  });

  it('rejects an out-of-range port', () => {
    expect(() => validateEnv({ ...valid, PORT: '70000' })).toThrow(/PORT/);
  });
});
```

**That consumers can be configured in a test**, without touching `process.env`:

```typescript
const moduleRef = await Test.createTestingModule({
  providers: [
    NotificationsService,
    { provide: notificationsConfig.KEY, useValue: { mode: 'buffer', retries: 1 } },
  ],
}).compile();
```

That second one is the payoff of Step 4: the namespace is a token, so it substitutes like any other provider.

## Real-world patterns

**Validate everything the app cannot run without, and nothing else.** A schema that lists forty optional variables stops being read. Required means: the process should not start without it.

**`getOrThrow()` for required values, `get()` with a default for genuinely optional ones.** Mixing them up produces the silent-degradation failure this whole article exists to prevent.

**Read config once, at construction.** Assigning to a `readonly` field in the constructor turns a runtime lookup into a startup one and gives the value a name and a type.

**Commit `.env` with safe defaults, gitignore `.env.local`.** New developers get a working app on clone; nobody's personal credentials travel. Secrets in production come from the orchestrator, not from a file.

**Never log the config object.** `console.log(process.env)` in a startup diagnostic is how credentials reach log aggregation. Log the *keys*, or a redacted shape.

**Namespace by feature, not by source.** `registerAs('notifications', …)` beats `registerAs('env', …)`. The namespace is the unit consumers inject, so it should match what a consumer needs.

**Keep `ConfigService` out of hot paths.** It's a lookup chain of up to four steps. `cache: true` helps, but a value read per request should be a field read at construction instead.

## API reference

| Symbol | Purpose |
| --- | --- |
| `ConfigModule.forRoot(options)` | loads, validates, and registers config; call **once**, at the root |
| `isGlobal` | makes the module global — still requires its exports, which it has |
| `envFilePath` | string or array; **first entry wins**; default `process.cwd()/.env` |
| `ignoreEnvFile` | skip files entirely — the usual production setting |
| `ignoreEnvVars` | don't merge `process.env` into the config |
| `validate` | a function taking the raw config and returning the validated object |
| `validationSchema` | a Joi schema; throws `Config validation error: …` on failure |
| `load` | array of factories whose results become **internal config**, checked first |
| `cache` | memoize lookups |
| `expandVariables` | `dotenv-expand` — allows `${OTHER_VAR}` inside values |
| `skipProcessEnv` | `get()` stops consulting `process.env` |
| `registerAs(ns, factory)` | namespaced config; the result carries `.KEY` |
| `ConfigType<typeof factory>` | the inferred type of a namespace |
| `config.get<T>(path, default?)` | internal → validated env → `process.env` → default |
| `config.getOrThrow<T>(path)` | as above, throwing `TypeError` on `undefined`; returns a non-optional type |
| `ConfigModule.forFeature(factory)` | register a namespace in a feature module |

## Common mistakes

**1. Reading `process.env` at module-definition time.**

```typescript
imports: [SomeModule.forRoot({ url: process.env.DB_URL! })]  // ✗ may be undefined
```

Decorator arguments evaluate on import, potentially before `forRoot()` has read any file. Use `forRootAsync` with `inject: [ConfigService]`.

**2. Expecting later env files to override earlier ones.** The accumulated config is assigned *over* each newly parsed file, so the **first** path in the array wins.

**3. Expecting `.env` to override a real environment variable.** It never does. `process.env` is merged last, and `assignVariablesToProcess` skips keys already present.

**4. `envFilePath` relative to the source file.** It's resolved from `process.cwd()`. Running from a monorepo root finds a different file, or none — and note that `pnpm --filter` sets the working directory to the package, so the bug hides under your usual command and appears in a container.

**5. Trusting `get<number>('PORT')`.** The generic is an assertion, not a conversion — you get the string `"3000"` typed as `number`. Coerce in a `load` factory or let validation convert it.

**6. Skipping validation because "it's just a couple of variables."** Every silent-config outage started with a couple of variables.

**7. A `load` factory returning a hard-coded value.** Internal config is checked first, so it shadows the environment variable of the same name — the opposite of what the deployer expects.

**8. Calling `forRoot()` in more than one module.** Each call returns a new object and module identity is by reference, so you get two config modules. Once, at the root.

**9. Using `get()` where the app cannot function without the value.** `undefined` flows onward and fails somewhere unrelated. `getOrThrow()` fails at the line that needed it.

**10. Logging or serialising the config object.** Secrets end up in logs, error trackers, and support tickets.

## How this evolved

The package is on 4.x and the direction has been toward failing earlier and typing more. `registerAs` plus `ConfigType` replaced stringly-typed `get()` calls with injectable typed objects; `getOrThrow()` added a return type that excludes `undefined`, so required config stops polluting call sites with null checks; and `validatePredefined` and `skipProcessEnv` gave finer control over whether the ambient environment participates at all. The stable core underneath — dotenv, merged with `process.env`, validated once at `forRoot()` — has not changed.

## Exercises

**1. Prove the precedence.** Set the same variable in `.env`, in `.env.local`, and in your shell, then predict which one `ConfigService` returns before running it. Then remove them one at a time. *Hint: two of the three rules run opposite to the intuition — array order and shell precedence.*

**2. Break the boot on purpose.** Add a required variable to the validation schema, remove it from the environment, and read the resulting output carefully. *Hint: it is not a Nest bootstrap error, and knowing what it looks like will save you ten minutes in a pipeline someday.*

**3. Make a config value injectable.** Convert one `config.get('SOME_KEY')` call into a `registerAs` namespace injected via `ConfigType`, then write a test that supplies a different value with `useValue`. *Hint: the token is `namespace.KEY`.*

## Summary

- `forRoot()` runs while your module decorator is evaluated — before the app exists. Validation failures are plain errors thrown at that moment, which is the point.
- Files are merged with **earlier `envFilePath` entries winning**, then `process.env` is spread over the result, so **real environment variables always beat files**.
- The default env path is `process.cwd()/.env`, not relative to the calling file.
- Validated output — including schema defaults — is written back to `process.env` for keys not already set; objects don't survive that trip.
- `get()` checks internal config → validated env → `process.env` → your default. A `load` factory therefore shadows an environment variable of the same name.
- `getOrThrow()` is the right default for anything the app can't run without; its return type excludes `undefined`.
- `registerAs` + `ConfigType` turns config into a typed, injectable, substitutable object — which is also what makes it testable.

## See also

- [Custom providers and injection tokens](./custom-providers-and-injection-tokens.md) — `forRootAsync` is a factory provider
- [Modules and the module graph](./modules-and-the-module-graph.md#how-it-works-under-the-hood) — why `forRoot()` is called exactly once
- [Bootstrap and lifecycle hooks](./bootstrap-and-lifecycle-hooks.md) — what runs after configuration is resolved
- [DTOs and class-validator](../validation/dtos-and-class-validator.md) — the same decorators, applied to requests
- [Dynamic modules](../architecture/dynamic-modules.md) — building your own `forRoot`/`forRootAsync`
- [Recipe: config validated too late](../recipes/deployment/config-validated-too-late.md)

## References

- [Configuration](https://docs.nestjs.com/techniques/configuration) — official docs
- [`@nestjs/config` 4.0.4 on npm](https://www.npmjs.com/package/@nestjs/config)
- [`lib/config.module.ts` @ 4.0.4](https://github.com/nestjs/config/blob/4.0.4/lib/config.module.ts) — merge order, `loadEnvFile`, `assignVariablesToProcess`
- [`lib/config.service.ts` @ 4.0.4](https://github.com/nestjs/config/blob/4.0.4/lib/config.service.ts) — the four-step `get()` chain and `getOrThrow`

## Demo source

`demos/foundations/` — replaces the hand-rolled `config/` from article 01.