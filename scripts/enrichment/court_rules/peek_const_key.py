"""Diagnostic: the units of one state's (single-file) constitution around one article/section, before and after cleanup.

  python3 -I -B scripts/enrichment/court_rules/peek_const_key.py ST ARTICLE SECTION
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
    st, art, sec = argv
    m = {}
    for r in fetchlib.read_manifest():
        if r.get("http_status") == 200 and r.get("path", "").startswith(f"private/acq/court_rules/constitutions/{st}/"):
            m[r["path"]] = r
    for p in sorted(m):
        if not os.path.exists(os.path.join(fetchlib.ROOT, p)):
            continue
        raw = fetchlib.load_raw(p)
        text = textlib.pdf_text(os.path.join(fetchlib.ROOT, p), layout=False) if raw[:5] == b"%PDF-" else html_text(raw)
        units = CP.split_constitution(text)
        idx = [i for i, u in enumerate(units) if u.get("article") == art and u.get("section") == sec]
        for i in idx:
            for j in range(max(0, i - 1), min(len(units), i + 2)):
                u = units[j]
                print(p, j, (u.get("article"), u.get("section")), "contents" if CP.contents_like(u) else "body",
                      "heading_only" if CP.heading_only(u) else "", json.dumps(u["text"][:120]))
            print("--")


if __name__ == "__main__":
    main(sys.argv[1:])
