# nestjs-concepts

Concept articles and symptom-first debugging recipes for NestJS.

The articles explain mechanisms — how the injector resolves a token, what order
the request pipeline runs in, where a transaction boundary actually sits. The
recipes start from a symptom you would see in a real application and work back
to the cause. TypeScript strict throughout.

This is not a mirror of the official documentation. Where the docs already say
something plainly, these articles link them and spend their words on the
mechanism underneath, the failure mode, or the trade-off.

## Baseline

| Surface | Version |
| --- | --- |
| NestJS | 11.1.x |
| Node | 24 LTS |
| HTTP adapter | Express 5 |
| ORM | TypeORM 1.1.x |
| Database | PostgreSQL 18 |
| Test runner | Jest |

Phase 1 of the data layer is TypeORM + PostgreSQL. Prisma + MySQL and MongoDB
are planned as later contrast passes, so `data/` separates ORM-agnostic
concepts from TypeORM-specific implementation.

## Layout

- Concept folders (`foundations/`, `request-lifecycle/`, `validation/`, `data/`,
  `async/`, `auth/`, `testing/`, `architecture/`, `observability/`,
  `performance/`) hold the articles.
- `recipes/<track>/` holds the symptom-first recipes.
- `demos/` holds one runnable application per concept folder, built forward
  across the articles in that folder.
- `roadmap.md` is the plan. `progress.md` is the live tracker.

## Running the demos

Start the database:

```bash
pnpm db:up
```

PostgreSQL listens on host port **55432** — deliberately not 5432, so it does
not collide with a local install. Copy `.env.example` to `.env` first if you
want to change the credentials.

Install and run a demo from the repo root:

```bash
pnpm install
pnpm --filter <demo-name> start:dev
```

Stop the database with `pnpm db:down`, or `pnpm db:reset` to drop the volume.

## Checking links

Every internal link and anchor in the corpus should resolve:

```bash
pnpm check:links
```

## License

Prose is CC BY 4.0, code is MIT. See `LICENSE`.
