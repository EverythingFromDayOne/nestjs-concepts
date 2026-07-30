# `nestjs-concepts` — roadmap

The stable plan. Changes here are deliberate; day-to-day state lives in `progress.md`.

---

## 1. What this is

A learning resource for NestJS: opinionated, deeply cross-linked concept articles plus symptom-first debugging recipes, TypeScript strict throughout. Same shape as `reactjs-concepts` and `angular-concepts` — the corpus stands alone and assumes no prior NestJS.

**Non-goals.** Not a docs mirror, not a tutorial series, not a cookbook of snippets. If the official docs already say it plainly, this corpus links them and spends its words on the mechanism underneath, the failure mode, or the trade-off.

---

## 2. Baseline (locked)

| Surface | Baseline | Note |
| --- | --- | --- |
| NestJS | `11.1.x` | v12 is in `next` prerelease, targeted early Q3 2026 — see §7 |
| Node | 24 LTS | Active LTS through Apr 2028. Nest 11 requires ≥ 20. Not 26 (Current until Oct 2026) |
| HTTP adapter | Express 5 | Nest 11's default. Fastify contrast owned by one article, not woven throughout |
| ORM (Phase 1) | TypeORM `1.1.x` | v1.0 shipped 2026-05-19 under the maintainer team formed late 2024; `@nestjs/typeorm` ≥ 11.0.1 required |
| Database (Phase 1) | PostgreSQL 18 | Not 19 — GA around Sept/Oct 2026 |
| Test runner | Jest | Nest 11's default. Vitest is a v12-era additive pass, not a rewrite — see §5.4 |
| Validation | class-validator + `ValidationPipe` | Standard Schema (Zod/Valibot) lands in v12 as an *addition*; class-validator stays the documented default |
| Surface scope | REST | Microservices at concept level only; GraphQL deferred |
| Language | TypeScript strict | `strict: true`, no `any` in published samples |

### 2a. Named costs of the baseline

Every one of these is a trade-off the corpus states out loud rather than papers over.

- **v11 on CJS decorators** — the corpus teaches decorator-and-metadata schema definition at the moment Nest is moving toward ESM and schema-first options. Mitigated by §7, not eliminated.
- **TypeORM** — weaker type inference than Prisma's generated client; schema defined via `emitDecoratorMetadata`, which sits awkwardly against the ESM direction; migration-generation drift; the `synchronize: true` footgun; lazy-relation surprises. Maintenance risk is *not* on this list as of v1.0.
- **Express 5** — Fastify's hook model, its HEAD/middleware behaviour, and `@Res()` typing differences get one article instead of being present throughout.
- **Jest** — `testing/` is the shortest-lived folder in the corpus.
- **REST-only** — the corpus cannot claim GraphQL or transport-level microservice coverage in Phase 1. It says so rather than implying otherwise.

---

## 3. Data-layer phasing

| Phase | Stack | Status |
| --- | --- | --- |
| 1 | TypeORM + PostgreSQL | corpus baseline |
| 2 | Prisma + MySQL | additive contrast pass |
| 3 | MongoDB (Mongoose) | document-model contrast, later |

**The structural rule, applied from article one.** The `data/` folder separates:

- **ORM-agnostic concepts** — transaction boundaries and isolation levels, the N+1 problem, repository/service boundaries, migrations as a discipline, connection pooling, unit of work. Written once; cited by every phase.
- **ORM-specific implementation** — `@Entity`, `DataSource`, `QueryRunner`, transaction propagation patterns. Isolated into clearly-scoped articles, filename-prefixed `typeorm-`.

Postgres-specific behaviour (JSONB, arrays, identity columns, `RETURNING`, default isolation semantics) is explicitly labelled so Phase 2 can *contrast* rather than contradict.

Get this wrong and Phase 2 is a rewrite. Get it right and Phase 2 reuses every concept article.

The same separation applies to testing: framework-owned surfaces (`Test.createTestingModule`, provider overriding, module-scoped setup) are runner-agnostic and live apart from runner configuration.

