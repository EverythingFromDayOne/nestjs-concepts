---
article_id: controllers-and-routing
description: There is no routing table — precedence emerges from declaration order, which is why a shadowed route raises no error
concept_folder: foundations
wave: 1
nest_baseline: "11.1.x"
node_baseline: "24"
related:
  - foundations/providers-and-di
  - foundations/modules-and-the-module-graph
  - foundations/decorators-and-metadata-reflection
  - request-lifecycle/execution-order
  - validation/dtos-and-class-validator
  - recipes/request-lifecycle/route-shadowed-by-a-param
status:
  drafted: true
  reviewed: false
v12_watch: true
---

# Controllers and routing

> **Lead with this.** There is no routing table in a Nest application. There is no file you can open to see which handler wins for `GET /products/featured`. The route map is assembled at boot by reading metadata off every method of every controller in every module, and the order it comes out in — which decides who wins when two routes could match — is an emergent property of the order you declared your methods and registered your modules. That is the single most surprising thing about Nest routing, and the source of the one routing bug that produces no error at all: a route that is never reached because another route quietly matched first.

## What it is

A controller is a class with `@Controller()` metadata whose methods are bound to HTTP routes. It is the boundary between the transport and your application: it takes a request apart, hands the pieces to providers, and returns a value that Nest turns back into a response.

A controller is also an ordinary DI consumer. Its constructor is resolved by the same injector, from the same module scope, under the same rules as any provider — see [providers and DI](./providers-and-di.md). The difference is that controllers are registered in a module's `controllers` array rather than `providers`, they are never injectable into anything else, and they are the only classes whose methods get bound to routes.

The job description worth holding to: **controllers decide nothing.** They translate. Business logic that lives in a controller cannot be reused by a queue consumer, a scheduled job, or a CLI command, all of which are coming in later waves.

> **If you know Angular.** Angular's routes live in one `Routes` array — a single artifact you can read top to bottom, where precedence is visibly the order of that array. Nest has no such artifact. Routing is decentralized across controller classes, and precedence emerges from method declaration order within a class plus the order modules were registered. Nothing in your codebase displays the resulting order; the boot log is the closest thing, and reading it is a habit worth forming.

## How it works under the hood

### `@Controller()` writes metadata on the class, `@Get()` writes it on the method

`@Controller('products')` stores the prefix under `PATH_METADATA` on the class. If a class in a module's `controllers` array has no such metadata, boot fails:

```typescript
// paraphrased from packages/core/router/router-explorer.ts — extractRouterPath
const path = Reflect.getMetadata(PATH_METADATA, metatype);
if (isUndefined(path)) {
  throw new UnknownRequestMappingException(metatype);
}
```

The method decorators are thinner than they look. Every one of them — `@Get`, `@Post`, `@Put`, `@Delete`, `@Patch`, `@Options`, `@Head`, `@All` — is the same factory with a different enum:

```typescript
// paraphrased from packages/common/decorators/http/request-mapping.decorator.ts
return (target, key, descriptor) => {
  Reflect.defineMetadata(PATH_METADATA, path, descriptor.value);
  Reflect.defineMetadata(METHOD_METADATA, requestMethod, descriptor.value);
  return descriptor;
};
```

Note where that metadata lands: on `descriptor.value`, **the method function itself**, not on the class. The route travels with the function. That's why a handler inherited from a base controller keeps its route, and why the method's *name* is irrelevant — Nest attaches no meaning to `findAll` versus `getEverything`.

### Discovery order is declaration order

At boot, `PathsExplorer` walks the controller's prototype and keeps the methods that carry path metadata:

```typescript
// paraphrased from packages/core/router/paths-explorer.ts
return this.metadataScanner
  .getAllMethodNames(instancePrototype)
  .reduce((acc, method) => {
    const route = this.exploreMethodMetadata(instance, instancePrototype, method);
    if (route) acc.push(route);
    return acc;
  }, []);
```

`getAllMethodNames` is `Object.getOwnPropertyNames` over the prototype, walking up the chain, deduplicating by name and skipping the constructor, getters, setters, and non-functions. Two consequences that matter:

- **Methods come out in the order they appear in the class body.** That order becomes registration order.
- **Inherited methods come after own methods**, because the walk starts at the subclass's prototype.

