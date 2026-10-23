"""Fetch the daily Do Not Call reported-calls CSV files the FTC lists on its data-set page.

  python3 -I -B fetch_dnc_csv.py

https://www.ftc.gov/policy-notices/open-government/data-sets/do-not-call-data lists the most recent daily files
(/sites/default/files/DNC_Complaint_Numbers_<date>.csv). The stored copy of that page (fetch_pages.py) is the list of
what to fetch; files are stored unchanged, one request every 5 s (robots.txt Crawl-delay), and a file already in the
manifest is skipped.
"""
import gzip
import os
import re
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import fetch_pages as fp  # noqa: E402
import ftc_http as fh  # noqa: E402

PAGE = os.path.join(fh.ACQ, "pages", "dnc_data_page.html.gz")
LINK = re.compile(r'href="(/sites/default/files/(DNC_Complaint_Numbers_\d{4}-\d{2}-\d{2}\.csv))"')


def listed():
    html = gzip.open(PAGE).read().decode("utf-8", "replace")
    seen, out = set(), []
    for href, name in LINK.findall(html):
        if name not in seen:
            seen.add(name)
            out.append((name, "https://www.ftc.gov" + href))
    return sorted(out)


def main():
    fetcher = fh.Fetcher()
    files = listed()
    print(len(files), "daily files listed", flush=True)
    for name, url in files:
        try:
            fp.fetch(fetcher, name, url)
        except fh.FetchError as err:
            print("FAILED", url, err, flush=True)


if __name__ == "__main__":
    main()
