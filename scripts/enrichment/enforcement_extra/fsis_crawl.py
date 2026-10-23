"""Read FSIS's public recall listing (https://www.fsis.usda.gov/recalls) page by page through Firecrawl.

The FSIS recall API and FSIS's downloads answer this sandbox with an Akamai 403, which is not bypassed; the listing
pages are public HTML and are read through the Firecrawl scrape API at most one request per second (see
firecrawl_fetch.py). Each page is stored gzip-compressed with a manifest line. The crawl stops at the first page
without recall teasers (or after --max pages). FSIS answered every unfiltered page from 66 on with its "Site
Maintenance" page (HTTP 503), so older years are read through the listing's own year facet (?f[0]=year:<id>),
which keeps every request within the first few pages.

  python3 -I -B fsis_crawl.py [--start N] [--max 200]                  unfiltered listing
  python3 -I -B fsis_crawl.py --facet year:3 --label y2018 [--max 30]  one year facet (ids from the listing page)
"""
from __future__ import annotations

import gzip
import os
import re
import sys
import time
import urllib.parse

from common import ACQ
from firecrawl_fetch import fetch

LISTING = "https://www.fsis.usda.gov/recalls"
# Year facet ids as FSIS's listing page publishes them (facet links "?f[0]=year:<id>").
YEAR_FACETS = {2026: 685, 2025: 684, 2024: 606, 2023: 445, 2022: 444, 2021: 446, 2020: 1, 2019: 2, 2018: 3, 2017: 4,
               2016: 5, 2015: 6, 2014: 177}


def page_url(n: int, facet: str | None) -> str:
    params = ([("f[0]", facet)] if facet else []) + ([("page", str(n))] if n or not facet else [])
    return LISTING + ("?" + urllib.parse.urlencode(params) if params else "")


def crawl(start: int, limit: int, facet: str | None, label: str) -> None:
    for n in range(start, start + limit):
        rel = f"listing/{label}_page_{n:04d}.html.gz" if facet else f"listing/page_{n:04d}.html.gz"
        dest = os.path.join(ACQ, "fsis", rel)
        for attempt in range(4):
            if not os.path.exists(dest):
                entry = fetch(page_url(n, facet), rel)
                print(label, n, entry["bytes"], entry["origin_status"], flush=True)
                if entry["origin_status"] != 200:
                    # e.g. FSIS's "Site Maintenance" 503 page: discard it, wait, ask again (never parsed)
                    os.remove(dest)
                    time.sleep(30 * (attempt + 1))
                    continue
            break
        else:
            print(f"{label} page {n}: origin kept failing; stopping", flush=True)
            return
        with gzip.open(dest, "rt", encoding="utf-8") as f:
            teasers = len(re.findall(r'<section class="recall-teaser"', f.read()))
        if teasers == 0:
            print(f"{label} page {n}: no recall teasers; stopping", flush=True)
            return
    print(f"{label}: reached --max", flush=True)


def main(argv: list[str]) -> None:
    start = int(argv[argv.index("--start") + 1]) if "--start" in argv else 0
    limit = int(argv[argv.index("--max") + 1]) if "--max" in argv else 200
    if "--years" in argv:
        for year in [int(a) for a in argv[argv.index("--years") + 1].split(",")]:
            crawl(0, 40, f"year:{YEAR_FACETS[year]}", f"y{year}")
        return
    facet = argv[argv.index("--facet") + 1] if "--facet" in argv else None
    label = argv[argv.index("--label") + 1] if "--label" in argv else "all"
    crawl(start, limit, facet, label)


if __name__ == "__main__":
    main(sys.argv[1:])