### Registration is ordinary adapter registration, so first match wins

For each discovered route, Nest resolves the adapter's method and registers a handler:

```typescript
// paraphrased from router-explorer.ts — applyCallbackToRouter
const routerMethodRef = this.routerMethodFactory.get(router, requestMethod).bind(router);
// …
routerMethodRef(path, routeHandler);
```

That is `router.get(path, handler)` on Express. Nest adds no matching logic of its own — **Express matches in registration order and the first match wins.** Combine that with declaration order and you get the whole precedence rule:

> The first handler declared whose pattern matches the URL is the one that runs. `:id` declared above `featured` means `/products/featured` is handled by the `:id` route with `id === 'featured'`, and no error is raised anywhere.

Path assembly is unremarkable: the controller prefix and the method path each get a leading slash added and are concatenated, and both accept arrays for multiple paths.

Controllers whose dependency tree isn't static — anything touching a request-scoped provider — get a different handler that instantiates the controller per request instead of once at boot. That mechanism belongs to [scopes and lifetimes](./scopes-and-lifetimes.md).

### Express 5 changed what a path string may contain

Nest 11 ships Express 5, which brings a rewritten path-to-regexp. The wildcard `*` is no longer a bare catch-all: **it must be named** — `/*splat`, where `splat` is an ordinary name with no special meaning. Braces mark an optional part of the path, and **the slash must be inside them**: `path{/*splat}`, not `path/{*splat}`. Put the slash outside and it stays required, so the pattern matches `/path/` but not `/path` — a distinction §Step 5 measures. The symbols `?`, `*`, and `+` no longer mean optional or repeating, and regex-style alternation in a path is unsupported.

Nest softens the landing with a `LegacyRouteConverter` that rewrites old syntax at boot and logs `Unsupported route path: …`. Treat that log line as an error you haven't fixed yet, not a notice. Note also that mid-path wildcards differ by adapter: Express accepts `ab{*splat}cd`; Fastify does not support them at all.

## Basic usage

```typescript
// src/catalog/catalog.service.ts
import { Injectable, NotFoundException } from '@nestjs/common';

export interface Product {
  id: string;
  name: string;
  featured: boolean;
}

@Injectable()
export class CatalogService {
  private readonly products: Product[] = [
    { id: '1', name: 'Desk lamp', featured: true },
    { id: '2', name: 'Notebook', featured: false },
  ];

  findAll(): Product[] {
    return this.products;
  }

  findFeatured(): Product[] {
    return this.products.filter((product) => product.featured);
  }

  findOne(id: string): Product {
    const product = this.products.find((candidate) => candidate.id === id);
    if (!product) {
      throw new NotFoundException(`No product with id ${id}`);
    }
    return product;
  }

  create(name: string): Product {
    const product: Product = { id: String(this.products.length + 1), name, featured: false };
    this.products.push(product);
    return product;
  }
}
```

```typescript
// src/catalog/catalog.controller.ts
import { Body, Controller, Get, Param, Post } from '@nestjs/common';
import { CatalogService, Product } from './catalog.service';

@Controller('products')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get()
  findAll(): Product[] {
    return this.catalog.findAll();
  }

  @Get('featured')
  findFeatured(): Product[] {
    return this.catalog.findFeatured();
  }

  @Get(':id')
  findOne(@Param('id') id: string): Product {
    return this.catalog.findOne(id);
  }

  @Post()
  create(@Body('name') name: string): Product {
    return this.catalog.create(name);
  }
}
```

```typescript
// src/catalog/catalog.module.ts
import { Module } from '@nestjs/common';
import { CatalogController } from './catalog.controller';
import { CatalogService } from './catalog.service';

@Module({
  controllers: [CatalogController],
  providers: [CatalogService],
})
export class CatalogModule {}
```

Return a value and Nest handles the response: objects and arrays are serialized to JSON, primitives are sent as-is without serialization. The status is 200, except `@Post()` which defaults to 201.

The ordering of `findFeatured` above `findOne` is not stylistic. Swap them and `/products/featured` breaks.

## Walkthrough — the routing bugs that don't raise errors

We extend `demos/foundations` with `src/catalog/`. Each step introduces a failure that a compiler cannot catch.

### Step 1 — the shadowed route

Start from the Basic usage controller with the two `@Get` handlers in the wrong order:

