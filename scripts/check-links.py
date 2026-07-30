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
