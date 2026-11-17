"""
Full source of a web page for text assertions in unit tests:
the template plus every CSS/JS file it loads through static_url(),
including the ES modules the page entry reaches through `import`.
"""
from __future__ import annotations

import re
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent

_STATIC_URL = re.compile(r"static_url\('((?:css|js)/[^']+)'\)")
_MODULE_ENTRY = re.compile(r"module_entry\('(js/[^']+)'\)")
_IMPORT = re.compile(r"^import\s[^;]*?from\s+'([^']+)';", re.M)


def _with_imports(path: Path, seen: set, parts: list) -> None:
    """Append a JS module and, depth first, every module it imports."""
    if path in seen or not path.exists():
        return
    seen.add(path)
    text = path.read_text(encoding="utf-8")
    parts.append(text)
    for spec in _IMPORT.findall(text):
        _with_imports((path.parent / spec).resolve(), seen, parts)


def page_source(name: str) -> str:
    parts = []
    seen = set()
    html_path = ROOT / "templates" / f"{name}.html"
    html = ""
    if html_path.exists():
        html = html_path.read_text(encoding="utf-8")
        parts.append(html)
        seen.add(html_path.resolve())
    for rel in _STATIC_URL.findall(html) + _MODULE_ENTRY.findall(html):
        path = (ROOT / "static" / rel).resolve()
        if rel.endswith(".js"):
            _with_imports(path, seen, parts)
        elif path.exists() and path not in seen:
            seen.add(path)
            parts.append(path.read_text(encoding="utf-8"))
    # Fallback when a page has no static_url() yet
    for rel in (f"static/css/{name}.css", f"static/js/{name}.js"):
        path = (ROOT / rel).resolve()
        if path.exists() and path not in seen:
            parts.append(path.read_text(encoding="utf-8"))
    return "\n".join(parts)