---

## 4. Article inventory

53 articles across four waves. Waves 1–2 are committed; waves 3–4 are planned and resizable — folder shape is settled, counts are not.

Numbers below are **write order**, not identity — see §6.3. They reflow when the plan changes; a renumber touches this file and `progress.md` and no article.

### Wave 1 — the spine (15)

`foundations/`
| # | Slug | Owns |
| --- | --- | --- |
| 01 | `providers-and-di` | the mental-model anchor everything else cites |
| 02 | `modules-and-the-module-graph` | module scope, `exports`, `imports`, why a provider isn't visible |
| 03 | `controllers-and-routing` | route resolution, param decorators, response handling |
| 04 | `decorators-and-metadata-reflection` | `reflect-metadata`, `design:paramtypes`, how Nest reads a class |
| 05 | `custom-providers-and-injection-tokens` | `useClass`/`useValue`/`useFactory`/`useExisting`, token identity |
| 06 | `scopes-and-lifetimes` | default vs request vs transient, and scope bubbling |
| 07 | `configuration-and-environment` | `ConfigModule`, validation at boot, typed config |
| 08 | `bootstrap-and-lifecycle-hooks` | `NestFactory`, init order, `OnModuleInit` → `OnApplicationShutdown` |

`request-lifecycle/`
| # | Slug | Owns |
| --- | --- | --- |
| 09 | `execution-order` | the spine: middleware → guards → interceptors → pipes → handler → interceptors → filters |
| 10 | `middleware` | adapter-level, why it runs outside the DI-aware chain |
| 11 | `guards` | authorization decision point, `CanActivate`, metadata-driven guards |
| 12 | `interceptors` | before/after, RxJS operator surface, response mapping |
| 13 | `pipes` | transformation and validation, built-ins, param-level vs global |
| 14 | `exception-filters` | error normalization, what swallows what |
| 15 | `execution-context-and-reflector` | `ExecutionContext`, `Reflector`, transport-agnostic handlers |

### Wave 2 — validation + data (14)

`validation/`
| # | Slug |
| --- | --- |
| 16 | `dtos-and-class-validator` |
| 17 | `validationpipe-in-depth` (whitelist, `forbidNonWhitelisted`, `transform`, implicit conversion) |
| 18 | `serialization-and-response-shaping` (`class-transformer`, `ClassSerializerInterceptor`, `@Exclude`) |

`data/` — ORM-agnostic
| # | Slug |
| --- | --- |
| 19 | `persistence-boundaries` (repository/service split, unit of work) |
| 20 | `transactions-and-isolation` |
| 21 | `the-n-plus-one-problem` |
| 22 | `migrations-as-a-discipline` |
| 23 | `connection-pooling` |
| 24 | `indexes-and-selectivity` (selectivity, cardinality, composite column order, the cost of an index) |

`data/` — TypeORM-specific
| # | Slug |
| --- | --- |
| 25 | `typeorm-entities-and-relations` |
| 26 | `typeorm-datasource-and-repositories` |
| 27 | `typeorm-transactions-in-nest` (`QueryRunner`, propagation across services) |
| 28 | `typeorm-migrations-and-schema-drift` |
| 29 | `postgres-specifics` (JSONB, arrays, identity, `RETURNING`, isolation defaults) |

### 4c. Scope adjustments (2026-07-30 review)

Gaps found by reviewing outside NestJS learning material against this plan. None of these need a new article beyond `indexes-and-selectivity` above.

