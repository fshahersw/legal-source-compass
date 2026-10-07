"""Fetch every node the captured NY law/article pages link to, until no linked node is unfetched.

acquire.py only queues links classified as articles or sections that sit on article pages. Title and part
containers (ACA/TA, CPL/P1, EDN/T1) and sections listed directly on a law page were never queued. A container
is a node page with no section text of its own; its links are followed. Section pages are never followed.
Prints the unfetched list and the final closure counts.
"""
import json
import pathlib
import sys
import time

from bs4 import BeautifulSoup

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(pathlib.Path(__file__).resolve().parent))
from common.provenance_fetch import Fetcher  # noqa: E402
from parse import NODE_URL, classify, links, parse_document  # noqa: E402

ROOT = pathlib.Path("/tmp/sc/NY")


def good_receipts(fetcher):
    out = {}
    for r in fetcher.receipts():
        if r.get("ok") and r.get("retrieval_method") == "proxied:firecrawl" and r.get("source_status") == 200:
            out[r["url"]] = r
    return out


def all_node_links(html):
    soup = BeautifulSoup(html, "lxml")
    found = []
    for anchor in soup.select("a[href]"):
        href = anchor["href"].split("?")[0].rstrip("/")
        if not href.startswith("http"):
            href = "https://www.nysenate.gov" + href
        if NODE_URL.search(href) and href not in found:
            found.append(href)
    return found


def main():
    fetcher = Fetcher("NY", ROOT, min_interval=1.0)
    attempts = {}
    for rounds in range(8):
        good = good_receipts(fetcher)
        frontier = []
        for url, receipt in good.items():
            kind = classify(url)
            html = fetcher.read(receipt).decode("utf8", "replace")
            if kind in ("law", "article"):
                frontier += all_node_links(html)
            elif kind == "section":
                doc = parse_document(html, url)
                if not doc["text"]:
                    frontier += all_node_links(html)
        missing = sorted({u for u in frontier if u not in good and attempts.get(u, 0) < 3})
        print({"round": rounds, "good": len(good), "missing": len(missing)}, flush=True)
        if not missing:
            break
        for url in missing:
            attempts[url] = attempts.get(url, 0) + 1
            receipt = fetcher.proxied(url, label="closure")
            print({"url": url, "ok": receipt.get("ok"), "status": receipt.get("source_status")}, flush=True)
            time.sleep(1)
    good = good_receipts(fetcher)
    unfetched = sorted({u for u in (x for r in good.values() for x in all_node_links(fetcher.read(r).decode("utf8", "replace"))
                                     if classify(r["url"]) in ("law", "article")) if u not in good})
    print(json.dumps({"unfetched_after_closure": unfetched}))


if __name__ == "__main__":
    main()
