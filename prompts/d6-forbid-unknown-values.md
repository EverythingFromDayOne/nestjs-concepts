# D6 — `nestjs/dtos-and-class-validator`, the `forbidUnknownValues` claim

> **Type:** debt-fix prompt, not a session prompt. Deliberately not numbered
> `session-N.md` so it does not disturb the session sequence.
> **Repo:** `nestjs-concepts` (submodule, mounted at `content/nestjs`, **currently
> pinned at v0.3.1**)
> **Executor:** `@Cursor`, free pool (Grok 4.6). The judgment on this claim is already
> done — every version number, the corrected wording and the probe are pinned below, so
> what remains is locate-and-replace plus a file copy. Hold the expiring Cursor credit
> for session 3.
> **Run it as two invocations, not one.** `@Cursor` opens PRs autonomously, and step 1
> below is a hard stop-and-report gate. Invocation A is read-only: report the quoted
> sentences, edit nothing, open nothing. Invocation B does steps 2–3 after you have
> approved what A found.
> **Blocks:** session 3. Do this first and promote before the route tree renders.

> **Revision 2026-08-19.** The previous draft of this file was written against the
> session-3 handoff and was stale in three ways, all corrected below: it treated the
> `.ts`-extension article as an open question (it is **D12, closed 2026-08-17**), it
> instructed a bump to **v0.3.1** (which already exists and is the pin in use — the
> correct target is **v0.3.2**), and it cited **D14** for a gap that has no id. The
> verified facts in §"Verified facts" were re-checked against the published tarballs
> on 2026-08-19 and are unchanged.

---

## Why this is urgent

`Article.status` no longer gates publication. Draft gating used to hide this article;
nothing hides it now, so a **known-false claim renders in every build** on a site whose
entire thesis is verified claims. It is the only tracked debt item that is actively
wrong rather than merely absent.

This is not conditional. `docs/DEBT.md` D6 states it directly:

> Escalated 2026-08-18. A known-false claim is pinned in `v0.3.1` and **now renders in
> every build, `NEXT_PUBLIC_SHOW_DRAFTS` or not.** … This article adapts, so it now
> ships.

**The file is already selectable.** Debt **D12** — the article saved with a `.ts`
extension and therefore invisible to file selection — was closed on 2026-08-17 by
`nestjs-concepts@v0.3.1`, and `corpus-web` moved the pin the same day. The article is
`validation/dtos-and-class-validator.md`, it adapts, nestjs is 20/20, and its six
inbound `related` refs are live edges. There is no `git mv` to do and no overlap to
investigate. D13 is the unrelated 44-refs-across-33-targets item and contains none of
this.

---

## Read this before you edit — two upstream descriptions are themselves imprecise

The session-3 handoff describes the correction as:

> article 17 established that Nest forces `forbidUnknownValues: false`, reversing
> standalone `class-validator` behaviour

and the `docs/DEBT.md` D6 row repeats it:

> headline claim invalidated by article 17, `validationpipe-in-depth`
> (`forbidUnknownValues: false` is forced by Nest)

**"Forces" is wrong in both.** Nest *seeds a default* of `false` that any
caller-supplied option overrides. If you write the fix from either sentence you will
replace one false claim with a smaller one. Use the verified facts below, and correct
the register row as part of the close-out (§5) rather than quoting it forward.

---

## Verified facts

Established by reading the published packages and running them. Originally established
2026-08-18; **re-verified 2026-08-19** against the published tarballs for
`class-validator` 0.13.2 / 0.14.0 / 0.14.1 / 0.14.2 / 0.15.1 and `@nestjs/common`
9.2.1 / 9.3.0 / 9.3.1 / 9.3.2 / 11.2.1. The probe in the appendix reproduces the output
in §3 exactly. Not from blog posts — every line below is reproducible.

### 1. `class-validator` defaults `forbidUnknownValues` to `true`

`class-validator@0.15.1`, `cjs/validation/ValidationExecutor.js`:

```js
const forbidUnknownValues =
  this.validatorOptions?.forbidUnknownValues === undefined ||
  this.validatorOptions.forbidUnknownValues !== false;

if (forbidUnknownValues && !targetMetadatas.length) {
  // → ValidationError { unknownValue: 'an unknown value was passed to the validate function' }
}
```

