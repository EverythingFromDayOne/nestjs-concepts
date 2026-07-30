# Cursor prompt — scaffold `nestjs-concepts`

> Paste everything below the line into Cursor as a single instruction. It is scoped to repo skeleton and infrastructure only: no article content, no demo applications.

---

You are scaffolding a documentation repository called `nestjs-concepts`. This task is **structure and infrastructure only**. Do not write any article, recipe, or demo-application code. Do not invent prose beyond what is specified verbatim below.

## Non-negotiables

1. **Write every file as UTF-8 with LF line endings.** A previous project had a tool mangle emoji and em-dashes into `?`. After you finish, verify that the status emoji in `progress.md` (✅ 🟢 🟡 ⚪ ❌) are still intact.
2. **Do not create, overwrite, or modify `roadmap.md` or `progress.md`.** Both are authored already and will be placed at the repo root manually. If they are already present, leave them untouched.
3. **Do not add placeholder `.md` files inside the concept or recipe folders.** Empty directories get a `.gitkeep` only. Stub index files create broken links.
4. **Do not run `pnpm install`, `npm install`, or `nest new`.** No dependencies are installed in this task.
5. Use the exact file contents given below where contents are specified. Where they are not, follow the description precisely and add nothing extra.

## 1. Directory tree

Create this tree from the repo root. Every leaf directory listed gets an empty `.gitkeep` file.

```
nestjs-concepts/
├── foundations/.gitkeep
├── request-lifecycle/.gitkeep
├── validation/.gitkeep
├── data/.gitkeep
├── async/.gitkeep
├── auth/.gitkeep
├── testing/.gitkeep
├── architecture/.gitkeep
├── observability/.gitkeep
├── performance/.gitkeep
├── recipes/
│   ├── di-and-modules/.gitkeep
│   ├── request-lifecycle/.gitkeep
│   ├── validation/.gitkeep
│   ├── data-access/.gitkeep
│   ├── auth/.gitkeep
│   ├── background-jobs/.gitkeep
│   ├── testing/.gitkeep
│   ├── performance/.gitkeep
│   ├── deployment/.gitkeep
│   └── microservices/.gitkeep
├── demos/.gitkeep
└── scripts/
```

## 2. `docker-compose.yml`

```yaml
services:
  postgres:
    image: postgres:18.4-alpine
    container_name: nestjs-concepts-postgres
    restart: unless-stopped
    environment:
      POSTGRES_USER: ${POSTGRES_USER:-nest}
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-nest}
      POSTGRES_DB: ${POSTGRES_DB:-nest_concepts}
    ports:
      # Host port is deliberately non-default so a local PostgreSQL install
      # on 5432 does not collide with this container.
      - '55432:5432'
    volumes:
      - postgres-data:/var/lib/postgresql/data
    healthcheck:
      test: ['CMD-SHELL', 'pg_isready -U ${POSTGRES_USER:-nest} -d ${POSTGRES_DB:-nest_concepts}']
      interval: 5s
      timeout: 5s
      retries: 10

  # Enabled from Wave 3 (async/ — BullMQ). Left commented until then so the
  # default `docker compose up` stays a single container.
  # redis:
  #   image: redis:8-alpine
  #   container_name: nestjs-concepts-redis
  #   restart: unless-stopped
  #   ports:
  #     - '56379:6379'
  #   healthcheck:
  #     test: ['CMD', 'redis-cli', 'ping']
  #     interval: 5s
  #     timeout: 5s
  #     retries: 10

volumes:
  postgres-data:
```

**Verify the image tag resolves.** Run `docker compose pull` after writing the file. If `postgres:18.4-alpine` is not available, fall back to `postgres:18-alpine`, make that edit, and tell me you changed it — do not silently substitute a different major version.

## 3. `.env.example`

```bash
# Copy to .env and adjust if needed. .env is gitignored.
POSTGRES_USER=nest
POSTGRES_PASSWORD=nest
POSTGRES_DB=nest_concepts

# Connection string for demo applications. Note the non-default host port.
DATABASE_URL=postgresql://nest:nest@localhost:55432/nest_concepts
```

## 4. `package.json` (root)

