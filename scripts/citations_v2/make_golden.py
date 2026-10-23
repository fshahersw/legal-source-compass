"""Writes src/lib/citations/fixtures/golden.json from golden_texts.py with the Python engine (review the diff!).

    python3 -I -B scripts/citations_v2/make_golden.py [--print]
"""

from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

import engine  # noqa: E402
from golden_texts import PAGES, TEXTS  # noqa: E402

OUT = HERE.parents[1] / "src" / "lib" / "citations" / "fixtures" / "golden.json"


def build() -> dict:
    table = engine.default().table
    return {
        "pattern_version": table["version"],
        "texts": [{"id": i, "text": t, "expected": engine.extract(t)} for i, t in TEXTS],
        "documents": [{"id": i, "pages": p, "expected": engine.extract_pages(p)} for i, p in PAGES],
    }


def main(argv: list[str]) -> int:
    data = build()
    if "--print" in argv:
        for t in data["texts"]:
            print("==", t["id"], "|", t["text"][:120])
            for c in t["expected"]:
                print("  ", c["kind"], c["form"], c["short"] or "-", repr(c["matched"]), c["key"], "|", c["normalized"], "| pin", c["pin"],
                      "| g", c["group"], "| name", (c["name"] or {}).get("text"), "| paren", (c["paren"] or {}).get("court"),
                      (c["paren"] or {}).get("year"), "| ant", c["antecedent"], c["short_status"])
        for d in data["documents"]:
            print("== doc", d["id"])
            for p, page in enumerate(d["expected"]):
                for c in page:
                    print("  ", p, c["kind"], c["form"], c["short"] or "-", repr(c["matched"]), c["key"], "| ant", c["antecedent"], c["short_status"])
        return 0
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(data, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")
    print(json.dumps({"texts": len(data["texts"]), "citations": sum(len(t["expected"]) for t in data["texts"])}))
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
