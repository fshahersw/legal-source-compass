"""Harvest the DOJ Office of the Inspector General report listing and every report page (oig.justice.gov/reports).

  python3 -I -B scripts/enrichment/oversight/fetch_doj_oig.py [--list-only] [--limit N]

robots.txt (checked 2026-10-23) allows /reports and sets no Crawl-delay; requests are paced at one per 1.1 s.
The listing is read 250 reports per page (`items_per_page=250`); each report's own page is then read once for the
fields the listing lacks (report number, external entity, recommendations, monetary-impact fields when stated, PDF).
Raw HTML is stored gzip-compressed, unchanged, under private/acq/oversight/doj_oig/ and recorded in the manifest.
Re-running skips pages already on disk.
"""
import argparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import common as cm  # noqa: E402
import parse_doj_oig as pj  # noqa: E402

BASE = pj.BASE
ROOT = os.path.join(cm.ACQ, "doj_oig")


def list_url(n):
    return f"{BASE}/reports?items_per_page=250&page={n}"


def get_page(fetcher, url, dest):
    if os.path.exists(dest):
        return cm.read_gz(dest), False
    status, body, _, _ = fetcher.get(url)
    if status != 200:
        raise RuntimeError(f"{url}: HTTP {status}")
    cm.write_gz(dest, body)
    cm.record_manifest(url, dest, body, status, "direct GET (public page)")
    return body, True


def slug_of(path):
    return re.sub(r"[^A-Za-z0-9._-]", "_", path.strip("/").split("/")[-1])[:150]


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--list-only", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    fetcher = cm.Fetcher()
    reports = {}
    n = 0
    while True:
        body, _ = get_page(fetcher, list_url(n), os.path.join(ROOT, "list", f"p{n:03d}.html.gz"))
        rows = pj.parse_listing(body.decode("utf-8"))
        for row in rows:
            reports.setdefault(row["path"], row)
        cm.log("fetch_doj_oig", f"list page {n}: {len(rows)} rows; {len(reports)} unique so far")
        if len(rows) < 250:
            break
        n += 1
    print(f"listing: {n + 1} pages, {len(reports)} unique report paths")
    if args.list_only:
        return
    fetched = 0
    for i, path in enumerate(sorted(reports)):
        if args.limit and i >= args.limit:
            break
        dest = os.path.join(ROOT, "reports", f"{slug_of(path)}.html.gz")
        _, new = get_page(fetcher, BASE + path, dest)
        fetched += int(new)
        if new and fetched % 100 == 0:
            cm.log("fetch_doj_oig", f"report pages fetched {fetched}/{len(reports)} stats {fetcher.stats}")
    cm.log("fetch_doj_oig", f"done: {fetched} new report pages of {len(reports)}; stats {fetcher.stats}")
    print(f"report pages: {fetched} new of {len(reports)}; stats {fetcher.stats}")


if __name__ == "__main__":
    main()
