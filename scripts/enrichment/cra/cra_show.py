"""Print the layout text of fetched PDFs whose URL contains a substring (development aid).

    python3 -I -B scripts/enrichment/cra/cra_show.py <url substring> [first page] [last page] [grep regex]
"""
from __future__ import annotations

import json
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cra_fetch  # noqa: E402
import cra_text  # noqa: E402

if __name__ == "__main__":
    sub = sys.argv[1]
    lo = int(sys.argv[2]) if len(sys.argv) > 2 else 1
    hi = int(sys.argv[3]) if len(sys.argv) > 3 else 999
    rx = re.compile(sys.argv[4], re.I) if len(sys.argv) > 4 else None
    for row in cra_fetch.load_manifest().values():
        u = row.get("final_url") or row["url"]
        if sub not in u or "sha256" not in row or "pdf" not in (row.get("content_type") or ""):
            continue
        info = json.load(open(cra_text.text_paths(row["sha256"])[1]))
        print(f"##### {u} pages={info['pages']} title={info['pdf_title']!r} created={info['pdf_created']}")
        for i, p in enumerate(cra_text.pages_of(row["sha256"]), 1):
            if lo <= i <= hi:
                if rx:
                    for line in p.splitlines():
                        if rx.search(line):
                            print(f"p{i}: {line.rstrip()}")
                else:
                    print(f"=============== page {i}")
                    print(p.rstrip())
