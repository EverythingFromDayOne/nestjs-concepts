# Cursor prompt — extend `demos/foundations` for articles 03–04

> Save as `prompts/extend-foundations-demo-catalog-common.md`. Paste everything below the line into Cursor as a single instruction.

---

You are extending the existing `demos/foundations` app in the `nestjs-concepts` repo so that it compiles and runs every code sample in `foundations/controllers-and-routing.md` (article 03) and `foundations/decorators-and-metadata-reflection.md` (article 04).

## The discipline, unchanged from the last task

Take the code from the articles **verbatim**. Do not improve it, rename things, add error handling, or reorder imports. A sample that doesn't compile or doesn't behave as claimed is a **finding to report**, not a thing to quietly repair.

- Smallest possible change to get a green build; record every one in the divergence report.
- **Never edit a `.md` file.** Reconciliation happens separately, by hand.
- Where an article shows a broken version followed by a fixed one (marked `✗`), take the fixed one — except inside the experiments in §4, which deliberately apply broken versions and revert.

## 1. Dependency additions

Add to `demos/foundations` devDependencies: `@types/express`. Article 04's `@Tenant()` decorator imports `Request` from `express`.

Report the resolved version.

## 2. New source files

| File | Source |
| --- | --- |
| `src/catalog/catalog.service.ts` | article 03 "Basic usage" **plus** the Step 3 additions (`remove`, `toCsv`) |
| `src/catalog/catalog.controller.ts` | see the assembly note below |
| `src/catalog/catalog.module.ts` | article 03 "Basic usage" |
| `src/common/roles.decorator.ts` | article 04 **Step 3** — the `Reflector.createDecorator<string[]>()` version |
| `src/common/tenant.decorator.ts` | article 04 Step 5 |
| `src/common/admin-only.decorator.ts` | article 04 Step 5 — the single-decorator version, not the commented three-decorator line |
| `src/common/roles.decorator.spec.ts` | article 04 "Verify the loop" |

### Assembling `catalog.controller.ts`

Article 03 builds this controller across several steps and shows more than one version of some handlers. Compose the final state as follows, and **declare the handlers in exactly this order** — the order is the subject of the article:

1. `findAll` — `@Get()`
2. `findFeatured` — `@Get('featured')`
3. `exportCsv` — `@Get('export')`, using the **Step 4 `@Res({ passthrough: true })` version** with the `@Header('Content-Type', 'text/csv')` decorator retained
4. `docsIncludingRoot` — `@Get('docs/{*splat}')` (article 03 Step 5). Include **only** this one, not the `docs/*splat` variant — the article says to use one or the other
5. `findOne` — `@Get(':id')`
6. `create` — `@Post()`
7. `remove` — `@Delete(':id')` with `@HttpCode(HttpStatus.NO_CONTENT)`

Then apply article 04's annotations to this same controller: `@Roles(['viewer'])` at class level, `@Roles(['admin'])` on `remove`. Note the **array** argument form — that is what `Reflector.createDecorator<string[]>()` requires, and article 04's "Verify the loop" section says so explicitly.

Register `CatalogModule` in `src/app.module.ts` by adding it to the `imports` array. Change nothing else in that file.

## 3. Build and test

```bash
pnpm install
pnpm --filter foundations-demo build
pnpm --filter foundations-demo test
```

All specs must pass — the two existing ones plus the new roles spec. Report the output.

## 4. Experiments

These are the point of the task. Each one verifies a specific claim an article makes. **Apply, observe, record, revert.** Report what actually happened, not what was expected.

### 4a. The boot log is the routing table (article 03, Step 2)

Start the app and capture every `Mapped {…}` line for `CatalogController`, in order. Paste the real output into your report — article 03 prints an expected version and I want to know if the format or order differs.

### 4b. Route shadowing (article 03, Step 1)

Move `findOne` (`@Get(':id')`) to the **top** of the class, above `findFeatured`. Rebuild, then:

```bash
curl -i localhost:3000/products/featured
```