```typescript
// src/catalog/catalog.controller.ts — ✗ ordering bug
@Controller('products')
export class CatalogController {
  constructor(private readonly catalog: CatalogService) {}

  @Get(':id')
  findOne(@Param('id') id: string): Product {
    return this.catalog.findOne(id);
  }

  @Get('featured')
  findFeatured(): Product[] {
    return this.catalog.findFeatured();
  }
}
```

```bash
curl localhost:3000/products/featured
# {"statusCode":404,"message":"No product with id featured","error":"Not Found"}
```

Read that response carefully. It is a 404, so it looks like a missing-route problem — but the message came from `CatalogService.findOne`. The request reached the wrong handler, which then failed for its own reasons. Had `findOne` returned `undefined` instead of throwing, you'd have got a silent `200` with an empty body and no clue at all.

The fix is to move `findFeatured` above `findOne`. Nothing else. The rule to internalise: **static segments before parameterised ones, always**, because registration order is declaration order and the first match wins.

### Step 2 — read the boot log, which is the routing table

Nest prints every route as it registers it, in registration order:

```
[RoutesResolver] CatalogController {/products}:
[RouterExplorer] Mapped {/products, GET}
[RouterExplorer] Mapped {/products/featured, GET}
[RouterExplorer] Mapped {/products/:id, GET}
[RouterExplorer] Mapped {/products, POST}
```

This is as close to a routing table as Nest offers, and it is authoritative: the order printed *is* the matching precedence. Before debugging a route that "doesn't work", read this list. If `/products/:id` appears above `/products/featured`, you have already found the bug.

### Step 3 — status codes and headers

Defaults cover most cases; when they don't, stay in the standard response mode:

```typescript
// src/catalog/catalog.controller.ts (additions)
import {
  Body, Controller, Delete, Get, Header, HttpCode, HttpStatus, Param, Post,
} from '@nestjs/common';

@Controller('products')
export class CatalogController {
  // …

  @Post()
  @HttpCode(HttpStatus.CREATED) // explicit, though POST already defaults to 201
  create(@Body('name') name: string): Product {
    return this.catalog.create(name);
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT) // 204 — nothing to return
  remove(@Param('id') id: string): void {
    this.catalog.remove(id);
  }

  @Get('export')
  @Header('Content-Type', 'text/csv')
  @Header('Cache-Control', 'no-store')
  exportCsv(): string {
    return this.catalog.toCsv();
  }
}
```

`@HttpCode` takes a number; `HttpStatus` is an enum that makes it readable. Both decorators are handled by Nest's response layer — which matters for the next step, because that layer is exactly what `@Res()` switches off.

Add the two service methods this assumes:

```typescript
// src/catalog/catalog.service.ts (additions)
  remove(id: string): void {
    const index = this.products.findIndex((candidate) => candidate.id === id);
    if (index === -1) {
      throw new NotFoundException(`No product with id ${id}`);
    }
    this.products.splice(index, 1);
  }

  toCsv(): string {
    const rows = this.products.map((p) => `${p.id},${p.name},${p.featured}`);
    return ['id,name,featured', ...rows].join('\n');
  }
```

Note `/products/export` must be declared above `@Get(':id')` too. Every static route you add is a chance to reintroduce Step 1.

### Step 4 — the `@Res()` trap

Sooner or later you need the native response object — to set a cookie, stream a file, or choose a status dynamically. The naive reach for it costs more than it looks:

```typescript
// ✗ this silently disables Nest's response handling
import { Res } from '@nestjs/common';
import type { Response } from 'express';

@Get('export')
@Header('Content-Type', 'text/csv')  // ✗ now inert
exportCsv(@Res() res: Response): void {
  res.send(this.catalog.toCsv());
}
```

Injecting `@Res()` puts the handler into **library-specific mode**. What that actually switches off is narrower than the official docs suggest, and worth being precise about, because the imprecision leads people to change the wrong thing.

In `router-execution-context.ts`, `setStatus` and `setHeaders` run **unconditionally**, before interceptors and before your handler. Only the final send is gated:

```typescript
// paraphrased — the handler pipeline
this.responseController.setStatus(res, httpStatusCode);
hasCustomHeaders && this.responseController.setHeaders(res, responseHeaders);
// … interceptors, then your handler …
!isResponseHandled && (await this.responseController.apply(result, res, httpStatusCode));
```

