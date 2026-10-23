"""Read the Oversight.gov report pages of chosen Offices of Inspector General, for the money fields the listing lacks.

  python3 -I -B scripts/enrichment/oversight/fetch_oversight_details.py --oig "Securities and Exchange Commission OIG" [--oig ...] [--limit N]

A report page states "Questioned Costs" and "Funds for Better Use" (and the hosted report file and the OIG's own link).
The listing does not, and reading all ~36,000 pages at the 5.2 s Crawl-delay robots.txt asks for would take two days, so
only the OIGs named here are read; the builder records, per OIG, how many of its reports were read and shows money
totals only for an OIG whose every report was read. Raw HTML is stored gzip-compressed, unchanged, under
private/acq/oversight/oversight_gov/details/ and recorded in the manifest. Re-running skips pages already on disk.
"""
import argparse
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_oversight as bo  # noqa: E402
import common as cm  # noqa: E402

DETAILS = os.path.join(cm.ACQ, "oversight_gov", "details")


def detail_path(report_path):
    return os.path.join(DETAILS, re.sub(r"[^A-Za-z0-9._-]", "_", report_path.strip("/")) + ".html.gz")


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--oig", action="append", required=True)
    parser.add_argument("--limit", type=int, default=0)
    args = parser.parse_args()
    items, _ = bo.collect("federal")
    wanted = [r for r in items if r["oig"] in set(args.oig)]
    missing = set(args.oig) - {r["oig"] for r in wanted}
    if missing:
        raise SystemExit(f"no listed reports for: {sorted(missing)}")
    fetcher = cm.Fetcher()
    done = 0
    for r in wanted:
        if args.limit and done >= args.limit:
            break
        dest = detail_path(r["path"])
        if os.path.exists(dest):
            continue
        url = "https://www.oversight.gov" + r["path"]
        status, body, _, _ = fetcher.get(url)
        if status != 200:
            cm.log("fetch_oversight_details", f"{url}: HTTP {status}; skipped")
            continue
        cm.write_gz(dest, body)
        cm.record_manifest(url, dest, body, status, "direct GET (public report page)")
        done += 1
        if done % 25 == 0:
            cm.log("fetch_oversight_details", f"{done}/{len(wanted)} pages; stats {fetcher.stats}")
    cm.log("fetch_oversight_details", f"done: {done} new pages of {len(wanted)} wanted; stats {fetcher.stats}")
    print(f"{done} new pages of {len(wanted)} wanted")


if __name__ == "__main__":
    main()
