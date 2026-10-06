"""Acquire Wyoming Statutes verbatim PDFs and publisher pages from wyoleg.gov.

Usage: python3 acquire.py [--work /tmp/sc4/wy]
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))
from sc_common import Archive  # noqa: E402

from titles import DOWNLOAD_PAGE, STATUTES_HOME, TITLE_PDFS, pdf_url  # noqa: E402


def grab(arc, url, accept="text/html,application/pdf,*/*", **kw):
    rec = arc.fetch(url, accept=accept, **kw)
    if rec["state"] != "complete" and rec["http_status"] in (403, 406) and os.environ.get("FIRECRAWL_API_KEY"):
        rec = arc.fetch(url, route="firecrawl", force=True, **kw)
    return rec


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--work", default="/tmp/sc4/wy")
    a = ap.parse_args()
    arc = Archive(a.work, min_interval=1.0)
    pages = [
        STATUTES_HOME,
        DOWNLOAD_PAGE,
        "https://wyoleg.gov/Legislature/disclaimer",
        "https://wyoleg.gov/robots.txt",
    ]
    failed = []
    for u in pages:
        rec = grab(arc, u, accept_status=(200, 404) if u.endswith("robots.txt") else (200,))
        if rec["state"] != "complete":
            failed.append((u, rec.get("http_status")))
    for key, _label in TITLE_PDFS:
        u = pdf_url(key)
        rec = grab(arc, u, accept="application/pdf,*/*")
        if rec["state"] != "complete":
            failed.append((u, rec.get("http_status")))
        print(key, rec.get("state"), rec.get("bytes", 0), flush=True)
    print("done failed", failed, flush=True)
    json.dump({"failed": failed, "titles": len(TITLE_PDFS)}, open(os.path.join(a.work, "acquire_summary.json"), "w"))


if __name__ == "__main__":
    main()