| Article | Addition | Why it was missing |
| --- | --- | --- |
| 05 `custom-providers-and-injection-tokens` | **Multi-provider aggregation** — getting an *array* of implementations under one token via `useFactory` + `inject`, since Nest has no `multi: true`. Plus the exception: `APP_GUARD` / `APP_INTERCEPTOR` / `APP_PIPE` / `APP_FILTER` *do* aggregate when registered more than once. | The article covers one token → one value. The plugin/strategy-array pattern is common in enterprise code and reads as impossible if you only know `multi: true`. |
| 05 `custom-providers-and-injection-tokens` | **Common mistake: writing `deps:` instead of `inject:`.** `deps` is Angular's name; on a Nest factory provider it is silently ignored, `inject` defaults to `[]`, and the factory is called with no arguments. | Silent-failure class, high frequency for anyone arriving from Angular. |
| 09 `request-lifecycle/execution-order` | **Owns binding scope and registration**: global vs controller vs handler binding; `app.useGlobalX()` vs the `APP_X` provider token; the ordering of several globals; and the DI limitation — `new LoggingInterceptor()` in `main.ts` cannot inject anything. | Would otherwise fall between articles 09–14, each of which owns one mechanism. |

### Wave 3 — auth, async, testing (11, provisional)

`auth/` — 30 `authentication-strategies` · 31 `jwt-and-refresh-tokens` · 32 `authorization-rbac-and-policies`
`async/` — 33 `queues-with-bullmq` · 34 `event-emitter` · 35 `scheduling-and-cron` · 36 `streaming-and-sse`
`testing/` — 37 `the-testing-module` · 38 `unit-testing-services-and-controllers` · 39 `integration-and-e2e-with-supertest` · 40 `testing-against-a-real-database`

Guards are owned by article 11 — the auth articles cite it and stay on the auth scenario.

### Wave 4 — architecture, observability, performance (13, provisional)

`architecture/` — 41 `dynamic-modules` · 42 `monorepo-and-shared-libraries` · 43 `microservices-transports` · 44 `cqrs` · 45 `layering-and-boundaries`
`observability/` — 46 `logging` · 47 `health-checks` · 48 `metrics-and-tracing` · 49 `graceful-shutdown`
`performance/` — 50 `caching` · 51 `adapter-choice` (owns the Fastify contrast) · 52 `blocking-the-event-loop` · 53 `request-scope-cost`

---

## 5. Recipe tracks

Symptom-first. A track opens only after its owning concept articles are drafted — recipes cite mechanisms, they don't teach them.

| Order | Track | Gated on | Sketch |
| --- | --- | --- | --- |
| 1 | `di-and-modules/` | Wave 1 | circular dependency, provider not found, request-scope bubbling, **my global interceptor can't inject anything** (`new X()` in `main.ts` vs `APP_INTERCEPTOR`) |
| 2 | `request-lifecycle/` | Wave 1 | guard-vs-interceptor ordering, the filter that swallowed the error, **middleware timing always logs 0 ms** (code after `next()` is not the post-handler hook — `res.on('finish')` is) |
| 3 | `validation/` | Wave 2 | DTO silently not validated, transform surprises |
| 4 | `data-access/` | Wave 2 | N+1 from lazy relations, transaction that didn't roll back, pool exhaustion, `synchronize` ate the column, **I added an index and the query got no faster** (selectivity, and reading `EXPLAIN`) |
| 5 | `auth/` | Wave 3 | refresh-token rotation, guard ordering, RBAC leak |
| 6 | `background-jobs/` | Wave 3 | duplicate jobs, stuck jobs, retry storms |
| 7 | `testing/` | Wave 3 | leaking test module, e2e DB state bleed |
| 8 | `performance/` | Wave 4 | request-scope memory growth, blocked event loop |
| 9 | `deployment/` | Wave 4 | config validation at boot, graceful shutdown |
| 10 | `microservices/` | Wave 4 | timeouts, serialization — see §8, highest grounding risk |

Target ~5 recipes per track; the number is an expectation, not a quota.

---

## 6. Conventions

### 6.1 Article structure

1. Frontmatter · 2. Lead-with-this callout · 3. What it is · 4. **How it works under the hood** · 5. Basic usage — complete and runnable, imports included (decision-table articles rename this **Minimal shapes**) · 6. **Walkthrough** — build something small end-to-end, progressive steps, full files · 7. Real-world patterns · 8. API/type reference table (when applicable) · 9. Common mistakes (7–10, with code) · 10. How this evolved (when applicable) · 11. Exercises (2–3, with hints) · 12. Summary · 13. See also · 14. References (official docs) · 15. Demo source

