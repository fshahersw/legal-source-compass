"""Regenerate src/lib/ingest/sources/pyHtml.ts (Python's html.unescape tables) from this CPython's html module.

  python3 -I -B scripts/api_law/enforcement/gen_html_entities.py
"""
import html
import html.entities
import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
TARGET = ROOT / "src/lib/ingest/sources/pyHtml.ts"


def main():
    text = TARGET.read_text()
    head, rest = text.split("const HTML5: Record<string, string> = ", 1)
    tail = rest.split("\nconst CHARREF", 1)[1]
    body = (
        "const HTML5: Record<string, string> = "
        + json.dumps(html.entities.html5, ensure_ascii=True, sort_keys=True, separators=(",", ":")) + ";\n"
        + "const INVALID_CHARREFS: Record<number, string> = "
        + json.dumps({str(k): v for k, v in html._invalid_charrefs.items()}, ensure_ascii=True, separators=(",", ":")) + ";\n"
        + "const INVALID_CODEPOINTS = new Set<number>(" + json.dumps(sorted(html._invalid_codepoints)) + ");\n"
    )
    TARGET.write_text(head + body + "\nconst CHARREF" + tail)
    print(f"wrote {TARGET} ({len(html.entities.html5)} names)")


if __name__ == "__main__":
    main()