**Expected:** a 404 whose message comes from `CatalogService.findOne` — `No product with id featured` — not a routing error. Record the exact body. Also capture the `Mapped` lines again and confirm the order changed. **Revert.**

### 4c. Wildcard parameter shape (article 03, Step 5)

With `docs/{*splat}` in place:

```bash
curl localhost:3000/products/docs
curl localhost:3000/products/docs/getting/started
```

**Expected:** the first matches (braces make the segment optional) and the second yields the segments. Article 03 claims the param arrives as an **array of path segments**, and that with the braced form the param is **omitted entirely** when absent — which is why the handler has a `= []` default. Verify both by logging `typeof` and `Array.isArray` inside the handler. This is the claim I am least certain about; be precise.

Then temporarily switch the route to `docs/*splat` and confirm `/products/docs` **stops** matching. **Revert.**

### 4d. The bare asterisk (article 03, Step 5)

Temporarily add `@Get('legacy/*')`. Capture the exact `Unsupported route path` warning text at boot and confirm whether the route still works. **Revert.**

### 4e. `@Res()` without passthrough (article 03, Step 4)

Temporarily change `exportCsv` to take `@Res() res: Response` (no passthrough) and call `res.send(...)`, keeping the `@Header('Content-Type', 'text/csv')` decorator.

```bash
curl -i localhost:3000/products/export
```

**Expected:** the `Content-Type` header set by the decorator is **not** applied — the article claims the decorator goes inert. Record the actual headers. **Revert.**

### 4f. `getAllAndMerge` inverts for objects (article 04, Step 4)

Write a throwaway spec — `src/common/merge-check.spec.ts` — with an object-valued decorator applied at both class and handler level with one colliding key, and assert which value survives `getAllAndMerge(decorator, [handler, controller])`.

**Expected:** the **class** value wins the collision, because the reducer spreads later targets last. Then confirm reversing the targets flips it. Keep this spec — it is a useful regression test. Report the result either way.

### 4g. Decorator evaluation order (article 04, "How it works under the hood")

Article 04 prints a measured transcript of decorator evaluation and application order. It was produced under a standalone TypeScript 5.9.3 sandbox, **not** under this repo's `tsconfig.base.json`. Reproduce it here:

Create `demos/foundations/scripts/decorator-order.ts` with a class carrying: two class decorators, one property decorator, two method decorators on one method, two parameter decorators on that method, and one constructor parameter decorator — each logging on evaluation and on application. Run it with `ts-node` and paste the output.

**Expected**, per the article: members before the class; within a declaration, expressions top-to-bottom and functions bottom-to-top; a method's parameter decorators before the method decorator, applied right-to-left (index 1 before index 0).

Report any deviation from the transcript in the article — the article's transcript is the claim under test.

### 4h. The `design:paramtypes` diagnostic table (article 04)

In the same script or a second one, print `Reflect.getMetadata('design:paramtypes', X)` for three classes:

1. a decorated class whose constructor takes an **interface** parameter
2. a decorated class whose constructor takes only real classes
3. an **undecorated** class with constructor parameters

**Expected:** `[Object, …]`, the real class names, and `undefined` respectively. The third is the one worth confirming — article 04 builds a diagnostic table on `undefined` and `[Object]` being *different* failures.

## 5. Report

End with:

**Divergence table** — one row per place reality disagreed with the articles:

| Article | Section | What broke | Minimal change made (or proposed) |
| --- | --- | --- | --- |

If nothing diverged, say so explicitly.

**Experiment results** — one line per experiment 4a–4h: claim verified, or what actually happened.

**Also report:**

- resolved `@types/express` version
- the full `Mapped {…}` block from 4a
- the exact wildcard param shape from 4c
- anything ambiguous enough that you had to choose, and what you chose

## Out of scope

- No validation, DTOs, or `class-validator`.
- No guards or interceptors — articles 11 and 12 own those, and `@Roles()` here is read directly by the spec, not by a guard.
- No database, Docker, or TypeORM.
- No e2e tests or `supertest`; route matching is verified by curl and the boot log for now.
- No edits to any `.md` file.