`undefined` resolves to `true`. The guard fires when the target has **no validation
metadata at all** — an undecorated class, or a `groups` selection that excludes every
constraint. It is not a check on extra properties; that is `whitelist` /
`forbidNonWhitelisted`, a different option that is frequently confused with this one.

**Two version boundaries, not one.** Get both right or the claim is still wrong:

| version | `ValidationExecutor` guard | effect |
|---|---|---|
| 0.13.2 | `if (this.validatorOptions && this.validatorOptions.forbidUnknownValues && …)` | default off — the option must be explicitly `true` |
| **0.14.0** | `forbidUnknownValues = opts?.forbidUnknownValues === undefined \|\| opts.forbidUnknownValues !== false`, still guarded by `if (this.validatorOptions && …)` | default flipped to `true` — **but only when an options object is passed at all** |
| 0.14.1 | unchanged from 0.14.0 | unchanged |
| **0.14.2** | `if (forbidUnknownValues && !targetMetadatas.length)` | the `this.validatorOptions &&` guard removed; now fires on a bare `validate(obj)` too |
| 0.15.1 | unchanged from 0.14.2 | unchanged |

So `validate(obj)` with no second argument is **accepted** on 0.14.0–0.14.1 and
**rejected** on 0.14.2+. That gap is typestack/class-validator#1906. Row 3 of the probe
below only reproduces on 0.14.2 or later — state the version whenever you quote that
behaviour.

