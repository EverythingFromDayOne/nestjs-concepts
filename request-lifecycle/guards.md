---
article_id: guards
description: A guard runs before validation, so the body it reads is raw input and returning false always renders as 403
concept_folder: request-lifecycle
wave: 1
nest_baseline: "11.1.x"
node_baseline: "24"
related:
  - request-lifecycle/execution-order
  - request-lifecycle/middleware
  - request-lifecycle/execution-context-and-reflector
  - foundations/decorators-and-metadata-reflection
  - auth/authorization-rbac-and-policies
  - recipes/auth/global-guard-locked-out-the-login-route
status:
  drafted: true
  reviewed: false
v12_watch: false
---

# Guards

> **Lead with this.** A guard answers one question — may this request proceed — and it answers it **before validation has run**. Two consequences shape everything else. The request body a guard reads is **raw, unvalidated input**, because pipes run one layer in; a guard that trusts `request.body` is trusting the caller. And `return false` produces **403 Forbidden, always**, whatever the real reason was — so the difference between "we don't know who you are" and "we know, and no" is something you have to express by throwing, not by returning. Guards are the cheapest place to stop a request, and the only place that stops it before any of the pipeline runs.

## What it is

A class implementing one method:

```typescript
@Injectable()
export class ApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean | Promise<boolean> | Observable<boolean> {
    return true;
  }
}
```

Truthy lets the request through. Falsy stops it. Throwing stops it *and* decides the response.

**Nest ships no built-in guards.** There is no `guards/` module in `@nestjs/common` — every guard in a codebase is written by you or comes from an ecosystem package (`AuthGuard` from `@nestjs/passport`, `ThrottlerGuard` from `@nestjs/throttler`). That's a deliberate consequence of what a guard is: an authorization *decision*, which the framework cannot make on your behalf.