### 6.2 Recipe structure

1. Frontmatter · 2. H1 = the symptom as experienced, not a concept name · 3. "What you'll build" blockquote · 4. **The scenario** — concrete, with numbers, plus a *why it escaped QA* beat · 5. **Walkthrough** — name the mechanism → reject the wrong fixes → the real fix with real code → harden, ending in a *verify the loop* beat · 6. Variations (5) · 7. Trade-offs and common pitfalls (10–15) plus a mandatory **When NOT to…** block · 8. See also (≥3) · 9. References · 10. Demo source

### 6.3 Frontmatter

```yaml
# article — foundations/providers-and-di.md
article_id: providers-and-di   # slug, identical to the filename minus .md
concept_folder: foundations
wave: 1
nest_baseline: "11.1.x"
node_baseline: "24"
related: [foundations/modules-and-the-module-graph, recipes/di-and-modules/circular-dependency]
status:
  drafted: true
  reviewed: false
v12_watch: true                # this article owns a surface v12 changes
```

```yaml
# recipe — recipes/di-and-modules/circular-dependency.md
recipe_id: circular-dependency   # slug, identical to the filename minus .md
track: di-and-modules
primary_concept: foundations/providers-and-di
difficulty: intermediate         # foundational | intermediate | advanced
nest_baseline: "11.1.x"
related: [...]
status:
  drafted: true
  reviewed: false
v12_watch: false
```

**Id rule.** `article_id` and `recipe_id` are **kebab-case slugs identical to the filename**, never sequence numbers. They must be unique corpus-wide, not merely within a folder, so that a bare id is unambiguous in tooling and in conversation. The numbers in §4 and in `progress.md` are **ordering only** — they say what gets written when, and carry no identity. Renumbering a wave must never require touching an article.

**Status.** An object, not a string: `drafted` and `reviewed` are independent booleans. An article can be drafted and unreviewed (the normal state), or — after a baseline bump invalidates it — reviewed-then-reopened without losing the record.

`related` uses folder-prefixed concept slugs (`request-lifecycle/guards`) and sibling recipes prefixed `recipes/`.

### 6.4 Quality bar

- **Coverage bar, not line count.** Every section earns its place. Padding to hit a number violates the bar.
- The **walkthrough is the highest-leverage section** — never optional, never hand-waved.
- **Composition is content.** Recipes reference each other inside walkthroughs, not only in See also.
- **Cite, don't re-teach.** If an article owns a mechanism, link its section and keep the recipe on the scenario.
- Inline links `[text](../path/file.md#anchor)`; **every anchor resolves** to a real GitHub-slugified heading, verified mechanically before presenting. Broken anchors were the top recurring bug in both prior repos.
- **Self-audit before presenting, not after.**

### 6.5 Verification policy

The corpus is written against a framework being learned in the process, so:

- **Under-the-hood claims are traced to official docs or framework source.** A claim that can't be traced is hedged inline or cut. Never written from recall.
- **Recipe scenarios are reproducible against `demos/`.** No invented incident numbers, no plausible-sounding failures that were never observed. If a scenario can't be grounded, the recipe says so or doesn't ship.
- **Version-sensitive surfaces get checked at write time**, not assumed from the baseline table.
- **Outside learning material is topic signal, not fact.** Courses, blog posts, and AI-generated explanations are useful for finding gaps in this plan and for spotting what confuses readers. Nothing from them enters an article without independent verification against the docs or the source — the 2026-07-30 review found `deps` claimed as a Nest provider property, `Module` imported from `@nestjs/core`, and Nest's DI described as flat and global, all wrong.

### 6.6 Angular callouts (bounded)

NestJS is explicitly Angular-inspired, so the parallel is a real accelerator — but it's fenced:

