"""Resume a proxied capture of the NY Senate consolidated-law pages.

Direct requests to www.nysenate.gov from this environment get a Cloudflare
challenge, and public.leginfo.state.ny.us does not connect. Firecrawl is the
recorded fallback (retrieval_method proxied:firecrawl). It is not a terms gate.
"""
import sys
import time
import pathlib
from bs4 import BeautifulSoup

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1]))
from common.provenance_fetch import Fetcher
from parse import classify, links, parse_document

ROOT = pathlib.Path("/tmp/sc/NY")
INDEX = "https://www.nysenate.gov/legislation/laws/CONSOLIDATED"


def good(receipt):
    return receipt.get("ok") and receipt.get("retrieval_method") == "proxied:firecrawl" and receipt.get("source_status") == 200


def have(fetcher):
    return {r["url"] for r in fetcher.receipts() if good(r)}


def body(fetcher, receipt):
    return fetcher.read(receipt).decode("utf8", "replace")


def latest(fetcher):
    found = {}
    for receipt in fetcher.receipts():
        if good(receipt):
            found[receipt["url"]] = receipt
    return found


def main():
    phase = sys.argv[1] if len(sys.argv) > 1 else "laws"
    fetcher = Fetcher("NY", ROOT, min_interval=1.0)
    done = have(fetcher)
    if INDEX not in done:
        fetcher.proxied(INDEX, label="consolidated-index")
        time.sleep(1)
    pages = latest(fetcher)
    index = body(fetcher, pages[INDEX])
    laws = links(BeautifulSoup(index, "lxml"), "law")
    queue = laws
    if phase in ("articles", "sections"):
        queue = []
        for url in laws:
            receipt = pages.get(url)
            if not receipt:
                continue
            queue.extend(links(BeautifulSoup(body(fetcher, receipt), "lxml"), "article"))
    if phase == "sections":
        articles = queue
        queue = []
        pages = latest(fetcher)
        for url in articles:
            receipt = pages.get(url)
            if not receipt:
                continue
            queue.extend(links(BeautifulSoup(body(fetcher, receipt), "lxml"), "section"))
    pending = [url for url in queue if url not in done]
    print({"phase": phase, "queued": len(queue), "pending": len(pending)}, flush=True)
    for index, url in enumerate(pending, 1):
        receipt = fetcher.proxied(url, label=phase)
        ok = good(receipt) and classify(url) == parse_document(body(fetcher, receipt), url)["kind"]
        print({"n": index, "of": len(pending), "url": url, "ok": ok, "bytes": receipt.get("bytes"), "status": receipt.get("source_status")}, flush=True)
        time.sleep(1)


if __name__ == "__main__":
    main()
