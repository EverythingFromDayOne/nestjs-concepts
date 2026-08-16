# `nestjs-concepts` — progress

Live tracker. The stable plan is `roadmap.md`.

**Legend:** ✅ complete · 🟢 drafted · 🟡 in progress · ⚪ queued · ❌ dropped

Frontmatter `status` is an object of two booleans; the emoji here is the tracker view. 🟢 = `drafted: true, reviewed: false`. ✅ = `reviewed: true` **and** anchors verified.

The `#` column is write order, not identity. Identity is the slug `article_id` / `recipe_id`, which always equals the filename.

**Baseline:** Nest `11.1.x` · Node 24 LTS · Express 5 · TypeORM `1.1.x` · PostgreSQL 18 · Jest · TypeScript strict

**Confirmed by build** (2026-07-29, `demos/foundations`): `@nestjs/core@11.1.28`, `typescript@5.9.3`.

---

## Snapshot

| | Articles | Recipes |
| --- | --- | --- |
| ✅ complete | 0 | 0 |
| 🟢 drafted | 20 | 0 |
| 🟡 in progress | 0 | 0 |
| ⚪ queued | 34 | — |

Total is now 54: 53 planned plus article 00, the TypeScript prerequisite.

**`validation/` draft-complete (16–18).** `data/` open at 19 — the ORM-agnostic block runs 19–24 before any TypeORM specifics.

**Wave 1 draft-complete (01–15).** Wave 2 open: `validation/` started at 16.

**`foundations/` is draft-complete (01–08).** `request-lifecycle/` open at 09.

Scaffold prompt written and handed to Cursor; repo not yet created. Articles 01–02 drafted. `scripts/check-links.py` reports 12 forward references across the two — all to queued files, all expected.

---

## Wave 1 — the spine

### `foundations/`

