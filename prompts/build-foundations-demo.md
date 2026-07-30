# Cursor prompt — build `demos/foundations`

> Save as `prompts/build-foundations-demo.md`. Paste everything below the line into Cursor as a single instruction.

---

You are building the first demo application in the `nestjs-concepts` repo: `demos/foundations`.

## What this task actually is

This is **not** a task to write a nice Nest app. Every code sample in `foundations/providers-and-di.md` and `foundations/modules-and-the-module-graph.md` was written but never compiled. This app exists to compile and run that code, so that any sample that doesn't work is caught now rather than by a reader.

That inverts the usual instruction. **Take the code from the articles verbatim.** Do not improve it, rename things, add error handling, reorder imports, or "fix" style. If a sample does not compile or does not behave as the article claims, that is a **finding to report**, not a thing to quietly repair.

- If a change is unavoidable to get a green build, make the **smallest possible** change and record it in the divergence report at the end.
- **Never edit the `.md` article files.** Reconciliation happens separately, by hand.

## 1. Package setup

Create `demos/foundations/` as a workspace package. The root `pnpm-workspace.yaml` already globs `demos/*`.

`demos/foundations/package.json`:

```json
{
  "name": "foundations-demo",
  "version": "0.0.0",
  "private": true,
  "scripts": {
    "build": "nest build",
    "start": "nest start",
    "start:dev": "nest start --watch",
    "test": "jest"
  },
  "jest": {
    "moduleFileExtensions": ["js", "json", "ts"],
    "rootDir": "src",
    "testRegex": ".*\\.spec\\.ts$",
    "transform": { "^.+\\.(t|j)s$": "ts-jest" },
    "testEnvironment": "node"
  }
}
```

Then install into that package (from the repo root, using `--filter foundations-demo`):

- dependencies: `@nestjs/common@^11`, `@nestjs/core@^11`, `@nestjs/platform-express@^11`, `reflect-metadata@^0.2`, `rxjs@^7`
- devDependencies: `@nestjs/cli@^11`, `@nestjs/schematics@^11`, `@nestjs/testing@^11`, `@types/jest`, `@types/node`, `jest`, `ts-jest`, `ts-node`, `typescript@^5`

**Report the exact resolved versions of `@nestjs/core` and `typescript`.** The corpus claims an `11.1.x` baseline and I want the real numbers recorded.

`demos/foundations/tsconfig.json`:

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "outDir": "./dist",
    "baseUrl": "./"
  },
  "include": ["src/**/*"]
}
```

`demos/foundations/nest-cli.json`:

```json
{
  "$schema": "https://json.schemastore.org/nest-cli",
  "collection": "@nestjs/schematics",
  "sourceRoot": "src",
  "compilerOptions": {
    "deleteOutDir": true
  }
}
```

Do **not** run `nest new` — it would fight the workspace layout and overwrite the tsconfig inheritance.

## 2. Source files, and where each comes from

Read the two article files and lift the code blocks. This table is the map; the articles are the source of truth for contents.

| File | Source |
| --- | --- |
| `src/main.ts` | article 01, "Basic usage" |
| `src/cats/cats.service.ts` | article 01, "Basic usage" |
| `src/cats/cats.controller.ts` | article 01, "Basic usage" |
| `src/config/config.service.ts` | article 01, walkthrough Step 4 |
| `src/config/config.module.ts` | article 01, walkthrough Step 4 |
| `src/notifications/notification-transport.interface.ts` | article 01, Step 2 |
| `src/notifications/notification.tokens.ts` | article 01, Steps 3 and 5 — **both** `NOTIFICATION_TRANSPORT` and `METRICS_SINK` |
| `src/notifications/transports/console.transport.ts` | article 01, Step 3 |
| `src/notifications/transports/buffered.transport.ts` | article 01, Step 3 |
| `src/notifications/notifications.service.ts` | article 01, **Step 5** version (the one with `@Optional()`), not Step 3's |
| `src/notifications/notifications.module.ts` | article 01, **Step 4** version (the `useFactory` one), not Step 3's |
| `src/notifications/notifications.service.spec.ts` | article 01, "Verify the loop" |
| `src/ledger/ledger.service.ts` | article 02, "Basic usage" |
| `src/ledger/ledger.module.ts` | article 02, "Basic usage" — the version **with** `exports` |
| `src/orders/orders.service.ts` | article 02, Step 1 |
| `src/orders/orders.module.ts` | article 02, **Step 4** version (imports `LedgerModule` and `BillingModule`) |
| `src/orders/orders.controller.ts` | article 02, Step 3 |
| `src/billing/billing.service.ts` | article 02, Step 2 |
| `src/billing/billing.module.ts` | article 02, Step 2 — the correct version, **not** the Step 3 duplicate-registration one |
| `src/ledger/ledger.module.spec.ts` | article 02, "Verify the loop" |

Where an article shows a broken version followed by a fixed one, take the **fixed** one. The broken versions are all marked with `✗` in a comment.

### `src/app.module.ts` — the one file neither article specifies

Each article shows a partial `AppModule` for its own purpose. The demo needs the union. Write exactly this, and note it in the report as an intentional composition rather than a lift:

```typescript
import { Module } from '@nestjs/common';
import { BillingModule } from './billing/billing.module';
import { CatsController } from './cats/cats.controller';
import { CatsService } from './cats/cats.service';
import { NotificationsModule } from './notifications/notifications.module';
import { OrdersController } from './orders/orders.controller';
import { OrdersModule } from './orders/orders.module';