`isResponseHandled` is true when `@Res()` or `@Next()` is present without `passthrough`. So in v11.1.28: **`@Header` and `@HttpCode` still apply** — measured, the `text/csv` header does arrive — and **interceptors still run**. What you lose is Nest sending the body, which means the handler's **return value is ignored** and any interceptor that *transforms* the response has its result discarded. And forget `res.send()` on some branch and the request hangs until the client times out, with no error logged.

The official docs say plainly that you lose `@HttpCode()` and `@Header()` in this mode. The v11.1.28 source says otherwise, and the running app agrees with the source. Treat the docs as the statement of intent and don't build on the gap: decorated headers surviving `@Res()` is behaviour that could be tightened in any release.

The fix, when you only need to *touch* the response rather than own it:

```typescript
// ✓ passthrough keeps Nest in charge of sending
@Get('export')
@Header('Content-Type', 'text/csv')
exportCsv(@Res({ passthrough: true }) res: Response): string {
  res.setHeader('X-Row-Count', String(this.catalog.findAll().length));
  return this.catalog.toCsv();
}
```

With `passthrough: true` you can set headers, cookies, or a dynamic status on the native object while still returning a value and keeping decorators and interceptors working. Reserve bare `@Res()` for cases where you genuinely take over the response — streaming and server-sent events, both later articles.

### Step 5 — a wildcard under Express 5

A catch-all for documentation paths:

```typescript
// ✗ Express 5 rejects the bare asterisk; Nest converts it and warns
@Get('docs/*')
docs(): string {
  return 'docs';
}
```

Boot logs `Unsupported route path: "/products/docs/*"` and the `LegacyRouteConverter` rewrites it. The route may work; you are relying on a compatibility shim. Name the wildcard instead:

```typescript
// ✓ matches /products/docs/anything/here — but not /products/docs
@Get('docs/*splat')
docs(@Param('splat') splat: string[]): string {
  return `docs: ${splat.join('/')}`;
}

// ✓ matches /products/docs as well — note the slash is INSIDE the braces
@Get('docs{/*splat}')
docsIncludingRoot(@Param('splat') splat: string[] = []): string {
  return `docs: ${splat.join('/')}`;
}
```

**Brace placement is the whole trick, and it is easy to get backwards.** Braces make what's inside them optional; a slash left outside them stays mandatory. Measured against path-to-regexp 8.4.2:

| Pattern | `/products/docs` | `/products/docs/` | `/products/docs/getting/started` |
| --- | --- | --- | --- |
| `docs/*splat` | no match | no match | `['getting','started']` |
| `docs/{*splat}` | **no match** | match, `{}` | `['getting','started']` |
| `docs{/*splat}` | match, `{}` | match, `{}` | `['getting','started']` |

The middle row is the trap: it reads like the inclusive form and behaves like the exclusive one, except for a bare trailing slash almost nobody types.

Two further details make the type annotations above correct rather than decorative. A wildcard param is captured as an **array of path segments**, not a string — `/products/docs/a/b` yields `['a', 'b']`. And when the optional part is absent the parameter is **omitted from params entirely** — `{}`, not `{ splat: [] }` — which is why `docsIncludingRoot` needs the `= []` default rather than trusting an empty array to arrive.

Use one or the other, not both — they overlap, and the first declared wins.

### Verify the loop

Route *matching* cannot be checked by a unit test that calls the handler directly — calling `controller.findFeatured()` proves the method works and proves nothing about whether a request ever reaches it. Two checks that do work today:

```bash
# 1. the boot log, read as the routing table
npm run start | grep Mapped

# 2. the routes themselves
curl localhost:3000/products/featured   # the shadowing check
curl localhost:3000/products/1
curl -i -X DELETE localhost:3000/products/2   # expect 204, empty body
curl -i localhost:3000/products/export        # expect the CSV content type
```

The honest gap: none of this is automated. A test that asserts `/products/featured` reaches the right handler needs the HTTP layer, which is [end-to-end testing](../testing/integration-and-e2e-with-supertest.md). Until that article, the boot log is the check, and reading it after adding any route is the discipline.

## Real-world patterns