| # | Article | Status | Notes |
| --- | --- | --- | --- |
| 00 | `typescript-for-nest.md` | 🟢 | **Prerequisite**, written after 17 (hence `write_order: 00`). Counterpart to `angular-concepts`' `typescript-prereqs.md`, but a different article: Angular's is a primer, this one's spine is that **erasure is a runtime property in Nest** because the framework reflects at bootstrap. Reuses measurements from 04/13/16/17 and adds new ones: Node's strip-only mode rejects **parameter properties** (`ERR_UNSUPPORTED_TYPESCRIPT_SYNTAX`) — so `node service.ts` can't run idiomatic Nest — and `enum`; `verbatimModuleSyntax` is **incompatible with `module: commonjs`** (TS1295), so the flag that would enforce `import type` is unavailable on this baseline; the `declare global { namespace Express }` augmentation compiles clean under strict with `@types/express@5`. Headline trap: **`import type` on an injected class breaks DI** |
| 01 | `providers-and-di.md` | 🟢 | Anchor article. Token-vs-type as the spine. Under-the-hood traced to v11.1.28 source (`reflectConstructorParams` paramtypes + `@Inject()` index overlay; `lookupComponent` → own providers → imports requiring providers **and** exports → deeper only through re-exports; per-context instance caching). Walkthrough = notification transport swapped by symbol token across 5 steps, ending in `NEST_DEBUG` + a substitution test. Self-audit added the `ConfigService`/`ConfigModule` stand-in that Step 4 was eliding. `v12_watch: true` — depends on `emitDecoratorMetadata`. Stops at the scope boundary and hands off to 06 · **Code verified** — every sample compiles and runs in `demos/foundations`. Reconciled: `METRICS_SINK` was prose-only, now a real tokens-file block |
| 02 | `modules-and-the-module-graph.md` | 🟢 | Visibility boundary + identity as the two-part spine. Under-the-hood verified against v11.1.28: module token from `ModuleCompiler.compile` and dedupe in `addModule`; `ByReferenceModuleOpaqueKeyFactory` caches the id **on the object reference**, so a static module is one instance but every `forRoot()` call is a new one; `_exports` is one flat Set holding provider tokens *and* module classes; `validateExportedProvider` rejects exporting what you neither provide nor import; `bindGlobalsToImports` literally pushes a global module into every module's imports, so `@Global()` still needs `exports`. Walkthrough = ledger/orders/billing graph broken and fixed five ways, incl. the silent duplicate-registration bug · **Code verified**, incl. the Step 3 claim reproduced empirically (duplicate registration boots, balance returns 0). Reconciled: Step 4 snippets were missing import lines; Step 3 rewritten — keeping `imports: [LedgerModule]` *and* registering locally still yields 0, because own `providers` are checked first. Sharper than the original claim |
| 03 | `controllers-and-routing.md` | 🟢 | Spine: there is no routing table — precedence is an emergent property of method declaration order. Verified against v11.1.28: `@Get()` writes PATH/METHOD metadata onto `descriptor.value` (the function, not the class); `PathsExplorer` + `MetadataScanner.getAllMethodNames` walk `Object.getOwnPropertyNames` so declaration order = registration order (inherited methods last); registration is plain `router.get(path, handler)`, so Express first-match-wins. Express 5 named wildcards verified against Express + path-to-regexp docs (captured as **arrays** of segments; braced form omits the param when absent). Walkthrough = five silent routing failures; verification beat is reading the `Mapped {…}` boot log as the routing table · **Code verified, two claims corrected.** (1) Wildcard brace placement was wrong: `docs/{*splat}` requires a trailing slash; the inclusive form is `docs{/*splat}` — slash *inside* the braces. Measured against path-to-regexp 8.4.2 and now a 3×3 table in the article. (2) `@Res()` does **not** make `@Header`/`@HttpCode` inert — `setStatus`/`setHeaders` run unconditionally in `router-execution-context.ts`; only the body-send is gated by `isResponseHandled`. This contradicts the official docs, which is stated in the article. |
| 04 | `decorators-and-metadata-reflection.md` | 🟢 | Spine: decorators annotate, the framework behaves — the only questions are *what key* and *onto what target*. **Behaviour measured, not recalled**: ran TS 5.9.3 + reflect-metadata 0.2.2 experiments for decorator evaluation/application order (members before class; expressions top-down, functions bottom-up; params right-to-left), the three emitted `design:*` keys, interface→`Object` erasure, undecorated-class→`undefined` (a *different* bug), and prototype-chain metadata inheritance. Source-verified `SetMetadata`'s descriptor branch + `.KEY`, and `getAllAndMerge`'s later-target-wins object spread. `v12_watch` — most ESM-exposed article |
| 05 | `custom-providers-and-injection-tokens.md` | 🟢 | Decision-table article (§5 is **Minimal shapes** per convention). Spine: four forms collapse to one runtime branch — `isNil(inject)` decides `new metatype()` vs `metatype()` **awaited**. Source-verified: detection is key-presence in fixed order (`useClass`→`useValue`→`useFactory`→`useExisting`, first match wins, extra keys ignored silently); `useValue` alone uses `hasOwnProperty` so `useValue: undefined` is legal while `useFactory: undefined` registers nothing; `useValue` wrappers are built `isResolved: true` (hence no dependencies possible); `useExisting` is literally `metatype: instance => instance` with `inject: [target]`; `useClass` inherits `scope`/`durable` from the class. Two decision tables (form, token). Async-factory boot cost named with both sides · **Code verified.** Boot cost now measured, not argued: 211 ms → 3208 ms with a 3 s async factory; rejecting factory exits 1 via `[ExceptionHandler]`. `useFactory: undefined` corrected — it crashes the boot with `Cannot read properties of undefined (reading 'metatype')`, naming nothing. |
| 06 | `scopes-and-lifetimes.md` | 🟢 | Spine: scope belongs to a **tree**, declared locally and propagating upward. Source-verified: `isDependencyTreeStatic` marks non-static on `REQUEST` **or any non-static dep**, recursively, memoized at boot — and **`TRANSIENT` is absent from that check**, so it never bubbles. Context id is `{ id: Math.random() }` used as a WeakMap key and pinned to the request; `loadPerContext` rebuilds the whole non-static sub-tree per request. Durable trees swap what `REQUEST` resolves to — `contextId.payload`, not the HTTP request. `introspect()` reports *effective* scope. Gates the scope-bubbling recipe · **Code verified; two claims corrected.** (1) `printIntrospectedAsRequestScoped` only prints under `NEST_DEBUG` — a normal boot changes lifetimes silently. (2) Durability branches two ways: a `REQUEST`-scoped provider reports its own `durable` flag and **never inspects deps** (my "one non-durable dep spoils it" claim was wrong at that position); the dep rule applies to providers non-static *by inheritance*, i.e. the controller. And `isTreeDurable` is read off the **handler's** wrapper, which is why the same durable service receives `{tenantId}` on one route and the HTTP request on another. |
| 07 | `configuration-and-environment.md` | 🟢 | Spine: config is the only untyped, unvalidated, externally-supplied input — so convert and validate it once, at boot. Source-verified against `@nestjs/config@4.0.4`: **first** `envFilePath` entry wins (`Object.assign(parsed, config)` — accumulated overwrites the new file); `process.env` spread last so real env always beats files; default path is `process.cwd()/.env`; validation throws a plain `Error` during decorator evaluation, before the app exists; `assignVariablesToProcess` writes schema defaults back but skips existing keys and drops objects; `get()` is a four-step chain (internal → validated env → process.env → default), so a `load` factory shadows an env var of the same name. Uses `class-validator` over Joi — same decorators as the DTO articles · **Code verified; one claim corrected.** `forRoot` is `async`, so a validation failure is a *rejected promise* surfaced through `[ExceptionHandler]` during bootstrap — not the bare pre-Nest throw I described. Verbatim output now in the article. Also fixed: committed `.env` lacked the `DATABASE_PASSWORD` its own schema requires; the validation spec needs `import 'reflect-metadata'`. |
| 08 | `bootstrap-and-lifecycle-hooks.md` | 🟢 | Closes `foundations/`. Spine: two structural guarantees — the port is bound only after every `onApplicationBootstrap` resolves, and shutdown hooks don't run unless you opt in. Source-verified: `create()` scans+instantiates but runs **no** hooks (`listen()` calls `init()`); modules sorted by `distance` **descending** so deepest initializes first, and every teardown phase reverses that array; within one module hooks run under **`Promise.all`** (declaration order buys nothing) with the module class's own hook **last**; `getNonAliasProviders` excludes `useExisting` aliases; both instance collectors filter on `isDependencyTreeStatic()`, so **scoped providers get no hooks at all**; `close()` runs destroy → before-shutdown → **`dispose()` closes the server** → shutdown, which fixes drain-vs-release placement |

### `request-lifecycle/`

