"""Fetch and parse FSIS's annual "Summary of Recall (and PHA) Cases in Calendar Year N" pages (official totals used to
check fsis_recalls). Pages are read through Firecrawl (direct requests get an Akamai 403) and stored with the manifest.

  python3 -I -B fsis_summaries.py fetch     fetch the pages listed on the annual-summaries index page
  python3 -I -B fsis_summaries.py parse     print the parsed totals as JSON
"""
from __future__ import annotations

import gzip
import json
import os
import re
import sys

from common import ACQ
from fsis import text

INDEX = os.path.join(ACQ, "fsis", "summaries", "index.html.gz")


def summary_links() -> dict[int, str]:
    with gzip.open(INDEX, "rt", encoding="utf-8") as f:
        s = f.read()
    out = {}
    for m in re.finditer(r'href="([^"]*annual-recall-summaries/[^"#]+)"[^>]*>(.*?)</a>', s, re.S):
        y = re.search(r"Calendar Year (\d{4})", text(m.group(2)))
        if y:
            out.setdefault(int(y.group(1)), m.group(1))
    return out


def fetch_all(years: range = range(2014, 2026)) -> None:
    from firecrawl_fetch import fetch

    for year, url in sorted(summary_links().items()):
        rel = f"summaries/summary_{year}.html.gz"
        if year in years and not os.path.exists(os.path.join(ACQ, "fsis", rel)):
            print(json.dumps(fetch(url, rel))[:160], flush=True)


def main_text(page_html: str) -> str:
    s = re.sub(r"<(script|style|noscript)\b.*?</\1>", " ", page_html, flags=re.S | re.I)
    i = s.find('id="main-content"')
    return text(s[i:] if i >= 0 else s)


def parse_summary(page_html: str) -> dict:
    t = main_text(page_html)
    start = t.find("Download the")
    t = t[start:] if start >= 0 else t
    out = {}
    m = re.search(r"(?:Total Recalls|Number of Recalls):?\s*([\d,]+)", t)
    out["recalls"] = int(m.group(1).replace(",", "")) if m else None
    m = re.search(r"Number of Pounds Recalled:?\s*([\d,]+)", t)
    out["pounds"] = int(m.group(1).replace(",", "")) if m else None
    m = re.search(r"Total Public Health Alerts(?: \(PHAs\))?:?\s*([\d,]+)", t)
    out["phas"] = int(m.group(1).replace(",", "")) if m else None
    classes = {}
    block = re.search(r"Recalls by Class(.*?)Recalls by Reason", t)
    if block:
        for cls, n, lbs in re.findall(r"\b(III|II|I)\s+([\d,]+)\s+([\d,]+)", block.group(1)):
            classes.setdefault(cls, {"recalls": int(n.replace(",", "")), "pounds": int(lbs.replace(",", ""))})
    out["by_class"] = classes
    return out


def parsed() -> dict[int, dict]:
    out = {}
    for year in range(2014, 2026):
        p = os.path.join(ACQ, "fsis", "summaries", f"summary_{year}.html.gz")
        if os.path.exists(p):
            with gzip.open(p, "rt", encoding="utf-8") as f:
                out[year] = parse_summary(f.read())
    return out


if __name__ == "__main__":
    if sys.argv[1:] == ["fetch"]:
        fetch_all()
    else:
        print(json.dumps(parsed(), indent=1))
