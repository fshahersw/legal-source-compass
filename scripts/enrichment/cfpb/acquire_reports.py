"""Fetch every page of the CFPB research-report catalog (filterable list) unchanged into private/acq/cfpb/reports/.

Usage: python3 -I -B scripts/enrichment/cfpb/acquire_reports.py [last_page]
Page 1 is the list URL itself; pages 2..N use the list's own ?page=N links.
"""
import os
import re
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

from fetch import ACQ, fetch  # noqa: E402

LIST_URL = "https://www.consumerfinance.gov/data-research/research-reports/"


def total_pages(path):
    with open(path, encoding="utf-8") as handle:
        match = re.search(r"\d+ out of (\d+) total pages", handle.read())
    return int(match.group(1)) if match else 1


def main():
    first = os.path.join(ACQ, "reports", "page-001.html")
    if not os.path.exists(first):
        fetch(LIST_URL, "reports/page-001.html")
    last = int(sys.argv[1]) if len(sys.argv) > 1 else total_pages(first)
    for page in range(2, last + 1):
        rel = f"reports/page-{page:03d}.html"
        if os.path.exists(os.path.join(ACQ, rel)):
            continue
        entry = fetch(f"{LIST_URL}?page={page}", rel)
        print(page, entry["bytes"], entry["sha256"][:12], flush=True)


if __name__ == "__main__":
    main()