| # | Article | Status | Notes |
| --- | --- | --- | --- |
| 09 | `execution-order.md` | 🟢 | Spine of the folder. Thesis: the pipeline is a **nesting**, not a list — `guards → (status/headers) → interceptors → pipes → handler`, read straight off `router-execution-context.create()`. Source-verified consequences: guards are **outside** the interceptor chain (nothing in an interceptor sees a rejected request); pipes are **inside** `next.handle()` (interceptors can `catchError` validation failures, and interceptor timing includes pipe cost); all four enhancer types share `createContext` → `[...global, ...class, ...method]`; **filters reverse that array** and `selectExceptionFilterMetadata` picks **exactly one**, so a route filter silently blinds the global one; middleware errors *do* reach filters but only globally-registered ones. Per roadmap §4c also owns registration and binding scope (`useGlobalX` has no DI; `APP_*` accumulates in declaration order). Walkthrough = a trace endpoint that prints its own pipeline |
| 10 | `middleware.md` | 🟢 | Spine: middleware is the *adapter's* layer, wrapped just enough to reach filters and inject providers — every limitation follows from that. Source-verified: `apply()` order **is** execution order (ordered `Set` in `builder.ts`); `forRoutes()` resolves a string to all-methods, a `RouteInfo` to one, and a **controller class to its actually-mapped routes** via the same `PathsExplorer` as article 03; **middleware paths go through the same `LegacyRouteConverter` + `pathToRegexp`**, so article 03's Express 5 wildcard and brace-placement rules apply verbatim and `forRoutes('*')` runs on a shim; errors reach **global** filters only; middleware lives in `module.middlewares`, so it gets module DI and lifecycle hooks. Owns the `next()`-is-a-callback correction and `res.on('finish')` |
| 11 | `guards.md` | 🟢 | Owns guards corpus-wide; `auth/` cites, doesn't re-teach. Spine: a guard answers one question, **before validation** — so the body it reads is raw, and `return false` is a single bit that Nest always renders as a generic **403**. Source-verified from `guards-consumer.ts`: strictly **sequential** `for…of` with short-circuit on first falsy; a **sync fast path** that skips `await` entirely; Observables resolved by **`lastValueFrom`**, so the *last* value decides and a non-completing observable hangs the request. From `createGuardsFn`: falsy → `ForbiddenException`, and **no guards bound → the check fn is `null`** (unused guards cost nothing). Context built from `(args, instance.constructor, callback)`, which is exactly the `[handler, class]` pair `Reflector` wants. Walkthrough covers the raw-body trap and the `@Public()` escape hatch every global guard needs |
| 12 | `interceptors.md` | 🟢 | Spine: `next.handle()` is a **deferred** observable, so an interceptor holds the decision to invoke the handler at all. Source-verified from `interceptors-consumer.ts`: recursive fold of `defer(...)` per level, so **not subscribing short-circuits** (caching) and **resubscribing re-invokes the handler** (retry → double writes); `isEmpty(interceptors) → return next()` so unused interceptors cost nothing; `AsyncResource.bind` around both deferred factories keeps `AsyncLocalStorage` alive across the chain, with `next()` called **eagerly** inside the bound scope on purpose; `transformDeferred`'s `subscriber.closed` branch proves **unsubscription does not cancel** — `timeout()` gives the client a 408 while the handler runs to completion and its result is discarded. Also: `tap` skips errors (use `finalize`), and `catchError` must re-throw or a 500 becomes `200 null` |
| 13 | `pipes.md` | 🟢 | Spine: a pipe sees **one argument**, runs **once per decorated parameter**, and all parameters resolve concurrently. Source-verified: `applyPipes` is an awaited `reduce` so pipes compose left-to-right (hence `DefaultValuePipe` first); `createPipesFn` uses **`Promise.all` over parameters** so pipes must be stateless and the first rejection wins; binding is `pipes.concat(paramPipes)` — parameter-level runs **last**; `isPipeable` excludes `@Res()`/`@Next()`; no decorated params → no pipe phase. **Headline finding:** `ValidationPipe.toValidate` excludes `Object` and `metatype` comes from `design:paramtypes`, so an `interface` or `type` DTO **silently disables validation** — returns the raw payload with no error, `whitelist` stripping nothing. Highest-severity silent failure in the corpus so far. `v12_watch` — Standard Schema in `@Body()`/`@Query()` would sidestep the metatype problem entirely |
| 14 | `exception-filters.md` | 🟢 | Closes the loop article 09 opened. Spine: the only layer where **exactly one** participant runs, so adding a filter can mean removing one. Source-verified: `RouterProxy` builds the host as `new ExecutionContextHost([req,res,next])` — **no class, no handler**, which is why the parameter is `ArgumentsHost` and `Reflector` is unavailable here; `ExceptionsHandler.next` treats `super.catch()` as a **fallback**, so a global `@Catch()` replaces the built-in entirely; **`HttpException`s are never logged** — `logger.error` lives only in `handleUnknownError`; `getResponse()` returning an object becomes the body **verbatim** (error shape with no filter); `isHttpError` sniffing is why malformed JSON is a 400 not a 500; `isHeadersSent` means a filter can't rewrite a started response; `applicationRef` is **property-injected**, so `BaseExceptionFilter` subclasses require `APP_FILTER`; and `filter.func()` is **not awaited**, so an async filter's rejection is an unhandled rejection |
| 15 | `execution-context-and-reflector.md` | 🟢 | Closes `request-lifecycle/` and Wave 1. Spine: the context is a **typed view over one args array**, not a transport abstraction. Source-verified from `execution-context-host.ts`: `switchTo*` is `Object.assign(this, …)` — it **mutates the host**, returns it, and the three variants are index aliases, so calling the wrong one **succeeds silently** and misnames the objects; `contextType` is initialised to `'http'`, so an untyped host reports HTTP regardless; `getClass()`/`getHandler()` are **non-null assertions over nullable fields**, which is why casting `ArgumentsHost` → `ExecutionContext` in a filter compiles and then throws on `null`. Carries the per-layer table (middleware: raw args · guards/interceptors: full context · pipes: `ArgumentMetadata` only · filters: `ArgumentsHost`) — the practical summary of the whole folder |

---

## Wave 2 — validation + data

### `validation/`

