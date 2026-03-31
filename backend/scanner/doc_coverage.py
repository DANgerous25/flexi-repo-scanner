"""Documentation coverage scanner — hybrid regex + optional LLM."""

from __future__ import annotations

import re
from typing import Any

from backend.scanner.pattern import Finding


# Patterns for undocumented public symbols by language
DOCSTRING_PATTERNS: dict[str, list[tuple[str, str]]] = {
    # Python: public functions/classes without docstrings
    ".py": [
        (
            r"^(class|def)\s+([A-Z_][a-zA-Z0-9_]*)\s*[\(:]",
            "Missing docstring for public {kind} '{name}'",
        ),
    ],
    # TypeScript/JavaScript: exported functions/classes
    ".ts": [
        (
            r"^export\s+(?:async\s+)?function\s+(\w+)",
            "Missing JSDoc for exported function '{name}'",
        ),
        (
            r"^export\s+class\s+(\w+)",
            "Missing JSDoc for exported class '{name}'",
        ),
    ],
    ".tsx": [
        (
            r"^export\s+(?:async\s+)?function\s+(\w+)",
            "Missing JSDoc for exported function '{name}'",
        ),
        (
            r"^export\s+(?:default\s+)?function\s+(\w+)",
            "Missing JSDoc for exported component '{name}'",
        ),
    ],
    ".js": [
        (
            r"^export\s+(?:async\s+)?function\s+(\w+)",
            "Missing JSDoc for exported function '{name}'",
        ),
    ],
}

# Alias common extensions
DOCSTRING_PATTERNS[".jsx"] = DOCSTRING_PATTERNS[".tsx"]


def scan_doc_coverage(file_path: str, content: str) -> list[Finding]:
    """Scan a file for missing documentation on public symbols."""
    import os
    _, ext = os.path.splitext(file_path)
    patterns = DOCSTRING_PATTERNS.get(ext, [])
    if not patterns:
        return []

    findings = []
    lines = content.split("\n")

    for i, line in enumerate(lines):
        stripped = line.strip()
        # Skip private/internal (Python underscore convention)
        if stripped.startswith("def _") or stripped.startswith("class _"):
            continue

        for pattern_str, msg_template in patterns:
            match = re.match(pattern_str, stripped)
            if not match:
                continue

            # Check if previous line(s) have a docstring/comment
            has_doc = _has_preceding_doc(lines, i, ext)
            if has_doc:
                continue

            # For Python defs/classes, check the line after for docstring
            if ext == ".py":
                has_doc = _has_following_docstring(lines, i)
                if has_doc:
                    continue

            groups = match.groups()
            name = groups[-1] if groups else "unknown"
            kind = groups[0] if len(groups) > 1 else "symbol"

            findings.append(Finding(
                category="Documentation",
                file_path=file_path,
                line_number=i + 1,
                severity="low",
                rule_id="doc-coverage",
                description=msg_template.format(name=name, kind=kind),
                matched_text=stripped[:100],
                context=stripped[:200],
            ))

    return findings


def _has_preceding_doc(lines: list[str], index: int, ext: str) -> bool:
    """Check if the line before contains a doc comment."""
    if index == 0:
        return False

    prev = lines[index - 1].strip()
    # JSDoc: /** ... */
    if prev.endswith("*/"):
        return True
    # Single-line comment docs
    if prev.startswith("///") or prev.startswith("/**"):
        return True
    # Python docstring on same line (rare but valid)
    if ext == ".py" and ('"""' in prev or "'''" in prev):
        return True
    return False


def _has_following_docstring(lines: list[str], index: int) -> bool:
    """Check if a Python def/class has a docstring on the next line(s)."""
    # Look for opening triple quotes within the next 2 lines
    for offset in range(1, min(3, len(lines) - index)):
        next_line = lines[index + offset].strip()
        if next_line.startswith('"""') or next_line.startswith("'''"):
            return True
        if next_line.startswith("def ") or next_line.startswith("class "):
            break
        if next_line and not next_line.startswith("#") and not next_line.startswith("@"):
            break
    return False
