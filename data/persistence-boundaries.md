---
article_id: persistence-boundaries
concept_folder: data
wave: 2
nest_baseline: "11.1.x"
node_baseline: "24"
related:
  - data/transactions-and-isolation
  - data/the-n-plus-one-problem
  - foundations/custom-providers-and-injection-tokens
  - foundations/modules-and-the-module-graph
  - foundations/scopes-and-lifetimes
  - validation/serialization-and-response-shaping
  - recipes/data-access/repository-leaked-orm-types
status:
  drafted: true
  reviewed: false
v12_watch: false
---

# Persistence boundaries

> **Lead with this.** Your ORM already gives you a repository. TypeORM has `Repository<T>`, Prisma has a generated client, Mongoose has a model — each is a perfectly good data-access object written by people who think about data access full time. So wrapping one in *another* repository buys you exactly one thing: **the ability to change your mind.** That is sometimes worth a great deal and usually worth nothing, and the honest way to decide is to ask whether you will actually change it. This corpus will — the roadmap commits to TypeORM, then Prisma, then MongoDB against the same concepts — which makes it one of the few codebases where the answer is unambiguously yes. Yours probably isn't. The boundary that matters regardless of how you answer is not the repository at all; it's **where the transaction begins**, and §Step 4 is about that.

> **A note on evidence.** Most articles in this corpus trace claims to framework source or a measurement. This one can't: "where should the boundary go" is an argument, not a fact. What *is* verifiable is the machinery Nest gives you for enforcing a boundary once you've chosen one, and §How it works sticks to that. Everything else is labelled as a trade-off, with its cost stated.

## What it is

Three shapes, in increasing order of separation:

| Shape | The service depends on | Buys you | Costs you |
| --- | --- | --- | --- |
| **A — direct** | the ORM's repository/client | nothing to maintain; full ORM power available | the ORM's types spread through your services; tests need the ORM |
| **B — port** | an abstract class you define | swappable implementation, DB-free tests, one place where queries live | a second type per aggregate, and the discipline to keep ORM types out of it |
| **C — domain model** | a port that returns *your* objects, not rows | persistence-ignorant domain logic | mappers both ways, and a second model to keep in sync |

Most applications should be A. B earns its keep under conditions §Step 2 makes concrete. C is a real pattern with real users and it is almost always more machinery than a CRUD service needs — this corpus uses B, because it has to.

The unit-of-work idea belongs here too: **a set of changes that commit or fail together**. Article 20 owns the mechanics; what this article owns is *who* draws that boundary, because that decision constrains everything above it.

> **If you know Angular.** The mapping is closer than it looks: an Angular service that wraps `HttpClient` behind a domain-shaped method is the same move — hide the transport, expose intent. Two differences matter. Angular's boundary is a *convenience* (nothing breaks if a component injects `HttpClient` directly), while here it can be a genuine **enforcement**, because Nest's module graph refuses to resolve a provider that wasn't exported — §How it works. And an Angular service has no transaction concept, so the hardest question in this article has no analogue: on the client there is nothing that must commit atomically across two calls.

## How it works under the hood

Three Nest mechanisms turn a boundary from a convention into something the framework enforces. Each was measured elsewhere in this corpus.

### An abstract class is both the contract and the token

```typescript
export abstract class UserRepository {
  abstract findById(id: string): Promise<User | null>;
}

@Injectable()
class UsersService {
  constructor(private readonly repo: UserRepository) {}   // no @Inject() needed
}
```

Measured:

```
paramtypes         : [ 'UserRepository' ]
is the same ref    : true
abstract at runtime: function
```

An `abstract class` compiles to a real function, so it survives erasure, gets recorded in `design:paramtypes`, and is the *same reference* Nest looks up as a token. That's why it needs no `@Inject()` — unlike a `Symbol` or an `interface`, both of which fail for the reasons in [article 00](../foundations/typescript-for-nest.md#the-erasure-ledger).

This is the single most useful DI fact for this layer: the artifact you type against and the artifact Nest resolves can be one file.