| # | Article | Status | Notes |
| --- | --- | --- | --- |
| 16 | `dtos-and-class-validator.md` | 🟢 | Opens Wave 2. Spine: a DTO is a **runtime object carrying metadata**, so every rule is about what survives compilation. **Measured against class-validator 0.15.1 / class-transformer 0.5.1**, and it corrects the common lore: `@ValidateNested()` without `@Type()` does **not** silently pass — it rejects with `unknownValue` and a child error carrying **no property name**. `forbidUnknownValues` defaults **true** since 0.14, so the validator fails closed on a plain object; the silent bypass in article 13 is entirely `ValidationPipe.toValidate`. Also measured: `@IsOptional()` skips all validators on **`null`** too (`@ValidateIf` is the alternative); `plainToInstance` strips nothing; array errors nest **three** levels with the index as the middle `property` (`lines` → `0` → `quantity`); a `@Type()`-only property is stripped by `whitelist` unless `@Allow()`d. `v12_watch` — Standard Schema would sidestep both traps |
| 17 | `validationpipe-in-depth.md` | 🟢 | Spine: three defaults are the opposite of the reputation. Source-verified at v11.1.28: **`transform` defaults `false`**, and with it off the return value depends on whether *any* other option was passed (`Object.keys(validatorOptions).length > 1`) — so `new ValidationPipe()` validates but strips and transforms **nothing**; **Nest forces `forbidUnknownValues: false`** (citing nest#10683), which re-enables the nested-`@Type()` bypass on the request path; `transformPrimitive` coerces named `@Param`/`@Query` **without validating** — `'true'` only for booleans, `+value` for numbers, so `?page=abc` is `NaN`; `toEmptyIfNil` turns a missing body into `{}` so required-field errors report; `stripProtoKeys` recursively deletes `__proto__`/`prototype`/`constructor` (free prototype-pollution defence); default error body is a flat `string[]` with the nested path **glued onto the message text** |
| 18 | `serialization-and-response-shaping.md` | 🟢 | Closes `validation/`. Spine: this is the direction where a mistake **leaks** rather than rejects, and `@Exclude()` gives false confidence three ways. Source-verified: `serialize()` skips primitives and **`StreamableFile`**, maps arrays element-wise; `@SerializeOptions({ type })` is an **escape hatch** — a non-instance response is run through `plainToInstance` first, which makes raw ORM rows safe; options resolve via `getAllAndOverride([handler, class])`. **Measured on class-transformer 0.5.1**: plain objects aren't filtered at all (no metadata for `Object`); **plain *nested* objects leak through a fully annotated parent** (`nested.password` survived); `excludeExtraneousValues` is an allowlist that closes it by construction but drops `@Type()`-only properties; and **`groups` filter twice** — on `plainToInstance` *and* `instanceToPlain` — so a field built without the group can't be exposed later, while ORM-populated entities only pay the output filter |

### `data/` — ORM-agnostic

| # | Article | Status | Notes |
| --- | --- | --- | --- |
| 19 | `persistence-boundaries.md` | 🟢 | Opens `data/`; ORM-agnostic, reused unchanged by Phases 2–3. Spine: **your ORM already gives you a repository**, so a second one buys only changeability — decided by three questions, not by default, and shape A (inject the ORM repository) is defended as the correct default. Measured: an **abstract class** is contract *and* token — survives erasure, appears in `design:paramtypes` as the same reference, needs no `@Inject()`. Boundary enforcement traced to article 02's `validateExportedProvider`: omitting the repository from `exports` makes a violation a **boot error**. Carries the leak test — *could a second implementation exist without importing the first one's library?* — and locates the real boundary at the **transaction**, owned by the use case, handing mechanics to 20/27. Opens with an explicit **evidence caveat**: architecture claims are arguments, not measurements |
| 20 | `transactions-and-isolation.md` | ⚪ | claims reproduced against the demo DB before writing |
| 21 | `the-n-plus-one-problem.md` | ⚪ | ditto |
| 22 | `migrations-as-a-discipline.md` | ⚪ | |
| 23 | `connection-pooling.md` | ⚪ | ditto |
| 24 | `indexes-and-selectivity.md` | ⚪ | **new (2026-07-30 review)** — selectivity, cardinality, composite column order, and the write-side cost of an index. ORM-agnostic, so Phases 2–3 reuse it. Postgres-specific index types (GIN for JSONB, partial indexes) stay labelled and belong to article 29 |

### `data/` — TypeORM-specific

| # | Article | Status | Notes |
| --- | --- | --- | --- |
| 25 | `typeorm-entities-and-relations.md` | ⚪ | |
| 26 | `typeorm-datasource-and-repositories.md` | ⚪ | |
| 27 | `typeorm-transactions-in-nest.md` | ⚪ | |
| 28 | `typeorm-migrations-and-schema-drift.md` | ⚪ | must state the `synchronize: true` cost plainly |
| 29 | `postgres-specifics.md` | ⚪ | labelled Postgres-only so Phase 2 contrasts, not contradicts |

---

## Wave 3 — auth, async, testing *(provisional counts)*

### `auth/`

| # | Article | Status | Notes |
| --- | --- | --- | --- |
| 30 | `authentication-strategies.md` | ⚪ | |
| 31 | `jwt-and-refresh-tokens.md` | ⚪ | |
| 32 | `authorization-rbac-and-policies.md` | ⚪ | |

### `async/`

| # | Article | Status | Notes |
| --- | --- | --- | --- |
| 33 | `queues-with-bullmq.md` | ⚪ | adds Redis to docker-compose |
| 34 | `event-emitter.md` | ⚪ | |
| 35 | `scheduling-and-cron.md` | ⚪ | |
| 36 | `streaming-and-sse.md` | ⚪ | |

### `testing/`

| # | Article | Status | Notes |
| --- | --- | --- | --- |
| 37 | `the-testing-module.md` | ⚪ | runner-agnostic — kept separate from Jest config |
| 38 | `unit-testing-services-and-controllers.md` | ⚪ | `v12_watch` |
| 39 | `integration-and-e2e-with-supertest.md` | ⚪ | `v12_watch` |
| 40 | `testing-against-a-real-database.md` | ⚪ | `v12_watch` |

---

## Wave 4 — architecture, observability, performance *(provisional counts)*

### `architecture/`

| # | Article | Status | Notes |
| --- | --- | --- | --- |
| 41 | `dynamic-modules.md` | ⚪ | |
| 42 | `monorepo-and-shared-libraries.md` | ⚪ | |
| 43 | `microservices-transports.md` | ⚪ | concept level; gates whether the microservices recipe track ships |
| 44 | `cqrs.md` | ⚪ | |
| 45 | `layering-and-boundaries.md` | ⚪ | |

### `observability/`

| # | Article | Status | Notes |
| --- | --- | --- | --- |
| 46 | `logging.md` | ⚪ | |
| 47 | `health-checks.md` | ⚪ | Terminus health-indicator APIs deprecated in 11 — verify current shape |
| 48 | `metrics-and-tracing.md` | ⚪ | |
| 49 | `graceful-shutdown.md` | ⚪ | |

### `performance/`

| # | Article | Status | Notes |
| --- | --- | --- | --- |
| 50 | `caching.md` | ⚪ | cache-manager v6 / Keyv as of Nest 11 — verify |
| 51 | `adapter-choice.md` | ⚪ | decision-table article; owns the Fastify contrast |
| 52 | `blocking-the-event-loop.md` | ⚪ | |
| 53 | `request-scope-cost.md` | ⚪ | |

---

## Recipe tracks

A track opens only after its gating articles are 🟢 or better.

| Order | Track | Gate | Status |
| --- | --- | --- | --- |
| 1 | `di-and-modules/` | Wave 1 | ⚪ |
| 2 | `request-lifecycle/` | Wave 1 | ⚪ |
| 3 | `validation/` | Wave 2 | ⚪ |
| 4 | `data-access/` | Wave 2 | ⚪ |
| 5 | `auth/` | Wave 3 | ⚪ |
| 6 | `background-jobs/` | Wave 3 | ⚪ |
| 7 | `testing/` | Wave 3 | ⚪ |
| 8 | `performance/` | Wave 4 | ⚪ |
| 9 | `deployment/` | Wave 4 | ⚪ |
| 10 | `microservices/` | Wave 4 | ⚪ — ships only if failures are reproducible |

---

## Demos

| App | Covers | Status |
| --- | --- | --- |
| `demos/foundations/` | articles 01–15 | 🟢 — 13 suites / 21 tests, 24 experiments run (rxjs 7.8.2). Articles 09–15 code-verified; **article 08 verified by behaviour only** — its file was absent from the repo and Cursor reconstructed the demo from `progress.md` |
| `demos/request-lifecycle/` | articles 09–15 | ⚪ |
| `demos/validation/` | articles 16–18 | ⚪ |
| `demos/data/` | articles 19–28 | ⚪ — needs `docker-compose` Postgres 18 |
| later | waves 3–4 | ⚪ |

---

## v12 watch rollup

Generated from `v12_watch: true` frontmatter. Populated as articles are written.

| Article | Surface v12 changes | Revisited |
| --- | --- | --- |
| 01 `foundations/providers-and-di` | reflection setup (`emitDecoratorMetadata`) under ESM; DI model itself unchanged | ⚪ |
| 03 `foundations/controllers-and-routing` | **uncertain** — flagged pre-emptively; confirm at GA whether v12 touches router internals or path matching. If not, clear the flag | ⚪ |
| 10 `request-lifecycle/middleware` | inherits 03's flag — `forRoutes()`/`exclude()` use the same `pathToRegexp` + legacy converter as route decorators | ⚪ |
| 04 `foundations/decorators-and-metadata-reflection` | decorator emit under ESM; the measured `design:*` behaviour must be re-run at GA | ⚪ |

---

## Open debts

| Debt | Owed since | Notes |
| --- | --- | --- |
| Repo not scaffolded | — | `README.md`, `docker-compose.yml`, folder tree, `.gitignore`, tsconfig baseline |
| `CREDITS.md` / `LICENSE` | — | don't repeat the `angular-concepts` miss of referencing them in README before they exist |
| ~~Anchor verification script~~ | — | ✅ `scripts/check-links.py` in place; verified against the real tree — 12 broken links, all forward references to queued files, no anchor failures |
| ~~Article code unverified~~ | 01–04 | ✅ paid — all samples compile and run. 3 divergences in 01–02, **2 wrong claims in 03** caught by experiment and corrected |
| 🔴 **Article 08 not in the repo** | 08 | `foundations/bootstrap-and-lifecycle-hooks.md` was **missing on disk** during verification. L1–L5 confirmed the article's *claims* against reconstructed code, so the claims stand — but **none of article 08's own code samples have been compiled**. Place the file and re-run L1–L5 |
| Serializer-outside-envelope unmeasured | 18 | Article 18 §Step 5 states the ordering rule but explicitly does **not** claim what leaks when the serializer wraps an envelope. Verify in `demos/validation/` alongside article 12's envelope |
| ⚠️ Article 16 corrected by article 17 | 16 | Measurement in 16 was standalone `validateSync`, which is **not** the Nest path. `ValidationPipe` forces `forbidUnknownValues: false`, so a missing `@Type()` is a **silent bypass** through the pipe (measured `[]`) while being rejected when validated directly. Article 16's lead, under-the-hood, Step 2, mistake #2, summary, and evolution sections all rewritten. Lesson: measure the path the framework actually takes, not the library in isolation |
| Dual `Roles` decorator | 04, 11 | two `Reflector.createDecorator()` calls = two opaque keys, so a guard reading one is blind to the other. Article 11 now says reuse article 04's; the demo still has both files |
| ~~Articles 05–07 code unverified~~ | 05, 06, 07 | ✅ paid — `@nestjs/config@4.0.4`, `class-validator@0.15.1`, `class-transformer@0.5.1`. 17 of 20 experiments confirmed the articles; 3 corrections applied |
| ~~Article 05 scope addition~~ | 05 | ✅ paid — multi-provider `useFactory` aggregation with its cost named, the `APP_*` accumulation exception, and `deps`-vs-`inject` as mistake #5 |
| ~~Angular callouts unspent~~ | 05, 06 | ✅ paid — 05 spends it on no-`multi:true`/no-`inject()`; 06 on component-tree lifetime vs request-context lifetime. Ledger in roadmap §6.6a updated by hand if it drifts |
| Article 09 ownership note | 09 | must own enhancer *registration* — global/controller/handler binding, `useGlobalX()` vs `APP_X`, ordering of several globals, and why `new X()` can't inject. Recorded before the article is written so it doesn't fall between 09–14 |
| Article 01 forward-pointer | 01 | the demo's hand-rolled `config/` is superseded by article 07. Migration needed **import-path changes only** — factory bodies unchanged — so article 01 stays correct, but a one-line pointer forward would help |
| Node 24 not installed | — | shell is v22.22.0 against `engines.node >=24`; warning only today, but the frontmatter claims a 24 baseline that nothing has exercised |
| Docker never pulled | — | `postgres:18.4-alpine` confirmed present on Hub, never actually run. Blocks nothing until Wave 2 |
| Waves 3–4 counts unconfirmed | — | resize at the Wave 2 → 3 boundary |
| Link checker can't see cross-folder links from staging | — | `/mnt/user-data/outputs` is flat, so `../foundations/x.md` from article 09 reports missing even though it resolves in the repo. **Cross-folder links are only verifiable after the files are placed.** Article 09's 5 `../foundations/*` reports are this artifact; its 7 real forward refs are the four sibling enhancer articles, `exception-filters`, the e2e article, and one recipe |
| Cross-links unresolved | 01–07 | 12 forward references to queued files (04, 06, 07, 40, `custom-providers-and-injection-tokens`, `bootstrap-and-lifecycle-hooks`, two recipes). Article 02 → 01 anchors already verified green. Re-run `check:links` at Wave 1 close |
| Recipe slugs invented ahead of their tracks | 01, 02 | `recipes/di-and-modules/nest-cant-resolve-dependencies`, `recipes/di-and-modules/circular-dependency` — linked before the track opened; keep the slugs or fix both articles |
| `demos/foundations/` not built | 01 | article 01 cites it as demo source |

---

## Session log

| Date | Session | Outcome |
| --- | --- | --- |
| 2026-08-16 | `description` frontmatter pass | Mechanical cross-repo pass from `prompts/description-pass.md`: a one-sentence `description` dek added immediately after `article_id` in all **19** article files — 19 insertions, 0 deletions, no prose touched, every frontmatter block still parses and every `status` object survived intact. `check:links` reports the same 59 broken links before and after, all pre-existing forward references to queued files. One new debt surfaced: `validation/dtos-and-class-validator.md` is 🟢 in this tracker but **absent from the repo** — the article-08 failure mode repeating, and three articles link to it, so it got no dek because there is no file. |
| 2026-07-29 | Kickoff | Baseline decisions settled (Nest 11.1.x, Node 24, Express 5, TypeORM 1.1 + PG 18, Jest, REST-only, bounded Angular callouts). `roadmap.md` + `progress.md` drafted. Nothing else written. |
| 2026-07-29 | Article 01 | `foundations/providers-and-di.md` drafted against official docs + v11.1.28 injector source. Opened the v12 watch rollup and the cross-link debt. |
| 2026-07-29 | Scaffold landed | Cursor scaffolded the repo. Deviations accepted: `packageManager` pinned to the installed pnpm 10.33.0; `postgres:18.4-alpine` confirmed present on Docker Hub but **not pulled** — Docker Desktop wouldn't start, so items 3–4 of the acceptance list are still open. Node 24 not yet installed locally. |
| 2026-07-29 | Demo 05–07 + reconciliation | Demo green: 8 suites / 12 tests. 20 experiments run — 17 confirmed the articles, 3 contradicted them. Articles 05, 06, 07 corrected; article 06's durability section rewritten around the two-branch rule the experiment exposed. |
| 2026-07-29 | Demo prompt 05–07 | `prompts/extend-foundations-demo-rates-audit-config.md` written: adds `rates/`, `audit/`, and the `@nestjs/config` migration, with 20 experiments (A1–A5 providers, B1–B8 scopes, C1–C7 config). Two decisions surfaced: article 07 supersedes article 01's hand-rolled config in the demo (may need a forward-pointer in 01), and the root `.gitignore` needs `!demos/*/.env` so the committed defaults are tracked. |
| 2026-07-30 | Article 19 — `data/` opens | `data/persistence-boundaries.md` drafted. First article whose core claims are **arguments rather than measurements**, so it says so up front and confines §How it works to three verifiable Nest mechanisms (abstract-class token — newly measured; module-export enforcement; `useClass` swap plus the scope trap). Notable: its demo needs **no database**, which is the ORM-agnostic split from roadmap §3 paying off immediately. |
| 2026-07-30 | Built-in surface audit (10–14) | Prompted by a reader-supplied list of built-in pipes. Enumerated the real surface from the v11.1.28 barrel files rather than from memory, and found gaps in both directions. **Article 13** was missing `ParseFilePipe` (+ `ParseFilePipeBuilder`, `MaxFileSizeValidator`, `FileTypeValidator`) **and `ParseDatePipe`** — the latter also absent from the source list, so `common/pipes` ships **ten**, not nine. **Article 14** listed ~5 exceptions; the real set is **21** + `HttpException` + `IntrinsicException`, now a full table with 412/422/503 called out as under-used. **Articles 10, 11, 12** gained the opposite finding — there is no `interceptors/` barrel (exactly **one** built-in interceptor, the serializer), **no** built-in guards, and **no** built-in middleware, with CORS exposed as an adapter option instead. |
| 2026-07-30 | Article 18 — `validation/` draft-complete | `validation/serialization-and-response-shaping.md` drafted from `class-serializer.interceptor.ts` @ v11.1.28 plus four measurements on class-transformer 0.5.1. Best finds: nested **plain** objects leak through an annotated parent, and `groups` filter on the way *in* as well as out (an instance built without the group can never expose the field). Also surfaced `@SerializeOptions({ type })`, which upgrades a plain response into a DTO before serializing — the supported fix for raw-query routes. One claim left **explicitly unmeasured** and flagged in the article: what leaks when the serializer runs *outside* an envelope interceptor. |
| 2026-07-30 | Article 00 — TypeScript prerequisite | `foundations/typescript-for-nest.md` drafted from Huy's `angular-concepts` TS article plus a long Angular/React TS Q&A, but re-anchored on this corpus's own measurements. New measurements: Node strip-only mode rejects parameter properties **and** `enum`; `verbatimModuleSyntax` conflicts with our CJS baseline; the Express `Request` augmentation verified against `@types/express@5`. Pays a debt articles 10 and 11 both opened — they said "augment the type once" and never showed how. Two new optional frontmatter fields (`write_order`, `typescript_baseline`) recorded in roadmap §6.3. Source material's errors not carried over: it claimed `deps` works on Nest providers and that Ivy makes runtime metadata impossible. |
| 2026-07-30 | Article 17 + article 16 correction | `validation/validationpipe-in-depth.md` drafted from `validation.pipe.ts` @ v11.1.28. Reading the constructor turned up `forbidUnknownValues: false` — Nest overriding class-validator — which **invalidated article 16's headline**, written from standalone measurement. Re-measured with the pipe's own options: no `@Type()` → `[]` through the pipe, rejected standalone. Article 16 corrected in six places; the split-brain default is now the explanation for why public advice on nested validation is so inconsistent. |
| 2026-07-30 | Article 16 — Wave 2 opens | `validation/dtos-and-class-validator.md` drafted. Library behaviour **measured** in a sandbox (class-validator 0.15.1, class-transformer 0.5.1) rather than taken from docs: the no-`@Type()` failure mode, `forbidUnknownValues` defaulting true since 0.14, `@IsOptional()` on `null`, and the three-level array error tree. The 0.14 default flip explains why so much circulating advice on nested validation is wrong. |
| 2026-07-30 | Verification 08–15 + reconciliation | 24 experiments; **20 verified clean, 2 partial, 4 article defects found and fixed.** (1) Article 09's documented trace was **impossible** — the handler drains before the interceptor's post-phase, so `interceptor:after` can never appear in the response; corrected, and the leftover mark surfacing in the *next* request is now part of the demonstration. (2) Article 12: `retry` re-invokes the **pipes** too, not just the handler — measured 3× pipe marks for one request. (3) Article 14's recommended filter **double-nested** `getResponse()`, mangling body-parser's 400 into `{message:{message,error,statusCode}}`; rewritten to mirror the built-in, `headersSent` guard baked in. (4) Article 11 redeclared `Roles`, creating a second opaque key. Also sharpened article 08: `enableShutdownHooks()` gates **signals**, not `close()`. Verbatim now in the articles: `"Forbidden resource"`, the legacy-route warning, the double-nested 400 body. |
| 2026-07-30 | Verification prompt 08–15 | `prompts/verify-foundations-demo-lifecycle-pipeline.md` written. 24 experiments (P1–P3 pipes, I1–I4 interceptors, F1–F5 filters, C1–C4 context, L1–L5 lifecycle, T1–T2 trace, M1–M2 middleware, G1–G3 guards). **Eight registration decisions surfaced** where the articles collide on "register this globally" — three are deliberate deviations from the articles and are flagged as such. Highest-value check is P1, the interface-DTO validation bypass. |
| 2026-07-30 | Article 15 — **Wave 1 draft-complete** | `request-lifecycle/execution-context-and-reflector.md` drafted against the execution-context docs plus `execution-context-host.ts` / `router-proxy.ts` / `reflector.service.ts` @ v11.1.28. Best find: `switchTo*` renames rather than converts, so the wrong switch is a silent misread — and the `null` return from `getHandler()` explains why the widely-copied cast-in-a-filter workaround fails. Self-audit renamed the article's guard to avoid colliding with article 11's `ApiKeyGuard` in the same demo app. |
| 2026-07-30 | Article 14 | `request-lifecycle/exception-filters.md` drafted against the exception-filters docs plus `exceptions-handler.ts` / `base-exception-filter.ts` / `router-proxy.ts` @ v11.1.28. Two operational findings: 4xx are silent by default, and a global `@Catch()` that skips `super.catch()` deletes the framework's 500 logging. Self-audit caught an unbuildable demo claim — the `QueryFailedError` filter needs TypeORM, so it's now marked as landing with the Wave 2 `data/` demo. Six same-folder anchors across articles 09–13 verified green. |
| 2026-07-30 | Article 13 | `request-lifecycle/pipes.md` drafted against the pipes docs plus `pipes-consumer.ts` / `router-execution-context.ts` / `validation.pipe.ts` @ v11.1.28. Headline: the interface-DTO validation bypass, traced from `toValidate`'s exclusion list to article 04's measured `Object` erasure. Also confirmed parameters resolve under `Promise.all`, which makes stateful pipes a race rather than a style issue. |
| 2026-07-30 | Article 12 | `request-lifecycle/interceptors.md` drafted against the interceptors docs plus `interceptors-consumer.ts` @ v11.1.28. Three findings the docs don't state: deferral is the mechanism behind both caching and the retry double-write hazard; `AsyncResource.bind` is why ALS survives the chain (ties to article 10's recommendation); and `timeout()` is a caller-facing SLA, not cancellation. |
| 2026-07-30 | Article 11 | `request-lifecycle/guards.md` drafted against the guards docs plus `guards-consumer.ts` / `router-execution-context.ts` / `execution-context-host.ts` @ v11.1.28. Two findings changed the article's shape: `return false` can never be a 401, and Observable guards are decided by `lastValueFrom`. Same-folder anchors into articles 09 and 10 verified green by the checker. |
| 2026-07-30 | Article 10 | `request-lifecycle/middleware.md` drafted against the middleware docs plus `builder.ts` / `routes-mapper.ts` / `utils.ts` / `middleware-module.ts` @ v11.1.28. Best find: middleware path patterns share the router's `LegacyRouteConverter` + `pathToRegexp`, so the article-03 wildcard correction applies to `forRoutes()` unchanged. `v12_watch: true` for that reason. |
| 2026-07-30 | Article 09 | `request-lifecycle/execution-order.md` drafted against the request-lifecycle docs plus `router-execution-context.ts` / `context-creator.ts` / `external-exception-filter-context.ts` / `exceptions-handler.ts` / `middleware-module.ts` @ v11.1.28. Three claims the flat diagram gets wrong are now source-traced. Also noted: the link checker cannot validate cross-folder links from the flat staging directory. |
| 2026-07-30 | Article 08 + debt payment | `foundations/bootstrap-and-lifecycle-hooks.md` drafted against the lifecycle-events docs plus `nest-application-context.ts` / `on-module-init.hook.ts` / `transient-instances.ts` / `nest-factory.ts` / `nest-application.ts` @ v11.1.28. `foundations/` draft-complete. Also paid three debts from the 2026-07-30 review: article 05's multi-provider section and `deps` mistake, and the unspent Angular callouts in 05 and 06. |
| 2026-07-30 | Outside-material review | Reviewed a third-party NestJS course (screenshots) and a long Angular↔NestJS Q&A against the plan. Added article 24 `indexes-and-selectivity` (real gap: nothing in `data/` covered indexing), three recipe sketches, two scope additions to article 05, an ownership note for article 09, and the Angular callout ledger (§6.6a). Waves 2–4 renumbered — write order only, no article touched except one `article 40` → `41` reference. Source errors logged in §6.5 rather than absorbed. |
| 2026-07-29 | Article 07 | `foundations/configuration-and-environment.md` drafted against the configuration docs and `@nestjs/config@4.0.4` source (`config.module.ts`, `config.service.ts`). Self-audit fixed a cross-article contradiction — `RATES_URL` was required here but optional in article 05's factory; now `@IsOptional()`. |
| 2026-07-29 | Article 06 | `foundations/scopes-and-lifetimes.md` drafted against the injection-scopes and module-ref docs plus `instance-wrapper.ts` / `router-explorer.ts` / `context-id-factory.ts` / `module-ref.ts` @ v11.1.28. Self-audit rewrote the durable `ContextIdStrategy` sample, which had bogus `as unknown as` casts. |
| 2026-07-29 | Demo gap-fill + reconciliation | `demos/foundations` extended to cover articles 03–04; 4 suites / 6 tests green, `@types/express@5.0.6`. Eight experiments run: 6 verified the articles, **2 contradicted them**. Article 03 corrected on both counts (wildcard brace placement, `@Res()` header behaviour) with a measured table and a source trace. |
| 2026-07-29 | Article 05 | `foundations/custom-providers-and-injection-tokens.md` drafted against the custom-providers docs and `module.ts` / `injector.ts` @ v11.1.28. Self-audit caught a real TS error in the sample (`RateTable` index signature had to be `number \| undefined` or the missing-key guard won't compile). |
| 2026-07-29 | Gap-fill prompt | `prompts/extend-foundations-demo-catalog-common.md` written: extends the demo to cover articles 03–04 and puts eight article claims under test (boot-log order, route shadowing, wildcard param shape, bare `*` warning, `@Res` inert headers, `getAllAndMerge` object inversion, decorator order transcript, `design:paramtypes` table). |
| 2026-07-29 | Article 04 | `foundations/decorators-and-metadata-reflection.md` drafted. Claims about decorator order and metadata emit were **measured** in a TS 5.9.3 sandbox rather than written from recall; `SetMetadata`, `Reflector`, `createParamDecorator`, `applyDecorators` read from v11.1.28 source; TS 5.0 release notes for the standard-vs-legacy split. |
| 2026-07-29 | Article 03 | `foundations/controllers-and-routing.md` drafted against `/controllers`, the Nest migration guide, Express 5 routing docs, path-to-regexp, and `request-mapping.decorator.ts` / `paths-explorer.ts` / `router-explorer.ts` / `metadata-scanner.ts` @ v11.1.28. |
| 2026-07-29 | Demo 1 built | `demos/foundations` green on `@nestjs/core@11.1.28` / `typescript@5.9.3`. Articles 01–02 code verified end to end; the Step 3 duplicate-registration claim reproduced. Three prose divergences reconciled. |
| 2026-07-29 | Convention fix | `article_id`/`recipe_id` switched from sequence numbers to filename slugs; `status` switched to the two-boolean object form, matching `reactjs-concepts`. Applied to articles 01–02. |
| 2026-07-29 | Scaffold + article 02 | Cursor scaffold prompt authored (tree, docker-compose, licences, link checker). `foundations/modules-and-the-module-graph.md` drafted against `/modules` + `module.ts`/`container.ts`/opaque-key factory. Link checker validated on the drafted articles. |