```json
{
  "name": "nestjs-concepts",
  "version": "0.0.0",
  "private": true,
  "description": "Concept articles and symptom-first recipes for NestJS.",
  "packageManager": "pnpm@10.0.0",
  "engines": {
    "node": ">=24"
  },
  "scripts": {
    "db:up": "docker compose up -d",
    "db:down": "docker compose down",
    "db:reset": "docker compose down -v && docker compose up -d",
    "check:links": "python3 scripts/check-links.py ."
  },
  "license": "SEE LICENSE IN LICENSE"
}
```

If the installed pnpm major is not 10, set `packageManager` to the installed version instead and tell me.

## 5. `pnpm-workspace.yaml`

```yaml
packages:
  - 'demos/*'
```

## 6. `.nvmrc`

```
24
```

## 7. `tsconfig.base.json`

Demo applications extend this. Do not add a root `tsconfig.json`.

```json
{
  "compilerOptions": {
    "module": "commonjs",
    "target": "ES2023",
    "lib": ["ES2023"],
    "moduleResolution": "node",
    "declaration": false,
    "removeComments": true,
    "emitDecoratorMetadata": true,
    "experimentalDecorators": true,
    "allowSyntheticDefaultImports": true,
    "esModuleInterop": true,
    "sourceMap": true,
    "incremental": true,
    "skipLibCheck": true,
    "strict": true,
    "strictNullChecks": true,
    "strictBindCallApply": true,
    "noImplicitAny": true,
    "noFallthroughCasesInSwitch": true,
    "forceConsistentCasingInFileNames": true
  }
}
```

## 8. `.gitignore`

```gitignore
# dependencies
node_modules/
.pnpm-store/

# build output
dist/
build/
*.tsbuildinfo

# environment
.env
.env.local
.env.*.local

# test output
coverage/
.nyc_output/

# editors
.idea/
.vscode/*
!.vscode/extensions.json
*.swp

# os
.DS_Store
Thumbs.db

# logs
*.log
npm-debug.log*
pnpm-debug.log*
```

## 9. `.editorconfig`

```ini
root = true

[*]
charset = utf-8
end_of_line = lf
insert_final_newline = true
indent_style = space
indent_size = 2
trim_trailing_whitespace = true

[*.md]
trim_trailing_whitespace = false
```

## 10. `LICENSE`

Two licenses, because the repo holds two kinds of thing. Write this file exactly:

```
Copyright (c) 2026 Nguyen Hoang Cong Huy

PROSE — the concept articles and recipes (all .md files) are licensed under
Creative Commons Attribution 4.0 International (CC BY 4.0).
Full text: https://creativecommons.org/licenses/by/4.0/legalcode

CODE — everything under demos/ and scripts/, and all code samples embedded in
the articles, is licensed under the MIT License:

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```

## 11. `CREDITS.md`

```markdown
# Credits

This corpus is original writing. It leans on the following, and says so:

- **The NestJS documentation and the Nest core team** — the official docs at
  https://docs.nestjs.com are the primary reference for every article here.
  Where an article traces framework internals, it cites the relevant source
  file in https://github.com/nestjs/nest at a pinned tag.
- **The TypeORM maintainers** — https://typeorm.io, for the Phase 1 data layer.
- **The PostgreSQL Global Development Group** — https://www.postgresql.org.

No article reproduces documentation text. Where behaviour is quoted, it is
quoted briefly and linked to its source.
```

## 12. `README.md`

Write exactly this. Do not embellish it, do not add badges, and do not add links to files that do not yet exist.

```markdown
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
```

## 13. `scripts/check-links.py`

An anchor and link checker. It must strip fenced code blocks before scanning, so
example links inside code samples are not treated as real links.

```python
#!/usr/bin/env python3
"""Verify that every relative markdown link and anchor in the corpus resolves.

Usage: python3 scripts/check-links.py [root]

Fenced code blocks and inline code spans are ignored, so example links inside
samples are not treated as real links. Exits 1 if any link is broken, printing
one line per failure.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

FENCE = re.compile(r"^\s*(```|~~~)")
LINK = re.compile(r"\[[^\]]*\]\(([^)\s]+)(?:\s+\"[^\"]*\")?\)")
INLINE_CODE = re.compile(r"`+[^`]*`+")
HEADING = re.compile(r"^(#{1,6})\s+(.*?)\s*#*\s*$")
SKIP_DIRS = {".git", "node_modules", "dist", "build", "coverage"}


