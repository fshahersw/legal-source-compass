"""Discovery aid: for reports whose URL matches a regex, print every table region whose caption matches, with its header,
the number of value cells per row and the row labels.

    python3 -I -B scripts/enrichment/cra/cra_discover.py <url regex> <caption regex> [year] [full]
"""
from __future__ import annotations

import collections
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import cra_fetch  # noqa: E402
import cra_tables as T  # noqa: E402
import cra_text  # noqa: E402

if __name__ == "__main__":
    urx = re.compile(sys.argv[1])
    cap = re.compile(sys.argv[2])
    year_rows = len(sys.argv) > 3 and sys.argv[3] == "year"
    full = len(sys.argv) > 4 and sys.argv[4] == "full"
    for row in sorted(cra_fetch.load_manifest().values(), key=lambda r: r.get("final_url") or r["url"]):
        u = row.get("final_url") or row["url"]
        if row.get("status") != 200 or not urx.search(u) or "pdf" not in (row.get("content_type") or ""):
            continue
        regs = T.regions(cra_text.pages_of(row["sha256"]), cap, year_rows=year_rows)
        print("#####", u.split("/")[-1], f"({len(regs)} regions)")
        for r in regs:
            counts = collections.Counter(len(x.cells) for x in r.rows)
            print(f"  p{r.page} {r.caption[:110]}")
            print(f"     header: {r.header[:400]}")
            print(f"     cells/row: {dict(counts)}  rows={len(r.rows)} rejected={len(r.rejected)}")
            labels = [x.label for x in r.rows]
            print(f"     labels: {labels[:40]}")
            if full:
                for x in r.rows:
                    print(f"       {x.label!r}: {x.cells}")
            for rj in r.rejected[:4]:
                print(f"     REJECTED: {rj[:160]}")