**Controllers translate; they don't decide.** A handler that reads a request, calls one service method, and returns the result is the target shape. Anything longer is logic that a queue consumer or scheduled job will not be able to reuse.

**Order routes deliberately, not alphabetically.** Group by shape: collection routes, then static sub-paths, then parameterised ones. An editor's "sort members" command has broken production routing before.

**Never use `@Req()` to pull out params and body.** `@Param()`, `@Query()`, `@Body()`, and `@Headers()` are adapter-agnostic; reaching into the raw request couples the handler to Express and breaks the day the same controller is reused behind Fastify or a microservice transport.

**Treat every route param as a string.** `@Param('id') id: string` is the truth — the type annotation is not a conversion. Turning it into a number is a pipe's job, covered in [pipes](../request-lifecycle/pipes.md), and doing it by hand in the handler is the pattern that later becomes an unvalidated input.

**`@All()` for proxies and catch-alls only.** It binds every HTTP method at that path, including `OPTIONS` and `HEAD` — far more surface than most handlers want, and a route that answers methods you never intended to support.

**Sub-domain routing** is available via `@Controller({ host: 'admin.example.com' })`, with `@HostParam()` for dynamic segments — useful for multi-tenant setups, and worth knowing exists before you build path-based tenancy you'll regret.

**Versioning belongs to the framework, not your paths.** Nest has a versioning mechanism with URI, header, and media-type strategies. Hand-rolling `@Controller('v1/products')` works until you need two versions of one controller.

## API reference

| Symbol | Import | Purpose |
| --- | --- | --- |
| `@Controller(prefix?)` | `@nestjs/common` | marks a class as a controller; required, and the prefix may be a string or array |
| `@Controller({ host, path, version })` | `@nestjs/common` | object form for sub-domain and versioned routing |
| `@Get` `@Post` `@Put` `@Delete` `@Patch` `@Options` `@Head` | `@nestjs/common` | bind a handler to that HTTP method and path |
| `@All()` | `@nestjs/common` | binds every HTTP method |
| `@Param(key?)` | `@nestjs/common` | route parameters; always strings |
| `@Query(key?)` | `@nestjs/common` | query string parameters |
| `@Body(key?)` | `@nestjs/common` | parsed request body, or one property of it |
| `@Headers(name?)` | `@nestjs/common` | request headers |
| `@HttpCode(status)` | `@nestjs/common` | overrides the default response status |
| `@Header(name, value)` | `@nestjs/common` | sets a response header |
| `@Redirect(url, status?)` | `@nestjs/common` | redirects; can be overridden by returning `{ url, statusCode }` |
| `@Res({ passthrough })` | `@nestjs/common` | native response object; **without** `passthrough` it disables Nest's response handling |
| `@Req()` | `@nestjs/common` | native request object — prefer the specific decorators |
| `@HostParam(key?)` | `@nestjs/common` | dynamic segment of a `host` pattern |

## Common mistakes

**1. A class in `controllers` with no `@Controller()`.** Boot fails with `UnknownRequestMappingException`. The loud version of this family — be glad when you get it.

**2. Parameterised route declared before a static one.**

```typescript
@Get(':id')      findOne() {}     // ✗ swallows everything below
@Get('featured') findFeatured() {} // never reached
```

No error. The symptom is a 404 or a wrong result from the *other* handler.

**3. Controller not registered in any module.** Every route in it silently doesn't exist. Check the boot log for the `RoutesResolver` line naming the controller.

**4. Bare `*` wildcards.** Under Express 5 these are converted by a compatibility shim and logged as unsupported — the real warning reads `Unsupported route path: "/products/legacy/*"... Attempting to auto-convert to "/products/legacy/{*path}"...`. Note what it converts *to*: the slash-outside form, which does not match the bare base path. Name your wildcards yourself: `*splat`, or `{/*splat}` if the base path should match too.

**5. `@Res()` without `passthrough`.** The return value is ignored and any interceptor that transforms the response has its output discarded, so a handler that forgets `res.send()` on one branch hangs the request with nothing logged. (`@Header` and `@HttpCode` do still apply in v11.1.28, despite the docs saying otherwise — see Step 4.)

**6. Expecting a primitive to be JSON.** Returning the string `'ok'` sends `ok`, not `"ok"`. Objects and arrays are serialized; primitives are not.

**7. Treating a route param as a number.**