def strip_fences(text: str) -> str:
    """Blank out fenced code blocks, preserving line numbers."""
    out, in_fence, marker = [], False, ""
    for line in text.splitlines():
        m = FENCE.match(line)
        if m and not in_fence:
            in_fence, marker = True, m.group(1)
            out.append("")
            continue
        if in_fence and line.strip().startswith(marker):
            in_fence = False
            out.append("")
            continue
        out.append("" if in_fence else line)
    return "\n".join(out)


def slugify(heading: str) -> str:
    """Approximate GitHub's heading-to-anchor conversion."""
    text = heading.strip().lower()
    text = re.sub(r"<[^>]+>", "", text)          # inline html
    text = re.sub(r"!?\[([^\]]*)\]\([^)]*\)", r"\1", text)  # links/images
    text = re.sub(r"[`*_~]", "", text)           # inline formatting
    text = re.sub(r"[^\w\- ]", "", text)         # punctuation
    return text.replace(" ", "-")


def anchors_of(path: Path) -> set[str]:
    seen: dict[str, int] = {}
    anchors: set[str] = set()
    body = strip_fences(path.read_text(encoding="utf-8"))
    for line in body.splitlines():
        m = HEADING.match(line)
        if not m:
            continue
        base = slugify(m.group(2))
        if not base:
            continue
        count = seen.get(base, 0)
        anchors.add(base if count == 0 else f"{base}-{count}")
        seen[base] = count + 1
    return anchors


def main(root_arg: str = ".") -> int:
    root = Path(root_arg).resolve()
    files = [
        p
        for p in root.rglob("*.md")
        if not any(part in SKIP_DIRS for part in p.parts)
    ]
    anchor_cache: dict[Path, set[str]] = {}
    failures: list[str] = []

    for path in files:
        body = strip_fences(path.read_text(encoding="utf-8"))
        for lineno, line in enumerate(body.splitlines(), start=1):
            for target in LINK.findall(INLINE_CODE.sub("", line)):
                if target.startswith(("http://", "https://", "mailto:")):
                    continue

                file_part, _, anchor = target.partition("#")
                if file_part:
                    resolved = (path.parent / file_part).resolve()
                    if not resolved.exists():
                        failures.append(
                            f"{path.relative_to(root)}:{lineno}: missing file -> {target}"
                        )
                        continue
                else:
                    resolved = path

                if not anchor or resolved.suffix != ".md":
                    continue
                if resolved not in anchor_cache:
                    anchor_cache[resolved] = anchors_of(resolved)
                if anchor not in anchor_cache[resolved]:
                    failures.append(
                        f"{path.relative_to(root)}:{lineno}: missing anchor -> {target}"
                    )

    for failure in failures:
        print(failure)
    print(
        f"\nchecked {len(files)} file(s); "
        f"{len(failures)} broken link(s)"
    )
    return 1 if failures else 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1] if len(sys.argv) > 1 else "."))
```

Make the file executable (`chmod +x scripts/check-links.py`).

## Acceptance checklist

Work through this and report the result of each item. Do not report success on an item you did not run.

1. `git status` shows only the files specified above — no extras, no stubs inside concept or recipe folders.
2. `docker compose config` parses without error.
3. `docker compose pull` succeeds, or you report the tag substitution you made.
4. `docker compose up -d` brings the container to healthy, `docker compose ps` confirms it, and `docker compose down` tears it down cleanly.
5. `python3 scripts/check-links.py .` runs. **On the scaffold-only tree — before `roadmap.md`, `progress.md`, or any article is added — it must exit 0.** If those files are already present, expect failures pointing at articles that do not exist yet; report them and do not "fix" them by creating files.
6. `node --version` is 24.x, and `.nvmrc` matches.
7. Every file is UTF-8 with LF endings. If `roadmap.md` and `progress.md` are present, confirm their status emoji still render as emoji and not as `?`.

## Out of scope for this task

Do not do any of these; they are separate tasks:

- creating the `demos/foundations` Nest application
- installing dependencies
- writing any article, recipe, or index content
- adding CI workflows