- At most **one** callout per article, formatted `> **If you know Angular** …`
- **Difference-first.** State what diverges, not what matches: Nest DI resolves per module graph with no `providedIn: 'root'` tree-shaking analogue; there's no zone; request-scoped providers have no Angular equivalent.
- **Never load-bearing.** Deleting every callout must leave the article intact.

### 6.6a Angular callout ledger

One callout per article (§6.6), so each article spends it on a *different* comparison. This table prevents repetition and contradiction, and shows which articles still have theirs unspent.

| Article | Comparison spent |
| --- | --- |
| 01 `providers-and-di` | No `providedIn: 'root'`; every provider belongs to one module; no zone; request scope has no analogue |
| 02 `modules-and-the-module-graph` | `exports` means providers, not declarables; Angular providers were global anyway |
| 03 `controllers-and-routing` | No central `Routes` array; precedence is emergent, not visible in one file |
| 04 `decorators-and-metadata-reflection` | Angular reads decorators at build time and erases them; Nest reads them at runtime |
| 05 `custom-providers-and-injection-tokens` | **unspent** → `multi: true` has no Nest equivalent for custom tokens (`useFactory` aggregation), and Nest has no `inject()` function — constructor injection only |
| 06 `scopes-and-lifetimes` | **unspent** → Angular's hierarchical injector ties lifetime to component destruction; Nest's ties it to a request context |
| 07 `configuration-and-environment` | `environment.ts` is compile-time and type-checked; Nest config is runtime and unchecked |

### 6.7 Encoding

All files UTF-8. If a file round-trips through another tool, verify the status emoji and em-dashes survived before committing.

---

## 7. v12 policy

NestJS 12 is in `next` prerelease targeting early Q3 2026, and it is a platform-level release: ESM across core packages, a CLI prompt splitting CJS/ESM projects (ESM defaults to Vitest + oxlint; CJS keeps Jest), Rspack replacing webpack, and Standard Schema support in `@Body()`/`@Query()` opening a Zod/Valibot path alongside class-validator. GraphiQL becomes the default GraphQL playground.

**Policy:** write against v11, flag the delta as it's written.

- Any article touching a surface v12 changes sets `v12_watch: true` in frontmatter.
- `progress.md` carries a generated rollup of those articles — the GA pass is a targeted list, not a rewrite.
- Do **not** write "coming in v12" prose into article bodies against a moving prerelease. The flag is the record; body text lands after GA when it can be verified.

Surfaces expected to need the pass: module format and import conventions, CLI/build, the `testing/` folder, validation, GraphQL defaults, and any deep-import or metadata-reflection internals.

---

## 8. Known risks

| Risk | Mitigation |
| --- | --- |
| v12 lands mid-corpus | §7 — flag-and-rollup, not prose |
| `microservices/` recipes can't be grounded in observed failures | Track ordered last; ships only if the demo stack can reproduce the failures. Otherwise it stays concept-level in article 42 |
| `data/` claims (isolation behaviour, N+1 shapes, pool exhaustion) are empirically checkable and easy to get subtly wrong | The docker-compose Postgres is the verification instrument, not just demo infra — claims are reproduced before they're written |
| 52 articles is larger than either prior repo | Waves 3–4 counts are provisional and may be cut at wave boundaries |

---

## 9. Repo structure

```
nestjs-concepts/
├── README.md
├── roadmap.md
├── progress.md
├── docker-compose.yml          # Postgres 18 (+ Redis, from Wave 3)
├── foundations/
├── request-lifecycle/
├── validation/
├── data/
├── async/
├── auth/
├── testing/
├── architecture/
├── observability/
├── performance/
├── prompts/                    # Cursor task prompts + session handoffs
├── recipes/
│   ├── di-and-modules/
│   ├── request-lifecycle/
│   └── …
└── demos/
    ├── foundations/            # one incrementally-built app per folder
    ├── request-lifecycle/
    └── …
```

**One demo app per folder, not per article** — articles in a folder build the same app forward. A container per article is untenable once Postgres is in play.