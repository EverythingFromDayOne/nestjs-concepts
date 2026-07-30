# Cursor prompt — extend `demos/foundations` for articles 05–07

> Save as `prompts/extend-foundations-demo-rates-audit-config.md`. Paste everything below the line into Cursor as a single instruction.

---

You are extending the existing `demos/foundations` app so it compiles and runs every code sample in:

- `foundations/custom-providers-and-injection-tokens.md` (article 05)
- `foundations/scopes-and-lifetimes.md` (article 06)
- `foundations/configuration-and-environment.md` (article 07)

## The discipline, unchanged

Lift the code from the articles **verbatim**. Do not improve it, rename things, or reorder imports. A sample that doesn't compile or doesn't behave as claimed is a **finding to report**, not a thing to quietly repair.

- Smallest possible change for a green build; record every one in the divergence report.
- **Never edit a `.md` file.** Reconciliation happens separately, by hand.
- Where an article shows a broken version followed by a fixed one (marked `✗`), take the fixed one — except inside the experiments, which deliberately apply broken versions and revert.

## 1. Dependencies

Add to `demos/foundations`: `@nestjs/config@^4.0.4`, `class-validator`, `class-transformer`.

Report the resolved versions of all three.

## 2. New and changed source files

| File | Source |
| --- | --- |
| `src/rates/rates.tokens.ts` | article 05, Steps 1 + 5 — `RATE_TABLE`, `EXCHANGE_RATES`, `RateTable`, `RATE_SOURCE`, `RateSource` |
| `src/rates/rates.service.ts` | article 05, Step 1, injecting `EXCHANGE_RATES` per the Step 5 rename |
| `src/rates/rates.module.ts` | article 05, **Step 5** state: async factory for `EXCHANGE_RATES` + `useExisting` alias for `RATE_TABLE` |
| `src/rates/rates.service.spec.ts` | article 05, "Verify the loop" |
| `src/audit/audit.service.ts` | article 06, **Step 2** — the `Scope.REQUEST` version |
| `src/audit/audit.controller.ts` | article 06, Step 1 |
| `src/audit/audit.module.ts` | not in any article — see assembly note |
| `src/audit/contextual.logger.ts` | article 06, Step 4 |
| `src/audit/tenant.strategy.ts` | article 06, Step 5 |
| `src/audit/tenant-cache.service.ts` | article 06, Step 5 |
| `src/audit/scope-report.ts` | article 06, Step 3 |
| `src/audit/audit.service.spec.ts` | article 06, "Verify the loop" |
| `src/config/env.validation.ts` | article 07, Step 3 |
| `src/config/env.validation.spec.ts` | article 07, "Verify the loop" |
| `src/config/notifications.config.ts` | article 07, Step 4 |
| `.env`, `.env.local` | article 07, Step 2 |

### Assembly notes

**`AuditModule` is not shown in any article.** Write the obvious one: `AuditController` in `controllers`, and `AuditService`, `ContextualLogger`, `TenantCacheService`, `ScopeReport` in `providers`. Report it as a composition, not a lift.

**Article 07 supersedes article 01's hand-rolled config.** Delete `src/config/config.service.ts` and `src/config/config.module.ts`, and repoint every consumer — the notifications factory in `src/notifications/notifications.module.ts` and the rates factory — at `ConfigService` from `@nestjs/config`. The API shape (`config.get('KEY')`) is the same, so the factories should need no other change. **If they do need a change, that is a finding**: it means article 01's factory doesn't survive the migration article 07 describes, and I need to add a forward-pointer to article 01.

Register `ConfigModule.forRoot()` in `src/app.module.ts` per article 07 Step 4 (with `isGlobal`, `envFilePath`, `cache`, `validate`, and `load`), and add `RatesModule` and `AuditModule` to `imports`. Register `ContextIdFactory.apply(new TenantContextIdStrategy())` in `src/main.ts` **before** `NestFactory.create()`.

**`.gitignore` change required.** The root `.gitignore` ignores `.env`, but article 07's pattern is to commit `.env` with safe defaults and ignore `.env.local`. Add an exception so the demo's committed defaults are tracked:

```gitignore
!demos/*/.env
```

Keep `.env.local` ignored. Report this edit.

## 3. Build and test

```bash
pnpm install
pnpm --filter foundations-demo build
pnpm --filter foundations-demo test
```

All specs must pass. Report the output.

## 4. Experiments — article 05 (providers)

**A1 — async factory blocks the boot.** Time `NestFactory.create()` with the real rates factory, then temporarily make the factory `await` a 3-second delay before returning. Report both timings. **Expected:** boot time increases by ~3s — the article claims the container awaits the factory inside bootstrap. **Revert.**

**A2 — a rejecting async factory.** Make the factory `throw` instead. Record exactly what the process does: does it exit, log, or start and fail later? **Revert.**

**A3 — detection order.** Temporarily register `{ provide: SOME_TOKEN, useClass: A, useFactory: () => new B() }`. **Expected:** silently a class provider — `useClass` wins, no error. Report which instance you got. **Revert.**

