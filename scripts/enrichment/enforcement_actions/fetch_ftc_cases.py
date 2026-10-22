"""Read the FTC Legal Library "Cases and Proceedings" politely.

  python3 -I -B scripts/enrichment/enforcement_actions/fetch_ftc_cases.py --listing
  python3 -I -B scripts/enrichment/enforcement_actions/fetch_ftc_cases.py --cases [--limit N]

https://www.ftc.gov/legal-library/browse/cases-proceedings?page=N lists cases 20 to a page; each case page
(/legal-library/browse/cases-proceedings/<slug>) carries the matter number, civil action / docket numbers, court
and the case timeline with document links. ftc.gov robots.txt sets Crawl-delay: 5 and disallows items_per_page and
combine queries, so this reads one page at a time, 5 s apart, with no query other than ?page=N. Raw HTML is kept
unchanged in solid xz packs (see enf_common.PackWriter). Case pages are read newest "Last Updated" first; a re-run
continues where the last one stopped.
"""
import argparse
import json
import os
import re
import signal
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import enf_common as ec  # noqa: E402
import ftc_parse  # noqa: E402

BASE = "https://www.ftc.gov"
LISTING = BASE + "/legal-library/browse/cases-proceedings"
LIST_DIR = os.path.join(ec.ACQ, "ftc", "listing")
CASE_DIR = os.path.join(ec.ACQ, "ftc", "cases")
LOG = os.path.join(ec.SCRATCH, "ftc_fetch.log")


def log(msg):
    os.makedirs(os.path.dirname(LOG), exist_ok=True)
    with open(LOG, "a", encoding="utf-8") as handle:
        handle.write(f"{ec.now_utc()} {msg}\n")


def listing_url(n):
    return LISTING if n == 0 else f"{LISTING}?page={n}"


def crawl_listing(fetcher):
    packs = ec.PackWriter(LIST_DIR, per_pack=40, method="FTC Legal Library listing (direct GET, 5 s crawl delay)")
    n, last = 0, None
    try:
        while True:
            url = listing_url(n)
            if packs.has(url):
                n += 1
                if last is not None and n > last:
                    break
                continue
            status, body, final, _ = fetcher.get(url)
            if status != 200:
                log(f"listing {n}: HTTP {status}")
                break
            packs.add(url, body, status, final)
            text = body.decode("utf-8", "replace")
            pages = [int(x) for x in re.findall(r"[?&]page=(\d+)", text)]
            last = max(pages + [last or 0])
            rows = ftc_parse.parse_listing(text)
            if n % 10 == 0:
                log(f"listing page {n}/{last}: {len(rows)} case rows")
            if not rows and n > 0:
                log(f"listing page {n}: no case rows; stopping")
                break
            n += 1
            if n > last:
                break
    finally:
        packs.close()
    log(f"listing done through page {n - 1}")


def listed_cases():
    reader = ec.PackReader(LIST_DIR)
    out = {}
    for row in reader.rows_by_pack():
        text = reader.get(row["url"]).decode("utf-8", "replace")
        for case in ftc_parse.parse_listing(text):
            out.setdefault(case["url"], case)
    return list(out.values())


def crawl_cases(fetcher, limit):
    cases = listed_cases()
    cases.sort(key=lambda c: (c.get("last_updated") or ""), reverse=True)
    packs = ec.PackWriter(CASE_DIR, per_pack=20, method="FTC Legal Library case page (direct GET, 5 s crawl delay)")
    done = skipped = failed = 0
    try:
        for case in cases:
            url = BASE + case["url"]
            if packs.has(url):
                skipped += 1
                continue
            if limit and done >= limit:
                break
            try:
                status, body, final, _ = fetcher.get(url)
            except ec.Blocked as error:
                log(f"BLOCKED {error}; stopping")
                break
            except RuntimeError as error:
                failed += 1
                log(f"FAILED {error}")
                continue
            packs.add(url, body, status, final)
            done += 1
            if done % 50 == 0:
                log(f"cases: {done} fetched this run, {skipped} already stored, {failed} failed of {len(cases)}")
    finally:
        packs.close()
    log(f"cases end: {done} fetched, {skipped} already stored, {failed} failed of {len(cases)}")
    print(json.dumps({"listed": len(cases), "fetched": done, "already": skipped, "failed": failed}))


def main():
    # a stop signal (e.g. a time-limited background run) exits through the finally blocks, so buffered pages are packed
    signal.signal(signal.SIGTERM, lambda *_: sys.exit(0))
    parser = argparse.ArgumentParser()
    parser.add_argument("--listing", action="store_true")
    parser.add_argument("--cases", action="store_true")
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    fetcher = ec.Fetcher(default_interval=5.0, timeout=90)
    if args.listing:
        crawl_listing(fetcher)
    if args.cases:
        crawl_cases(fetcher, args.limit)


if __name__ == "__main__":
    main()