The intent change is 0.14.0 (typestack/class-validator#1798); the change that makes the
default unconditional is 0.14.2.

### 2. Nest's `ValidationPipe` defaults it back to `false` — as an overridable default

`@nestjs/common@11.2.1`, `packages/common/pipes/validation.pipe.ts`, constructor:

```ts
// @see https://github.com/nestjs/nest/issues/10683#issuecomment-1413690508
this.validatorOptions = { forbidUnknownValues: false, ...validatorOptions };
```

The spread comes **after** the literal. A caller passing
`new ValidationPipe({ forbidUnknownValues: true })` gets `true`.

Introduced in **`@nestjs/common` 9.3.2**. Bisected against the published tarballs:

| version | `this.validatorOptions =` |
|---|---|
| 9.2.1 | `validatorOptions` |
| 9.3.0 | `validatorOptions` |
| 9.3.1 | `validatorOptions` |
| **9.3.2** | **`Object.assign({ forbidUnknownValues: false }, validatorOptions)`** |
| 11.2.1 | `{ forbidUnknownValues: false, ...validatorOptions }` — same semantics |

### 3. Observable behaviour

Probe output, `@nestjs/common@11.2.1` + `class-validator@0.15.1`, DTO with no decorators:

```
-- what the pipe resolves forbidUnknownValues to --
  new ValidationPipe()                           -> false
  new ValidationPipe({forbidUnknownValues:true}) -> true

-- observable behaviour --
  1. ValidationPipe(), no options        : ACCEPTED
  2. ValidationPipe({forbidUnknown:true}): REJECTED -> ["an unknown value was passed to the validate function"]
  3. class-validator validate(), no opts : REJECTED -> [{"unknownValue":"an unknown value was passed to the validate function"}]
  4. class-validator, explicit false     : ACCEPTED
```

Rows 1 and 3 are the same object through two entry points, with opposite outcomes.
Row 2 is the one that disproves "forces".

### The claim, stated correctly

> Since 0.14.0 — unconditionally since 0.14.2 — `class-validator` refuses to validate a
> target that carries no validation metadata, and `forbidUnknownValues` defaults to
> `true`. Nest's `ValidationPipe` has seeded that option to `false` since
> `@nestjs/common` 9.3.2, so the same undecorated DTO that `validate()` rejects passes
> silently through the pipe. The default is overridable —
> `new ValidationPipe({ forbidUnknownValues: true })` restores the library behaviour —
> but until you override it, an undecorated or mis-imported DTO is a validation no-op
> that reports success.

The teachable point is the **silent** part: a DTO whose decorators failed to load (a bad
barrel import, a stripped `emitDecoratorMetadata`, a `groups` filter that matches
nothing) does not error under the default pipe. It validates nothing and returns 200.

---

## Task

### 1. Locate, do not assume

Find the claim before changing anything. Two articles are in play and they may disagree
with each other as well as with reality:

- **article 16** — `dtos-and-class-validator`, the article carrying the false claim.
  The register writes its path as `validation/dtos-and-class-validator.md`; sibling
  corpora root their trees at `docs/`, so search from the repo root rather than
  assuming either.
- **article 17** — `validationpipe-in-depth`, where the (imprecisely worded) correction
  was established.

```
rg -n -i "forbidUnknownValues|unknown value was passed|forced by Nest" .
```

**This step is read-only. Report and stop.** Quote the exact sentences you intend to
change and give their file paths. Do not edit a file, do not create a branch, do not
commit, and do not open a pull request in this invocation — approval comes back as a
second invocation. If what you find does not match the description above — if the false
claim is something other than a `forbidUnknownValues` mis-statement, or if the wording
has already been corrected — say so and stop. Do not improvise a different fix.

### 2. Correct it

- Replace the false claim with the corrected statement above, in the article's own
  voice, at the same level of detail as its neighbours.
- Where the two articles overlap, make `dtos-and-class-validator` the one that states
  the mechanism and have `validationpipe-in-depth` cross-reference it, not restate it.
  If article 17 also says "forces", fix it there too.
- Pin every version number you cite: `class-validator` 0.14.0 for the default flip,
  0.14.2 for it becoming unconditional, `@nestjs/common` 9.3.2 for the pipe's seed.
  Unpinned version claims are how this happened.
- Add the `whitelist` / `forbidNonWhitelisted` distinction as a "commonly confused with"
  note. Readers arrive at this option from the wrong direction.
- The word **"forces"** must not survive anywhere in either article.

### 3. Commit the probe as a fixture

Add the appendix script to the repo — suggested `verify/forbid-unknown-values.mjs` — so
the claim is re-runnable rather than asserted. If `nestjs-concepts` has no place for
runnable verification yet, put it beside the article and say so in the PR body; do not
invent a directory convention.

`react-concepts` having no `package.json`, no CI and no gates is a **separate and
currently untracked** gap. Do not fix it here and do not assign it an id in this PR.

### 4. Tag and promote

- Bump `nestjs-concepts` to **v0.3.2** and tag it. **Not v0.3.1** — that tag already
  exists, was cut 2026-08-17, and is the tag `corpus-web` currently consumes.
- Open a promotion PR in `corpus-web` moving `content/nestjs` from **v0.3.1 → v0.3.2**.
- The article body changes, so its `content_hash` changes. Say so in the PR body.
  Hash-invalidation is the user's call, consistent with prior promotions.
- No article is added, removed or renamed: the census stays **197 selected, 181
  adapting**, 16 exclusions, 44 unresolved refs. If any of those move, something else
  changed and you should stop and say so.
- Do not merge. Nothing auto-merges.

### 5. Close out

- Mark **D6 closed** in `docs/DEBT.md`, with the corrected claim in one line so the
  register carries the answer and not just the question.
- **Correct the D6 row's own wording** while closing it — it currently says
  "`forbidUnknownValues: false` is forced by Nest", which is the same error being fixed
  in the corpus. Closing the row without correcting it leaves the false claim in the
  register.
- `docs/DEBT.md` is edited **in place** and never union-merged.
- Update `.agents/summary.md` — it names D6 as the corpus's one known-false headline
  claim. **Edited in place, never union-merged.**
- Update `progress.md` — **edited in place, never union-merged.**
- Log this in `.agents/SESSION-LOG.md` and `CHANGELOG.md` as **`debt-d6`**, a named
  task, not a session number. Do not author `prompts/session-N.md`.
- Do not reuse the D6 id for anything else. Debt ids are append-only. Highest issued
  is D16.
- If you had to decide anything this prompt did not specify, list it under "Invented
  decisions" in the PR body.

---

## Definition of done

- [ ] The quoted false sentence(s) reported back and confirmed before editing
- [ ] Corrected claim states: library default `true` since 0.14.0, unconditional since
      0.14.2; pipe seeds `false` since 9.3.2; overridable
- [ ] The word "forces" does not appear in either article
- [ ] All three version numbers pinned (0.14.0, 0.14.2, 9.3.2)
- [ ] `whitelist` / `forbidNonWhitelisted` confusion addressed
- [ ] Article 17 cross-references rather than restates, and is corrected if it also
      says "forces"
- [ ] Probe committed and runs
- [ ] `nestjs-concepts` tagged **v0.3.2**
- [ ] `corpus-web` promotion PR open (v0.3.1 → v0.3.2), unmerged
- [ ] Census unchanged: 197 / 181 / 16 exclusions / 44 unresolved
- [ ] D6 closed in `docs/DEBT.md` **and its "forced by Nest" wording corrected**
- [ ] `.agents/summary.md` and `progress.md` updated in place
- [ ] Logged as `debt-d6` in `SESSION-LOG.md` and `CHANGELOG.md`

---

## Appendix — the probe

`package.json` deps: `@nestjs/common@11.2.1`, `class-validator@0.15.1`,
`class-transformer@0.5.1`, `reflect-metadata@0.2.2`. `@nestjs/common` also needs `rxjs`
present to import cleanly.

```js
require('reflect-metadata');
const { ValidationPipe } = require('@nestjs/common');
const { validate } = require('class-validator');

// A DTO whose validation metadata is empty — no decorators applied.
// This is the exact shape class-validator 0.14+ rejects under forbidUnknownValues.
class BareDto {}

const meta = { type: 'body', metatype: BareDto, data: '' };
const payload = { anything: 'at all' };

async function viaPipe(label, opts) {
  const pipe = new ValidationPipe(opts);
  try {
    await pipe.transform(payload, meta);
    return `${label}: ACCEPTED`;
  } catch (e) {
    const r = e.getResponse ? e.getResponse() : e.message;
    return `${label}: REJECTED -> ${JSON.stringify(r.message ?? r)}`;
  }
}

async function viaRaw(label, opts) {
  const inst = Object.assign(new BareDto(), payload);
  const errs = await validate(inst, opts);
  return errs.length
    ? `${label}: REJECTED -> ${JSON.stringify(errs.map(e => e.constraints))}`
    : `${label}: ACCEPTED`;
}

(async () => {
  console.log('nest', require('@nestjs/common/package.json').version,
              '| class-validator', require('class-validator/package.json').version);
  console.log('');
  console.log('-- what the pipe resolves forbidUnknownValues to --');
  console.log('  new ValidationPipe()                          ->',
    new ValidationPipe().validatorOptions.forbidUnknownValues);
  console.log('  new ValidationPipe({forbidUnknownValues:true})->',
    new ValidationPipe({ forbidUnknownValues: true }).validatorOptions.forbidUnknownValues);
  console.log('');
  console.log('-- observable behaviour --');
  console.log(' ', await viaPipe('1. ValidationPipe(), no options      ', undefined));
  console.log(' ', await viaPipe('2. ValidationPipe({forbidUnknown:true})', { forbidUnknownValues: true }));
  console.log(' ', await viaRaw ('3. class-validator validate(), no opts', undefined));
  console.log(' ', await viaRaw ('4. class-validator, explicit false    ', { forbidUnknownValues: false }));
})();
```

---

## Sources

- `class-validator@0.13.2 / 0.14.0 / 0.14.1 / 0.14.2 / 0.15.1` — `cjs/validation/ValidationExecutor.js` (read from the published tarballs)
- `@nestjs/common@9.2.1 / 9.3.0 / 9.3.1 / 9.3.2 / 11.2.1` — `pipes/validation.pipe.js` (read from the published tarballs)
- [typestack/class-validator#1798 — enable `forbidUnknownValues` by default](https://github.com/typestack/class-validator/pull/1798)
- [typestack/class-validator#1906 — doesn't default to true when validatorOptions are undefined](https://github.com/typestack/class-validator/issues/1906)
- [nestjs/nest#10683 — validation fails with class-validator 0.14.0](https://github.com/nestjs/nest/issues/10683)
- [nest/packages/common/pipes/validation.pipe.ts](https://github.com/nestjs/nest/blob/master/packages/common/pipes/validation.pipe.ts)
