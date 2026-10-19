"""Diagnostic: the units clean_units drops as leading contents entries for one state (single-file states, read-only).

  python3 -I -B scripts/enrichment/court_rules/peek_const_leading.py ST
"""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import constitution_parse as CP  # noqa: E402
import fetchlib  # noqa: E402
import textlib  # noqa: E402
from extract_constitutions import html_text  # noqa: E402


def main(argv):
    st = argv[0]
    prefix = f"private/acq/court_rules/constitutions/{st}/"
    paths = sorted({r["path"] for r in fetchlib.read_manifest() if r.get("http_status") == 200 and r.get("path", "").startswith(prefix)})
    for p in paths:
        if not os.path.exists(os.path.join(fetchlib.ROOT, p)) or "/index_" in p:
            continue
        raw = fetchlib.load_raw(p)
        text = textlib.pdf_text(os.path.join(fetchlib.ROOT, p), layout=False) if raw[:5] == b"%PDF-" else html_text(raw, "cp1252" if st == "NV" else "utf-8")
        units = CP.split_constitution(text)
        kept, stats = CP.clean_units([dict(u) for u in units])
        kept_starts = {u["start"] for u in kept}
        nums = [CP.article_number(u.get("article")) for u in units]
        known = [n for n in nums if n is not None]
        first = nums.index(min(known)) if known else 0
        for i, u in enumerate(units[:first]):
            if u["start"] not in kept_starts and u.get("article"):
                print(p, i, (u.get("article"), u.get("section")), json.dumps(u["text"][:150], ensure_ascii=False))


if __name__ == "__main__":
    main(sys.argv[1:])
