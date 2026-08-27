#!/usr/bin/env python3
"""Build one portable Markdown specification from the numbered design documents."""

from __future__ import annotations

import argparse
import os
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
DOCS = ROOT / "docs"
OUTPUT = ROOT / "dsh-military-design-specification.md"


def shift_headings(text: str, amount: int = 1) -> str:
    """Shift ATX Markdown headings outside fenced code blocks."""
    result: list[str] = []
    in_fence = False
    fence_marker = ""
    for line in text.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("```") or stripped.startswith("~~~"):
            marker = stripped[:3]
            if not in_fence:
                in_fence = True
                fence_marker = marker
            elif marker == fence_marker:
                in_fence = False
            result.append(line)
            continue
        if not in_fence:
            match = re.match(r"^(#{1,6})(\s+.*)$", line)
            if match:
                level = min(6, len(match.group(1)) + amount)
                line = "#" * level + match.group(2)
        result.append(line)
    return "\n".join(result).rstrip() + "\n"


def rewrite_relative_links(text: str, source_dir: Path, output_dir: Path) -> str:
    """Rebase Markdown links copied from a source document into the output file."""
    pattern = re.compile(r"(?P<prefix>!?\[[^\]]*\]\()(?P<target>[^)]+)(?P<suffix>\))")
    result: list[str] = []
    in_fence = False
    fence_marker = ""

    def replace(match: re.Match[str]) -> str:
        raw = match.group("target")
        # Preserve an optional Markdown title after the first whitespace.
        parts = raw.split(maxsplit=1)
        target = parts[0].strip("<>")
        title = " " + parts[1] if len(parts) == 2 else ""
        if not target or target.startswith(("#", "http://", "https://", "mailto:", "sandbox:")):
            return match.group(0)
        path_part, separator, fragment = target.partition("#")
        resolved = (source_dir / path_part).resolve()
        try:
            resolved.relative_to(ROOT.resolve())
        except ValueError:
            return match.group(0)
        rebased = Path(os.path.relpath(resolved, output_dir)).as_posix()
        if separator:
            rebased += "#" + fragment
        return f'{match.group("prefix")}{rebased}{title}{match.group("suffix")}'

    for line in text.splitlines():
        stripped = line.lstrip()
        if stripped.startswith("```") or stripped.startswith("~~~"):
            marker = stripped[:3]
            if not in_fence:
                in_fence = True
                fence_marker = marker
            elif marker == fence_marker:
                in_fence = False
            result.append(line)
            continue
        result.append(line if in_fence else pattern.sub(replace, line))
    return "\n".join(result) + ("\n" if text.endswith("\n") else "")


def extract_title(text: str, fallback: str) -> str:
    for line in text.splitlines():
        if line.startswith("# "):
            return line[2:].strip()
    return fallback


def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument('--check', action='store_true')
    args = parser.parse_args()
    docs = sorted(DOCS.glob("[0-9][0-9]-*.md"))
    if [int(path.name[:2]) for path in docs] != list(range(70)):
        raise SystemExit("Expected numbered documents 00 through 69")

    header = """# dsh-military 完整设计与开发规范

> 单文件汇编版；源文档位于 `docs/00-*.md` 至 `docs/69-*.md`。
> 文档工程版本：`0.9.0-draft`。  
> DSH 实现与验收基线：`deepseek-ai/deepseek-harness@b150a551b8d465e31e418e1b2eaf5e79bbb7d28e`（`dsh@0.1.1-rc.2`）。

## 使用说明

本文件用于连续阅读、评审和离线归档。实现时仍应以分主题文档、JSON Schema、ADR、示例和 TypeScript 参考契约共同作为规范，不应只复制本文件中的自然语言段落。

## 目录

"""

    toc: list[str] = []
    sections: list[str] = []
    for index, path in enumerate(docs):
        text = path.read_text(encoding="utf-8")
        title = extract_title(text, path.stem)
        anchor = f"part-{index:02d}"
        toc.append(f"- [{index:02d}. {title}](#{anchor})")

        shifted = shift_headings(text, 1)
        # Remove the shifted source H1; the Part heading is the canonical section heading.
        lines = shifted.splitlines()
        if lines and lines[0].startswith("## "):
            lines = lines[1:]
            while lines and not lines[0].strip():
                lines.pop(0)
        body = "\n".join(lines).rstrip()
        body = rewrite_relative_links(body, path.parent, ROOT).rstrip()
        sections.append(
            f'<a id="{anchor}"></a>\n\n## Part {index:02d}：{title}\n\n'
            f"源文件：`docs/{path.name}`\n\n{body}\n"
        )

    footer = """
---

## 配套工程资产

本规范的可执行配套位于：

- `schemas/`：JSON Schema Draft 2020-12；
- `examples/`：合法实例与 Mission Ledger 示例；
- `reference/types/`：可编译 TypeScript 参考类型；
- `templates/specs/`：工兵维护的 specs 工程模板；
- `adr/`：架构决策；
- `diagrams/`：Mermaid 图；
- `quality/` 与 `checklists/`：评测、威胁模型、SLO 和门禁清单。

执行 `python scripts/validate_artifacts.py` 验证文档工程一致性。
"""

    rendered = header + "\n".join(toc) + "\n\n---\n\n" + "\n\n---\n\n".join(sections) + footer
    if args.check:
        if not OUTPUT.exists() or OUTPUT.read_text(encoding="utf-8") != rendered:
            print(f"Stale single specification: {OUTPUT.name}")
            return 1
        return 0
    OUTPUT.write_text(rendered, encoding="utf-8")
    print(f"Wrote {OUTPUT} ({OUTPUT.stat().st_size} bytes)")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
