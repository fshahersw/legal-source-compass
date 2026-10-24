"""List figure/appendix/table titles per report (development aid): lines that start a caption on a page.

    python3 -I -B scripts/enrichment/cra/cra_titles.py <url substring> [title regex]
"""
from __future__ import annotations

import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cra_fetch  # noqa: E402
import cra_text  # noqa: E402

CAP = re.compile(r"^\s{0,12}((?:Figure|Appendix|Table|Exhibit)\s+[0-9]+[A-Z]?\s*[:.-]?\s*.{3,120}?)\s{3,}|^\s{0,12}((?:Figure|Appendix|Table|Exhibit)\s+[0-9]+[A-Z]?\s*[:.-]?\s*.{3,120})$")

if __name__ == "__main__":
    sub = sys.argv[1]
    rx = re.compile(sys.argv[2], re.I) if len(sys.argv) > 2 else None
    rows = sorted((r for r in cra_fetch.load_manifest().values() if sub in (r.get("final_url") or r["url"]) and r.get("sha256")
                   and "pdf" in (r.get("content_type") or "")), key=lambda r: r.get("final_url") or r["url"])
    for row in rows:
        print("#####", (row.get("final_url") or row["url"]).split("/")[-1])
        for i, p in enumerate(cra_text.pages_of(row["sha256"]), 1):
            for line in p.splitlines():
                m = CAP.match(line)
                if m:
                    t = (m.group(1) or m.group(2)).strip()
                    if re.search(r"\.{4,}|\s\d{1,3}$", t):
                        continue
                    if rx is None or rx.search(t):
                        print(f"  p{i}: {t}")