Guards bind at the three levels from [article 09](./execution-order.md#minimal-shapes) — global (`APP_GUARD` or `useGlobalGuards`), controller (`@UseGuards()` on the class), route (`@UseGuards()` on the method) — and are evaluated in that order.

The distinction from its neighbours is about information, not capability:

| Layer | Has | Lacks |
| --- | --- | --- |
| middleware | the raw request, before routing | any idea which handler is next; no metadata |
| **guard** | the target handler and class, so **metadata**; the raw request | validated arguments; ability to transform |
| pipe | one typed argument, and can transform it | any view of the request as a whole |

A guard is the first layer that knows *what is about to run*. That's what makes declarative authorization — `@Roles('admin')` on a handler — possible at all.

> **If you know Angular.** `canActivate` is the same name and nearly the same idea, and the two differences both matter. Angular's guard protects a *view*, so failing it means a redirect and the user simply never sees the page — the data is still one `curl` away. A Nest guard is the actual enforcement boundary: it is the thing that makes the API refuse. Second, Angular reads per-route configuration from `route.data`, a static object on the route definition; Nest reads it from **metadata on the handler**, via `Reflector`, which is why the permission lives next to the code it protects rather than in a routing table. Carrying over the habit of putting authorization data in a central config is how Nest codebases end up with permissions that drift from their endpoints.

## How it works under the hood

### Guards run one at a time, and the first falsy wins

```typescript
// paraphrased from packages/core/guards/guards-consumer.ts — tryActivate
if (!guards || isEmpty(guards)) return true;

const context = this.createContext(args, instance, callback);
context.setType(type);

for (const guard of guards) {
  const result = guard.canActivate(context);
  if (typeof result === 'boolean') {
    if (!result) return false;
    continue;                                 // sync fast path — no await at all
  }
  if (await this.pickResult(result)) continue;
  return false;
}
return true;
```

Four things to read off it:

- **Strictly sequential.** A `for…of` with an `await` inside. Guards never run in parallel, so three global guards each making a 20 ms call cost 60 ms on every route.
- **Short-circuit on the first falsy.** A later guard never runs. If your audit logging lives in the second guard, rejections from the first are invisible to it.
- **Synchronous guards skip the `await` entirely.** The `typeof result === 'boolean'` branch is a real fast path — a guard that can answer from headers alone is measurably cheaper than one returning `Promise<boolean>`.
- **Observables are resolved with `lastValueFrom`.** So the **last** emitted value decides, not the first. A guard returning `of(true, false)` denies the request, and one returning an observable that never completes hangs it.

### `false` is always a 403

```typescript
// paraphrased from packages/core/router/router-execution-context.ts — createGuardsFn
const canActivateFn = async (args: any[]) => {
  const canActivate = await this.guardsConsumer.tryActivate(guards, args, instance, callback, contextType);
  if (!canActivate) {
    throw new ForbiddenException(FORBIDDEN_MESSAGE);
  }
};
return guards.length ? canActivateFn : null;
```

Returning `false` from any guard produces a generic 403 whose body is Nest's stock message — measured, `"Forbidden resource"`. It cannot produce a 401, it cannot carry a reason, and it cannot include a `WWW-Authenticate` header. **To control the response, throw** — `UnauthorizedException`, `ForbiddenException` with your own message, or a domain exception your [filter](./exception-filters.md) formats.

Also note the last line: with no guards bound, the function is `null` and the handler skips the check entirely. Guards you don't use cost nothing.

### The context is built from the controller and the method

```typescript
// paraphrased — GuardsConsumer.createContext
return new ExecutionContextHost(args, instance.constructor as any, callback);
```

That's why `context.getClass()` returns the controller and `context.getHandler()` returns the method — the exact two targets `Reflector.getAllAndOverride(KEY, [handler, class])` expects, using the metadata mechanism from [article 04](../foundations/decorators-and-metadata-reflection.md#how-it-works-under-the-hood). `context.getType()` is set here too, which is what lets one guard serve HTTP, WebSocket, and RPC transports. The `ExecutionContext` surface itself belongs to [article 15](./execution-context-and-reflector.md).

### Guards see the request before pipes touch it

From [article 09](./execution-order.md#how-it-works-under-the-hood): `fnCanActivate` is awaited before the interceptor chain is entered, and pipes run inside it. So at guard time:

- `request.body` is whatever the body parser produced — **no `ValidationPipe` has run**, no DTO has been applied, no `whitelist` has stripped anything, nothing has been coerced.
- `request.params` are strings.
- Nothing has been transformed.

This is not a flaw; it's the only ordering that makes sense, because validating input you're about to reject is wasted work. But it means a guard making decisions from the body is making them from attacker-controlled shape.

## Basic usage

```typescript
// src/pipeline/api-key.guard.ts
import { CanActivate, ExecutionContext, Injectable, UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Request } from 'express';

@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(private readonly config: ConfigService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    const provided = request.headers['x-api-key'];

    if (typeof provided !== 'string' || provided !== this.config.getOrThrow<string>('API_KEY')) {
      throw new UnauthorizedException('Missing or invalid API key');
    }
    return true;
  }
}
```

```typescript
// bound at three levels
@UseGuards(ApiKeyGuard)                                   // controller
@Controller('pipeline')
export class PipelineController {
  @UseGuards(RolesGuard)                                  // route
  @Get('admin')
  admin(): string { return 'ok'; }
}

// or globally, with DI
providers: [{ provide: APP_GUARD, useClass: ApiKeyGuard }]
```

Note the guard injects `ConfigService`, which is why it must be registered through `APP_GUARD` rather than `useGlobalGuards(new ApiKeyGuard())` — the DI limitation from [article 09](./execution-order.md#step-4--registration-di-and-order).

## Walkthrough — from a boolean to a policy

We extend the `pipeline/` module from articles 09–10. Each step is a limitation you hit and the mechanism that resolves it.

### Step 1 — the boolean, and what it can't say

```typescript
// src/pipeline/naive.guard.ts
@Injectable()
export class NaiveGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<Request>();
    return request.headers['x-api-key'] === 'let-me-in';
  }
}
```

```bash
curl -i localhost:3000/pipeline           # 403, generic forbidden message
curl -i -H 'x-api-key: wrong' localhost:3000/pipeline   # 403, identical response
```

Two different situations — no credential at all, and a wrong credential — produce byte-identical responses, and neither is a 401. A client cannot tell whether to prompt for credentials or give up, and your logs can't either.

That's the cost of `return false`: it's a single bit, and Nest turns every falsy bit into the same 403.

### Step 2 — throw to say what happened

```typescript
// src/pipeline/api-key.guard.ts — the version from Basic usage
if (typeof provided !== 'string') {
  throw new UnauthorizedException('Missing API key');      // 401 — who are you?
}
if (provided !== this.config.getOrThrow<string>('API_KEY')) {
  throw new ForbiddenException('API key not permitted here'); // 403 — you, but no
}
return true;
```

The rule worth keeping: **401 means unauthenticated, 403 means authenticated-and-refused.** `return false` can only ever express the second, so a guard doing authentication should always throw.

One caution on messages: they reach the client. `Invalid API key for tenant acme` tells an attacker that `acme` exists. Put the detail in the log and a generic string in the exception — a distinction [exception filters](./exception-filters.md) make easier to enforce centrally.

### Step 3 — metadata, and the opt-out a global guard needs

A guard's real power is knowing which handler is about to run. Combine `Reflector` with a decorator, exactly as [article 04](../foundations/decorators-and-metadata-reflection.md#walkthrough--building-a-small-decorator-toolkit) built it:

```typescript
// src/pipeline/public.decorator.ts
import { Reflector } from '@nestjs/core';

export const Public = Reflector.createDecorator<boolean>();
```

**Reuse `Roles` from [article 04](../foundations/decorators-and-metadata-reflection.md#step-3--a-typed-reflectable-decorator); do not redeclare it.** `Reflector.createDecorator()` generates an opaque key per call, so two `Roles` constants are two unrelated keys — a guard reading one is blind to handlers annotated with the other, silently. Measured: exactly that, from two files that both looked correct.

```typescript
// src/pipeline/roles.guard.ts
import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { Public, Roles } from './public.decorator';

interface AuthenticatedRequest extends Request {
  user?: { id: string; roles: string[] };
}

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const targets = [context.getHandler(), context.getClass()];

    if (this.reflector.getAllAndOverride(Public, targets)) {
      return true;                                   // ← the escape hatch
    }

    const required = this.reflector.getAllAndOverride(Roles, targets);
    if (!required?.length) {
      return true;                                   // no roles declared → no restriction
    }

    const { user } = context.switchToHttp().getRequest<AuthenticatedRequest>();
    if (!user) {
      throw new ForbiddenException('Not authenticated');
    }
    if (!required.some((role) => user.roles.includes(role))) {
      throw new ForbiddenException('Insufficient role');
    }
    return true;
  }
}
```

```typescript
@Public()
@Post('login')
login(): string { return 'token'; }

@Roles(['admin'])
@Delete(':id')
remove(@Param('id') id: string): void {}
```

Three details that matter:

- **`[handler, class]`, in that order.** `getAllAndOverride` takes the first non-`undefined`, so a method-level `@Roles()` overrides a controller-level one. Reverse the array and the controller wins — the precedence trap from [article 04](../foundations/decorators-and-metadata-reflection.md#how-it-works-under-the-hood).
- **A global guard needs `@Public()` or an equivalent.** Register `RolesGuard` as `APP_GUARD` without one and your login and health endpoints are unreachable. This is the single most common way a Nest application locks itself out, and the fix is a decorator the guard checks first.
- **`getAllAndMerge` would be wrong here.** Merging role arrays across levels means a handler *gains* every role its controller allows — the union, not the override. For policy, override.

### Step 4 — the raw-body trap

A tenant guard, written the way it reads naturally:

```typescript
// ✗ decides from unvalidated input
canActivate(context: ExecutionContext): boolean {
  const request = context.switchToHttp().getRequest<Request>();
  const { tenantId } = request.body;                 // no pipe has run
  return this.tenants.mayAccess(request.user, tenantId);
}
```

At guard time `request.body` is the body parser's output and nothing more. `tenantId` may be absent, an array, an object, or a string designed to break `mayAccess`. `whitelist: true` on your `ValidationPipe` hasn't stripped anything yet, because pipes run inside the interceptor chain one layer in.

Three ways out, in order of preference:

1. **Decide from something the transport already established** — the token's claims, a header, a path parameter. A tenant taken from a verified JWT can't be forged by the body.
2. **Put the identifier in the URL** — `/tenants/:tenantId/orders` — so it's a route parameter and the guard reads a string it can validate cheaply.
3. **Validate inside the guard**, if the decision genuinely depends on the body. It's duplicated work, and you own it.

What doesn't work is hoping the pipe ran. It didn't.

### Step 5 — cost, and ordering

Guards are sequential and short-circuiting, so ordering is a performance decision as well as a correctness one:

```typescript
providers: [
  { provide: APP_GUARD, useClass: ApiKeyGuard },   // cheap: header comparison
  { provide: APP_GUARD, useClass: RolesGuard },    // cheap: metadata + in-memory check
]
```

```typescript
@UseGuards(SubscriptionGuard)   // expensive: database lookup — bind it narrowly
@Get('reports')
reports(): unknown { /* … */ }
```

Two rules from the mechanism:

- **Cheap first.** The first falsy short-circuits, so a header check ahead of a database lookup means unauthorized traffic never reaches the database.
- **Global means every route.** A global guard doing I/O adds that latency to your health endpoint. If only some routes need it, bind it there.

And one from [article 06](../foundations/scopes-and-lifetimes.md): a **request-scoped guard registered globally** makes every route in the application pay per-request instantiation, for the guard and everything it depends on.

### Verify the loop

The trace endpoint from article 09 already shows guards running before interceptors. What's worth adding is a matrix of outcomes:

```bash
curl -i localhost:3000/pipeline                        # 401 — missing key, from a throw
curl -i -H 'x-api-key: wrong' localhost:3000/pipeline  # 403 — present but refused
curl -i -H 'x-api-key: ok' localhost:3000/pipeline     # 200
curl -i -X POST localhost:3000/pipeline/login          # 200 — @Public() bypasses the global guard
curl -i -X DELETE localhost:3000/pipeline/1            # 403 — @Roles(['admin']) with no user
```

And unit-test the guard directly, since `ExecutionContext` is just an object:

```typescript
// src/pipeline/roles.guard.spec.ts
import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { Roles } from './public.decorator';

function contextFor(handler: () => void, user?: { id: string; roles: string[] }): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => class Dummy {},
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());

  it('allows a handler with no roles declared', () => {
    const handler = (): void => {};
    expect(guard.canActivate(contextFor(handler))).toBe(true);
  });

  it('refuses when the user lacks the role', () => {
    class Controller {
      @Roles(['admin'])
      handler(): void {}
    }
    const handler = Controller.prototype.handler;
    expect(() => guard.canActivate(contextFor(handler, { id: '1', roles: ['viewer'] }))).toThrow();
  });
});
```

That hand-built context is the honest version of guard testing: three methods is all `RolesGuard` touches, so three methods is all the double needs. A guard that requires a full HTTP fixture to test is usually a guard doing too much.

## Real-world patterns

**Throw, don't return false**, whenever the reason matters — which is whenever a client might act differently on 401 than 403.

**Metadata over paths.** `@Roles()` on the handler keeps the rule beside the code. Authorization expressed as path strings in a module drifts the first time someone renames a route.

**Every global guard needs an opt-out decorator.** `@Public()` checked first, before anything else.

**Authenticate in a guard, don't parse tokens in middleware.** Middleware may extract and verify a token — it's transport-level — but the decision needs metadata, so it belongs here. See [article 10](./middleware.md#step-4--what-happens-when-you-put-auth-here).

**Attach the principal to the request, and type it once.** `request.user = …` is the convention; module-augment Express's `Request` rather than casting in every consumer. Better still, expose it through a `@CurrentUser()` parameter decorator ([article 04](../foundations/decorators-and-metadata-reflection.md)) so handlers never touch `request` at all.

**Keep guards free of I/O where you can.** Header and metadata checks are sync and take the fast path. Permission lookups want caching, and cached lookups want a clear invalidation story.

**One guard, one question.** Authentication and authorization as separate guards compose better and fail more legibly than one class doing both — and the cheap one can run first.

**Transport-agnostic guards use `context.getType()`.** A guard that also has to work over WebSockets or RPC branches there rather than assuming `switchToHttp()`.

## API reference

| Symbol | Import | Purpose |
| --- | --- | --- |
| `CanActivate` | `@nestjs/common` | the interface: `canActivate(context)` |
| `@UseGuards(...)` | `@nestjs/common` | bind at controller or method level |
| `APP_GUARD` | `@nestjs/core` | global binding **with** DI; multiple providers accumulate |
| `app.useGlobalGuards(...)` | — | global binding **without** DI |
| `ExecutionContext` | `@nestjs/common` | `getHandler()`, `getClass()`, `switchToHttp()`, `getType()` |
| `Reflector` | `@nestjs/core` | reads handler/class metadata; use `getAllAndOverride` for policy |
| `UnauthorizedException` | `@nestjs/common` | 401 — unauthenticated |
| `ForbiddenException` | `@nestjs/common` | 403 — authenticated and refused |
| `AuthGuard('jwt')` | `@nestjs/passport` | Passport strategy as a guard — [article 30](../auth/authentication-strategies.md) |

## Common mistakes

**1. `return false` when you meant 401.** Every falsy return becomes a generic 403. Throw `UnauthorizedException` instead.

**2. Deciding from `request.body`.** No pipe has run. The body is raw, unvalidated, caller-controlled.

**3. Expecting guards to run concurrently.** Strictly sequential, so global guards' latency adds up on every route.

**4. Returning a multi-value Observable.** `lastValueFrom` means the **last** value decides; `of(true, false)` denies. A non-completing observable hangs the request.

**5. A global guard with no `@Public()`.** Login, health, and metrics endpoints become unreachable, and the app looks broken rather than secured.

**6. `getAllAndMerge` for roles.** Merging unions the permissions across levels. Use `getAllAndOverride` so the handler's declaration wins.

**7. `[class, handler]` instead of `[handler, class]`.** Order decides precedence; reversed, the controller silently overrides the method.

**8. Leaking detail in the exception message.** Guard messages reach the client. Log the specifics; return something generic.

**9. Expecting a guard to transform.** A guard returns a verdict, not a value. Mutating `request` is the only channel, and it's untyped.

**10. A request-scoped guard registered globally.** Every route pays per-request instantiation for it and its whole dependency subtree.

## How this evolved

`CanActivate` is unchanged; what improved is how the metadata reaches it. `Reflector.createDecorator<T>()` replaced stringly-typed `SetMetadata` keys, so `@Roles(['admin'])` is type-checked and the guard's read site infers `string[]` without a generic — at the cost of the array-argument form, per [article 04](../foundations/decorators-and-metadata-reflection.md#step-3--a-typed-reflectable-decorator). `getAllAndOverride` and `getAllAndMerge` arrived to make the multi-level precedence explicit rather than something each guard reimplemented. And guards became scope-aware along with everything else, which is why a global guard can now be a per-request cost.

## Exercises

**1. Feel the missing bit.** Write a guard that returns `false` and one that throws `UnauthorizedException`, then compare the two responses with `curl -i`. *Hint: one of the differences is the status; the other is what a client can do about it.*

**2. Lock yourself out, then escape.** Register a `RolesGuard` globally with no `@Public()` support and try to reach a login route. Then add the decorator and the check. *Hint: the check has to come before everything else in `canActivate`.*

**3. Prove the ordering cost.** Bind two global guards, the first cheap and the second sleeping 50 ms, then time a request that the first guard rejects. Swap their order and time it again. *Hint: the difference is the short-circuit, and it's the whole argument for cheap-first.*

## Summary

- A guard returns a verdict and nothing else. Truthy proceeds, falsy stops, throwing stops *and* shapes the response.
- **`return false` always produces a generic 403.** For 401, or for any message, throw.
- Guards run **sequentially** with a **short-circuit on the first falsy**; synchronous ones skip the `await` entirely.
- Observable results are resolved with `lastValueFrom` — the **last** value decides.
- The context is built from the controller and the method, which is what makes `Reflector.getAllAndOverride(KEY, [handler, class])` work — and why guards are the first layer that can be metadata-driven.
- Guards run **before pipes**, so the body is unvalidated. Decide from verified claims, headers, or route params.
- No guards bound means the check function is `null` — unused guards cost nothing.
- Every global guard needs an opt-out decorator, or the application locks itself out.

## See also

- [Execution order](./execution-order.md#how-it-works-under-the-hood) — why guards sit outside the interceptor chain
- [Middleware](./middleware.md#step-4--what-happens-when-you-put-auth-here) — why token parsing may live there but the decision may not
- [Interceptors](./interceptors.md) — the layer that cannot see a rejected request
- [Exception filters](./exception-filters.md) — shaping what a rejection looks like to the client
- [Execution context and Reflector](./execution-context-and-reflector.md) — the context surface in full
- [Authorization, RBAC and policies](../auth/authorization-rbac-and-policies.md) — CASL and policy objects beyond role strings
- [Recipe: my global guard locked out the login route](../recipes/auth/global-guard-locked-out-the-login-route.md)

## References

- [Guards](https://docs.nestjs.com/guards) — official docs
- [`packages/core/guards/guards-consumer.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/guards/guards-consumer.ts) — sequential evaluation, sync fast path, `lastValueFrom`
- [`packages/core/router/router-execution-context.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/router/router-execution-context.ts) — `createGuardsFn`, and `false` becoming `ForbiddenException`
- [`packages/core/helpers/execution-context-host.ts` @ v11.1.28](https://github.com/nestjs/nest/blob/v11.1.28/packages/core/helpers/execution-context-host.ts) — what `getClass()` and `getHandler()` return

## Demo source

`demos/foundations/` — extends `pipeline/` with `api-key.guard.ts`, `roles.guard.ts`, and the `@Public()` / `@Roles()` decorators.