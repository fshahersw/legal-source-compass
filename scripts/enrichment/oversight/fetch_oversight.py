"""Harvest the Oversight.gov report listings (CIGIE; public reports of the federal Offices of Inspector General).

  python3 -I -B scripts/enrichment/oversight/fetch_oversight.py [--scope federal|state-local] [--max-pages N]

https://www.oversight.gov/reports/federal?items_per_page=100&page=N   (and /reports/state-local)

Oversight.gov has no bulk download, API or feed (the site answers only HTML; /jsonapi and /api are 404 and
`_format=json` is refused), so the public listing pages are read. robots.txt allows /reports and sets
`Crawl-delay: 5`, which this script honours (one request every 5.2 s). Each listing page's raw HTML bytes are
stored gzip-compressed, unchanged, under private/acq/oversight/oversight_gov/<scope>/ and recorded in the
manifest. Re-running skips pages already on disk; a page with fewer than 100 rows is the last page.
"""
import argparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as cm  # noqa: E402

BASE = "https://www.oversight.gov"
ROW = re.compile(rb'<tr class="listing-table__row table-row">')
PER_PAGE = 100


def page_url(scope, n):
    return f"{BASE}/reports/{scope}?items_per_page={PER_PAGE}&page={n}"


def page_path(scope, n):
    return os.path.join(cm.ACQ, "oversight_gov", scope, f"p{n:05d}.html.gz")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--scope", default="federal", choices=["federal", "state-local"])
    parser.add_argument("--max-pages", type=int, default=0)
    parser.add_argument("--start", type=int, default=0)
    args = parser.parse_args()
    fetcher = cm.Fetcher()
    n = args.start
    fetched = skipped = 0
    while True:
        if args.max_pages and n >= args.start + args.max_pages:
            break
        path = page_path(args.scope, n)
        if os.path.exists(path):
            rows = len(ROW.findall(cm.read_gz(path)))
            skipped += 1
        else:
            url = page_url(args.scope, n)
            status, body, _, _ = fetcher.get(url)
            if status != 200:
                raise SystemExit(f"{url}: HTTP {status}")
            rows = len(ROW.findall(body))
            if rows:
                cm.write_gz(path, body)
                cm.record_manifest(url, path, body, status, "direct GET (public listing page)")
            fetched += 1
            if fetched % 10 == 0:
                cm.log("fetch_oversight", f"{args.scope}: page {n} rows {rows} fetched {fetched} skipped {skipped} stats {fetcher.stats}")
        if rows < PER_PAGE:
            cm.log("fetch_oversight", f"{args.scope}: last page {n} with {rows} rows; fetched {fetched} skipped {skipped}")
            print(f"{args.scope}: last page {n}, rows {rows}, fetched {fetched}, skipped {skipped}")
            return
        n += 1
    print(f"{args.scope}: stopped at page {n}, fetched {fetched}, skipped {skipped}")


if __name__ == "__main__":
    main()