```typescript
@Get(':id')
findOne(@Param('id') id: number) {  // ✗ it is a string at runtime
  return this.catalog.findOne(id);
}
```

The annotation is a claim, not a conversion. Use `ParseIntPipe` or a DTO.

**8. Two routes with the same path in different controllers.** No error, no warning; the one registered first wins, and registration follows module import order — a file you probably weren't looking at.

**9. Assuming the method name affects the route.** It does not. `@Get('featured') xyz()` maps `/featured`.

**10. Reordering methods with an editor command.** Sorting members alphabetically or letting a refactor move a method changes routing precedence. This is why Step 2's boot-log habit exists.

## How this evolved

The routing surface is stable; the **path grammar** is what changed. Nest 11 made Express 5 the default adapter, bringing a rewritten path-to-regexp in which wildcards must be named (`/*splat`, or `{/*splat}` — slash inside the braces — to include the base path) and `?`, `*`, `+` no longer denote optional or repeating segments. Nest ships a `LegacyRouteConverter` that rewrites the old syntax at boot and logs a warning, so v10 code keeps running — but on a shim. Adapter parity is imperfect here: Express supports mid-path wildcards like `ab{*splat}cd`; Fastify does not support them at all.

## Exercises

**1. Break routing without breaking the build.** Take the Basic usage controller and move `findOne` above `findFeatured`. Predict the exact response body of `GET /products/featured` before running it. *Hint: the error message will name a service method, not a routing problem — that mismatch is the lesson.*

**2. Read the order.** Add three routes — `/products/export`, `/products/:id`, `/products/:id/reviews` — in a deliberately bad order, then use only the boot log to work out which requests will misroute, before sending any. *Hint: `/products/:id` matching is single-segment, so it cannot shadow `/products/:id/reviews`; find which pair actually collides.*

**3. Wildcards, precisely.** Write a handler matching `/products/docs` **and** everything beneath it, and a second matching only things beneath it. Then write the third spelling — slash outside the braces — and find the single URL that distinguishes it from the first. *Hint: it involves a character most people never type.*

## Summary

- Routing metadata is written by `@Controller()` onto the class and by `@Get()` and friends onto the **method function**; the method's name means nothing.
- Handlers are discovered in class-body declaration order (inherited methods last) and registered with the adapter in that order.
- The adapter matches **first registered wins**, so declaration order is precedence. Static routes must precede parameterised ones.
- The boot log's `Mapped {…}` lines are the routing table, printed in precedence order. Read them.
- Return a value and Nest builds the response — JSON for objects and arrays, raw for primitives, 200 except 201 for POST.
- `@Res()` without `passthrough: true` stops Nest **sending the body** — the return value is dropped and response-transforming interceptors have no effect. Status and headers are still applied, contrary to the docs.
- Express 5 requires **named** wildcards, and brace placement decides the base path: `docs{/*splat}` matches `/docs`, while `docs/{*splat}` and `docs/*splat` do not. The legacy converter's warning is a bug you haven't fixed.

## See also

- [Providers and dependency injection](./providers-and-di.md) — how a controller's constructor is resolved
- [Modules and the module graph](./modules-and-the-module-graph.md) — why a controller belongs to exactly one module
- [Execution order](../request-lifecycle/execution-order.md) — what runs before and after a handler
- [DTOs and class-validator](../validation/dtos-and-class-validator.md) — giving `@Body()` a shape and a guarantee
- [Recipe: my route returns 404 but it's clearly declared](../recipes/request-lifecycle/route-shadowed-by-a-param.md)

## References

- [Controllers](https://docs.nestjs.com/controllers) — official docs
- [Migration guide — Express v5](https://docs.nestjs.com/migration-guide) — official docs, named wildcards and path matching changes
- [`packages/common/decorators/http/request-mapping.decorator.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/common/decorators/http/request-mapping.decorator.ts) — where route metadata is written
- [`packages/core/router/paths-explorer.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/router/paths-explorer.ts) — handler discovery
- [`packages/core/router/router-explorer.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/router/router-explorer.ts) — path assembly and adapter registration
- [`packages/core/metadata-scanner.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/metadata-scanner.ts) — prototype walk and method ordering

## Demo source

`demos/foundations/` — adds `catalog/` to the app built in articles 01–02.