### The module graph enforces the boundary at boot

From [article 02](../foundations/modules-and-the-module-graph.md#you-cannot-export-what-you-dont-have): a provider not listed in `exports` is genuinely unreachable outside its module, and `validateExportedProvider` throws at startup for anything you export but don't own. So:

```typescript
@Module({
  providers: [{ provide: UserRepository, useClass: TypeOrmUserRepository }, UsersService],
  exports: [UsersService],        // ← the repository is NOT exported
})
export class UsersModule {}
```

Another module injecting `UserRepository` fails to boot. Not a lint rule, not a review comment — a startup error. That's a stronger guarantee than most layering conventions get, and it costs one line.

### Swapping is a one-line change — with one trap

`{ provide: UserRepository, useClass: X }` is the whole swap ([article 05](../foundations/custom-providers-and-injection-tokens.md)). The trap is scope: `useClass` **inherits the class's own `@Injectable({ scope })`**, and a request-scoped repository propagates non-staticness upward through every service that injects it ([article 06](../foundations/scopes-and-lifetimes.md#how-it-works-under-the-hood)). A repository is the wrong place for request scope; if it needs per-request context, pass the context in as an argument.

## Basic usage — shape A, and why it's fine

```typescript
// src/users/users.service.ts — the ORM's repository, injected directly
@Injectable()
export class UsersService {
  constructor(private readonly repo: Repository<User>) {}

  async findActive(): Promise<User[]> {
    return this.repo.find({ where: { active: true } });
  }
}
```

This is not a mistake. It's one type, no mapper, no indirection, and the ORM's full query surface is available where you need it. For an application that will run on one database for its life, shape A is the correct default and the rest of this article is about when it stops being.

## Walkthrough — deciding, then drawing the line

We start `demos/data/`. Worth noting: because this article is ORM-agnostic, **its demo needs no database** — an in-memory implementation exercises every claim here. The Postgres container arrives with [article 25](./typeorm-entities-and-relations.md).

### Step 1 — the test for whether you need a port

Three questions. If the answer to all three is no, stay with shape A.

1. **Will the persistence technology change?** Not "could it" — will it. A planned migration, a second data source, or a library you already distrust. Hypothetical portability has a poor track record.
2. **Do you need to test the domain logic without a database?** If the interesting logic is `if (order.total > limit)`, a fake repository makes that a millisecond unit test. If the interesting logic is the query itself, a fake tests nothing and you want [a real database](../testing/testing-against-a-real-database.md).
3. **Does the same data have more than one consumer with different needs?** A read model for a dashboard and a write model for an aggregate diverge naturally, and a single ORM entity serving both accumulates fields for both.

The dishonest version of this decision is adding a port "for testability" and then writing a fake so faithful to the ORM that maintaining it costs more than a test container. If your fake needs a query planner, you needed the database.

### Step 2 — the port, and the leak that defeats it

```typescript
// src/users/user.repository.ts
export interface UserFilter {
  readonly active?: boolean;
  readonly createdAfter?: Date;
}

export abstract class UserRepository {
  abstract findById(id: string): Promise<User | null>;
  abstract findMany(filter: UserFilter): Promise<User[]>;
  abstract save(user: User): Promise<User>;
  abstract delete(id: string): Promise<void>;
}
```

```typescript
// src/users/users.module.ts
import { Module } from '@nestjs/common';
import { InMemoryUserRepository } from './in-memory-user.repository';
import { UserRepository } from './user.repository';
import { UsersService } from './users.service';

@Module({
  providers: [
    UsersService,
    { provide: UserRepository, useClass: InMemoryUserRepository },
  ],
  exports: [UsersService],
})
export class UsersModule {}
```

Now the leak, which is the single most common way this pattern is implemented into uselessness:

```typescript
// ✗ this is not a port
export abstract class UserRepository {
  abstract find(options: FindManyOptions<User>): Promise<User[]>;   // TypeORM's type
  abstract createQueryBuilder(alias: string): SelectQueryBuilder<User>;
}
```

An abstraction whose signatures are the ORM's types is the ORM with extra steps. You cannot implement it with Prisma, you cannot fake it without importing TypeORM, and every service that calls `createQueryBuilder` is coupled to TypeORM through a class that claims otherwise. **The test: could a second implementation exist without importing the first one's library?** If not, delete the port and go back to shape A, which is at least honest.

The corollary is that a port's methods are named for **intent**, not for SQL: `findActiveSince(date)` rather than `find(options)`. That's more methods, and each one is a place where a query lives instead of a place where a query is assembled by a caller.

### Step 3 — what crosses the boundary

Three things, and only one of them should reach the controller.

| Object | Lives in | May reach |
| --- | --- | --- |
| row / ORM entity | repository | the service |
| domain object or entity | service | the service |
| response DTO | service or an interceptor | the controller and the wire |

The rule that matters is the last row, and [article 18](../validation/serialization-and-response-shaping.md#real-world-patterns) already argued it from the other end: **never serialize an entity**, because a new database column then becomes a public field. Persistence boundaries and serialization boundaries are the same boundary approached from opposite sides.

In shape B the entity may still be the object the port returns — you don't need a separate domain model to get the benefit. Shape C's mappers are what you add when the domain object genuinely differs from the row, and not before.

### Step 4 — where the transaction begins

This is the boundary that exists whether or not you drew a repository, and getting it wrong is more expensive than any amount of interface ceremony.

```typescript
// ✗ each repository call is its own transaction
async placeOrder(dto: PlaceOrderDto): Promise<Order> {
  const order = await this.orders.save(new Order(dto));   // commits
  await this.inventory.decrement(dto.sku, dto.quantity);  // commits — or throws
  await this.ledger.record(order.total);                  // commits — or throws
  return order;
}
```

If `inventory.decrement` throws, the order exists and the stock doesn't move. There is no rollback, because there was no transaction — three separate ones.

**The repository cannot fix this**, and that's the structural point. A repository's job is one aggregate; atomicity spans several. So the transaction has to be owned one level up, by whatever represents the use case — the service, or a dedicated command handler:

```typescript
// ✓ the use case owns the boundary; the repositories participate in it
async placeOrder(dto: PlaceOrderDto): Promise<Order> {
  return this.uow.run(async (tx) => {
    const order = await this.orders.save(new Order(dto), tx);
    await this.inventory.decrement(dto.sku, dto.quantity, tx);
    await this.ledger.record(order.total, tx);
    return order;
  });
}
```

That `tx` parameter is the design question this article can pose but not answer, because every ORM answers it differently — an explicit handle, an ambient async-context transaction, or a decorator. [Article 20](./transactions-and-isolation.md) covers the semantics and [article 27](./typeorm-transactions-in-nest.md) the TypeORM mechanics. What's fixed regardless:

- **A transaction is a property of a use case**, not of a repository call.
- **It must be visible in the signature or in a store**, never implied. An implicit transaction that silently isn't one is the failure at the top of this step.
- **The boundary is also the retry boundary and the isolation boundary.** Deciding it late means deciding all three late.

### Step 5 — testing without a database

The payoff of shape B, and the honest measure of whether the port is real:

```typescript
// src/users/in-memory-user.repository.ts
import { Injectable } from '@nestjs/common';
import { User } from './user.entity';
import { UserFilter, UserRepository } from './user.repository';

@Injectable()
export class InMemoryUserRepository extends UserRepository {
  private readonly rows = new Map<string, User>();

  async findById(id: string): Promise<User | null> {
    return this.rows.get(id) ?? null;
  }

  async findMany(filter: UserFilter): Promise<User[]> {
    return [...this.rows.values()].filter(
      (u) => (filter.active === undefined || u.active === filter.active),
    );
  }

  async save(user: User): Promise<User> {
    this.rows.set(user.id, user);
    return user;
  }

  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
}
```

```typescript
// src/users/users.service.spec.ts
const moduleRef = await Test.createTestingModule({
  providers: [
    UsersService,
    { provide: UserRepository, useClass: InMemoryUserRepository },
  ],
}).compile();
```

No container, no schema, no fixtures. And note what the fake *doesn't* do: no filtering by `createdAfter`, because nothing under test needs it yet. A fake that grows toward being a database is the signal from Step 1 that you should have used one.

**What this does not test** — and pretending otherwise is how a green suite ships a broken query: the actual SQL, the indexes, the isolation level, cascade behaviour, and the N+1 in [article 21](./the-n-plus-one-problem.md). Those need [a real database](../testing/testing-against-a-real-database.md). A port makes *domain* logic cheap to test; it does not make data access tested.

### Verify the loop

The property worth asserting is the one that decays silently — that the boundary is still a boundary:

```bash
# 1. no service imports the ORM
grep -rn "from 'typeorm'" src --include=*.service.ts | grep -v repository
#    expect: no output

# 2. the port is implementable twice — the in-memory one compiles against it
pnpm --filter data-demo build
```

```typescript
// 3. the module boundary is enforced, not merely intended
it('does not export the repository', async () => {
  const app = await Test.createTestingModule({ imports: [UsersModule] }).compile();
  expect(() => app.get(UserRepository, { strict: true })).toThrow();
});
```

The `grep` is worth putting in CI. Layering rules that aren't checked come apart in about six weeks, and the first import is always for a good reason.

## Real-world patterns

**Default to shape A.** One database, one team, no migration planned: inject the ORM's repository and move on. The ceremony has to be earned.

**Adopt shape B when Step 1's questions say yes**, and use an **abstract class** as the port — measured above, it's contract and token in one file with no `@Inject()`.

**A port that mentions ORM types is not a port.** The test is whether a second implementation could exist without importing the first one's library.

**Name port methods for intent.** `findActiveSince(date)`, not `find(options)`. Callers assembling queries is the boundary dissolving in slow motion.

**Don't export the repository from its module.** One line, enforced at boot, and it makes the service the only door.

**The use case owns the transaction.** Never a repository, and never implicitly.

**No request scope on a repository.** It propagates upward into everything that injects it.

**Entities never reach the wire.** Same boundary as [serialization](../validation/serialization-and-response-shaping.md), from the other side.

**Keep the fake dumb.** When it starts needing query semantics, that's Step 1 telling you to test against a real database instead.

## API reference

| Tool | From | Purpose here |
| --- | --- | --- |
| `abstract class` | TypeScript | contract **and** DI token; survives erasure, no `@Inject()` |
| `{ provide: Port, useClass: Impl }` | `@nestjs/common` | bind an implementation; inherits the class's scope |
| `{ provide: Port, useValue: fake }` | — | substitute in a test with no container wiring |
| `exports` | `@Module()` | what leaves the module — omit the repository |
| `Test.createTestingModule` | `@nestjs/testing` | swap the port per test |
| `moduleRef.get(token, { strict: true })` | `@nestjs/core` | assert a provider is *not* reachable |

## Common mistakes

**1. A port typed with ORM types.** `FindManyOptions`, `SelectQueryBuilder`, `Prisma.UserWhereInput` in an abstract class means there is no abstraction.

**2. Adding a port with no answer to Step 1.** Interfaces that will only ever have one implementation are cost without benefit.

**3. Exporting the repository.** Every module can now reach the database and the service layer becomes optional.

**4. Query assembly in the service.** `where`, `orderBy`, and joins in a service body are the ORM leaking through a boundary you drew.

**5. A transaction per repository call.** Multi-step use cases become partially applied on failure. The use case owns the boundary.

**6. Implicit transactions.** If a reader can't tell from the signature or an explicit store whether they're inside one, they'll eventually be wrong.

**7. Request-scoped repositories.** The scope propagates to every consumer; pass request context as an argument instead.

**8. Returning entities to controllers.** A new column becomes a public field.

**9. A fake that grows a query engine.** That's the signal to use a real database, not to keep extending the fake.

**10. Trusting green unit tests as data-access coverage.** They test your logic against your fake. The SQL, the indexes, and the isolation are untested until something runs against the real thing.

## How this evolved

The repository pattern predates ORMs that were any good, and much of the advice for it was written when the data-access layer *was* hand-written SQL. Modern ORMs absorbed the pattern — TypeORM's `Repository<T>` and Prisma's client are repositories — which is why "always use the repository pattern" reads as dated: the argument it was making has largely been won inside the library. What survives is the narrower claim this article makes: a **second** boundary is worth it when you'll change the first one, or when the domain logic deserves tests that don't need a schema.

The other shift is transactional. Ambient transaction context — `AsyncLocalStorage` under the hood, the same mechanism [article 12](../request-lifecycle/interceptors.md#asyncresourcebind-is-why-asynclocalstorage-survives) traced through the interceptor chain — has made implicit transaction propagation practical in Node, which is a real ergonomic win and a real legibility loss. §Step 4's warning stands either way: implicit is fine as long as it's *visible*.

## Exercises

**1. Apply Step 1 honestly.** Take a service you've written and answer the three questions out loud. *Hint: if the answer to (1) is "we might one day," that's a no.*

**2. Break your own port.** Add one ORM type to an abstract class's signature and then try to write a second implementation without importing that ORM. *Hint: the failure is immediate and total, which is what makes it a good test.*

**3. Find the missing transaction.** In any multi-write use case, remove the happy path and ask what state the database is in after step two of three fails. *Hint: if the answer requires reading the ORM's docs, the boundary isn't in your code.*

## Summary

- Your ORM already provides a repository. A second one buys **changeability** and nothing else — decide with Step 1's three questions, not by default.
- **Shape A** (ORM repository injected directly) is the right default for most applications and is not a mistake.
- An **abstract class** is contract and DI token in one — measured: it survives erasure, appears in `design:paramtypes` as the same reference, needs no `@Inject()`.
- **Not exporting the repository** makes the boundary a boot-time error rather than a convention.
- A port whose signatures mention ORM types **is not a port**. The test: could a second implementation exist without that library?
- The boundary that exists regardless is the **transaction**, and it belongs to the use case — never to a repository, and never implicitly.
- A fake repository makes **domain logic** cheap to test and leaves SQL, indexes, isolation, and N+1 entirely untested.
- Entities stop at the service; the wire gets a DTO.

## See also

- [Transactions and isolation](./transactions-and-isolation.md) — the semantics of the boundary drawn in Step 4
- [The N+1 problem](./the-n-plus-one-problem.md) — what a fake repository will never show you
- [Custom providers and injection tokens](../foundations/custom-providers-and-injection-tokens.md) — abstract class versus symbol, and the swap
- [Modules and the module graph](../foundations/modules-and-the-module-graph.md#you-cannot-export-what-you-dont-have) — why omitting `exports` is enforcement
- [Scopes and lifetimes](../foundations/scopes-and-lifetimes.md#how-it-works-under-the-hood) — why a request-scoped repository is contagious
- [Serialization and response shaping](../validation/serialization-and-response-shaping.md#real-world-patterns) — the same boundary, outbound
- [Testing against a real database](../testing/testing-against-a-real-database.md) — what the fake doesn't cover
- [Recipe: my repository leaked ORM types](../recipes/data-access/repository-leaked-orm-types.md)

## References

- [Providers](https://docs.nestjs.com/providers) — official docs
- [Custom providers](https://docs.nestjs.com/fundamentals/custom-providers) — official docs, abstract classes as tokens
- [Testing](https://docs.nestjs.com/fundamentals/testing) — `Test.createTestingModule` and provider overriding
- Martin Fowler, *Patterns of Enterprise Application Architecture* — the original Repository and Unit of Work definitions, worth reading for what they actually claimed

## Demo source

`demos/data/` — the port, an in-memory implementation, and the service specs. **No database required for this article**; the Postgres container arrives with article 25.