@Module({
  imports: [NotificationsModule, OrdersModule, BillingModule],
  controllers: [CatsController, OrdersController],
  providers: [CatsService],
})
export class AppModule {}
```

`CatsService` is registered directly here because that is what article 01's Basic usage shows. Leave it that way even though a `CatsModule` would be tidier — the article is what's being verified.

## 3. Build and test

From the repo root:

```bash
pnpm install
pnpm --filter foundations-demo build
pnpm --filter foundations-demo test
```

Both specs must pass. Report the output.

## 4. Runtime verification

Start the app (`pnpm --filter foundations-demo start`) and check the two behaviours the articles assert:

```bash
curl -X POST localhost:3000/cats -H 'content-type: application/json' -d '{"name":"Ada","age":3}'
curl localhost:3000/cats
# expect the cat back

curl -X POST localhost:3000/orders -H 'content-type: application/json' -d '{"account":"acme","amount":250}'
curl localhost:3000/orders/acme/balance
# expect {"balance":250}
```

## 5. The experiment — prove the article's central claim

Article 02, Step 3 claims that registering `LedgerService` in two modules boots cleanly and silently returns a wrong balance. Verify it, then undo it:

1. Add `LedgerService` to `BillingModule`'s `providers` array (this is the `✗` version in the article).
2. Run `pnpm --filter foundations-demo test`. **Expected: the app still boots, and `ledger.module.spec.ts` fails asserting `0` instead of `250`.**
3. Record what actually happened.
4. **Revert step 1.** Confirm the tests pass again.

If the app fails to boot, or the balance is not `0`, the article is wrong and I need to know precisely how.

## 6. Divergence report

End with a table. One row per place reality disagreed with the articles:

| Article | Section | What broke | Minimal change made (or proposed) |
| --- | --- | --- | --- |

If nothing diverged, say so explicitly — do not leave the table out.

Also report:

- resolved `@nestjs/core` and `typescript` versions
- the result of the Step 5 experiment
- anything the articles left ambiguous enough that you had to choose (name the choice)

## Out of scope

- No validation pipes, DTOs, or `class-validator` — article 16's territory, and adding it changes what article 01's code proves.
- No database, no `docker compose`, no TypeORM.
- No e2e tests or `supertest`.
- No linting setup, no Prettier config, no CI.
- No edits to any `.md` file anywhere in the repo.