**A4 — the `undefined` asymmetry.** Register `{ provide: T1, useValue: undefined }` and `{ provide: T2, useFactory: undefined }`, inject both with `@Optional()`. **Expected:** the first registers and injects `undefined`; the second isn't a provider at all and behaves as missing. Report the difference in behaviour, including any boot error. **Revert.**

**A5 — `useExisting` identity.** Inject both `EXCHANGE_RATES` and the `RATE_TABLE` alias into one service and assert `toBe` (not `toEqual`). Keep this as a spec.

## 5. Experiments — article 06 (scopes)

**B1 — the singleton state bug.** Temporarily make `AuditService` default-scoped, then:

```bash
curl localhost:3000/audit/demo & curl localhost:3000/audit/demo & wait
```

**Expected:** one response carries four events and the other none. Report both bodies. **Revert to `Scope.REQUEST`.**

**B2 — bubbling.** Add constructor `console.log`s to `AuditController`, `AuditService`, and one default-scoped service the controller also injects. Boot, then send two requests. Report how many times each constructor ran. **Expected:** the controller is constructed per request purely because it injects a request-scoped provider.

**B3 — the boot log.** Capture the lines Nest emits when it decides a provider is request-scoped (`printIntrospectedAsRequestScoped`). Paste them verbatim — the article claims they exist and are easy to miss, and I want the real wording.

**B4 — transient does not bubble.** With `ContextualLogger` injected into a default-scoped service, report: (a) how many `ContextualLogger` instances are constructed and when, and (b) whether its consumer is constructed per request. **Expected:** instances created at boot, one per injection site, and the consumer stays a singleton.

**B5 — effective scope.** Run `ScopeReport` and paste the output for every provider in the app, not just the two in the article. **Expected:** at least one provider reports `REQUEST` without carrying a scope option.

**B6 — the durable `REQUEST` swap.** With `TenantCacheService` durable and the strategy registered, log what `@Inject(REQUEST)` actually receives. **Expected:** `contextId.payload` (`{ tenantId }`), **not** the HTTP request — so `request.headers` would be `undefined`. This is the single most important claim in article 06; be precise.

**B7 — durable degradation.** Add one ordinary (non-durable) `Scope.REQUEST` dependency to `TenantCacheService`. **Expected:** no error, and the per-tenant caching silently stops. Instrument the constructor with a counter and drive the same tenant twice to prove it. **Revert.**

**B8 — `get` vs `resolve`.** Call `moduleRef.get(AuditService)` on the request-scoped service. Report the exact error. Then confirm `moduleRef.resolve(AuditService, contextId)` works.

## 6. Experiments — article 07 (config)

**C1 — envFilePath ordering.** Set `NOTIFY_MODE` in both `.env` and `.env.local` with different values, `envFilePath: ['.env.local', '.env']`. **Expected:** `.env.local` wins because it is **first** in the array. Report the resolved value.

**C2 — real env beats files.** With both files still set, run `NOTIFY_MODE=console pnpm --filter foundations-demo start`. **Expected:** `console` — `process.env` is spread last. Report the resolved value.

**C3 — cwd-relative resolution.** Remove `envFilePath` so the default applies, then start the app from the **repo root** rather than from `demos/foundations`. **Expected:** the `.env` file is not found. Report what happens — silent, or an error. **Revert.**

**C4 — validation failure output.** Delete `DATABASE_PASSWORD` from both env files and the shell. Paste the **complete** terminal output. **Expected:** a plain `Error` thrown during module evaluation, not a Nest bootstrap error — no `[Nest]` banner, no partially-started app. **Revert.**

**C5 — the `load` factory shadow.** Add a factory to `load` that returns a hard-coded `{ NOTIFY_MODE: 'console' }`, then set `NOTIFY_MODE=buffer` in the real environment. **Expected:** `config.get('NOTIFY_MODE')` returns `console` — internal config is checked before `process.env`. Report the result. **Revert.**

**C6 — defaults written back.** Give a validated variable a default in the schema, leave it unset in the environment, and log `process.env.THAT_KEY` after boot. **Expected:** the default has been written back into `process.env`. Then try the same with an **object-valued** default. **Expected:** the object does not make the trip. **Revert.**

**C7 — `getOrThrow` message.** Call `getOrThrow` on a key that doesn't exist and paste the exact error text.

## 7. Report

**Divergence table:**

| Article | Section | What broke | Minimal change made (or proposed) |
| --- | --- | --- | --- |

If nothing diverged, say so explicitly.

**Experiment results** — one line per experiment (A1–A5, B1–B8, C1–C7): claim verified, or what actually happened.

**Also report:**

- resolved versions of `@nestjs/config`, `class-validator`, `class-transformer`
- whether the article 01 config factories survived the migration unchanged
- the verbatim boot log from B3 and the verbatim outputs from C4 and C7
- anything ambiguous enough that you had to choose, and what you chose

## Out of scope

- No guards, interceptors, pipes, or filters.
- No database, Docker, or TypeORM.
- No e2e tests or `supertest`.
- No CI, linting, or Prettier setup.
- No edits to any `.md` file.