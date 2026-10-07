#!/usr/bin/env python3
"""Capture the New York Consolidated Laws from www.nysenate.gov by walking the publisher's own table of contents.

Direct requests to www.nysenate.gov get a Cloudflare challenge (HTTP 403, cf-mitigated: challenge) even with a browser
User-Agent, and the OpenLegislation API returns 401 without a key; the owner accepted Firecrawl copies on 2026-10-07
(retrieval_method proxied:firecrawl, maxAge 0 so no cached copy is used). The Legislative Retrieval System
(public.leginfo.state.ny.us) answers only on plain HTTP, which the intake contract cannot register as a source.

Walk: CONSOLIDATED index -> each law -> every child entry the page prints, level by level, until no printed entry is
unfetched. Each page is retried until Firecrawl returns the publisher's HTTP 200 statute page; a page that still says
"could not be found" is recorded in ROOT/not-found.json, not hidden. Resumable: usable receipts are reused.

    capture.py [--workers 40] [--root /tmp/sc/NY]
"""
import argparse
import json
import pathlib
import sys
import threading
import time
from concurrent.futures import ThreadPoolExecutor

HERE = pathlib.Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
sys.path.insert(0, str(HERE))
from common.provenance_fetch import Fetcher  # noqa: E402
from parse import INDEX, NOT_FOUND, parse_page  # noqa: E402

OPTIONS = {"maxAge": 0}
ATTEMPTS = 6
# The site keeps a stale "could not be found" answer for some printed entries (CPL 690.36 on 2026-10-07); the same page
# with ?view=all is served fresh and parses identically to the plain URL on pages that do answer.
UNCACHED = "?view=all"


def page_url(url):
    return url[:-len(UNCACHED)] if url.endswith(UNCACHED) else url


class CreditsExhausted(RuntimeError):
    pass


def usable(fetcher, receipt):
    if not (receipt.get("ok") and receipt.get("retrieval_method") == "proxied:firecrawl"
            and receipt.get("status") == 200 and receipt.get("source_status") == 200):
        return None
    page = parse_page(fetcher.read(receipt).decode("utf8", "replace"), page_url(receipt["url"]))
    if not page["statute_page"] or page["not_found"]:
        return None
    return page


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--root", default="/tmp/sc/NY")
    ap.add_argument("--workers", type=int, default=40)
    a = ap.parse_args()
    fetcher = Fetcher("NY", a.root, min_interval=0)
    pages, receipts = {}, {}
    for r in fetcher.receipts():
        if page_url(r["url"]) in pages:
            continue
        page = usable(fetcher, r)
        if page:
            pages[page_url(r["url"])], receipts[page_url(r["url"])] = page, r
    print(json.dumps({"resumed_pages": len(pages)}), flush=True)
    lock = threading.Lock()
    stats = {"fetched": 0, "retries": 0, "credits": 0}
    stop = threading.Event()
    not_found = {}

    def fetch(url):
        if url in pages or stop.is_set():
            return url
        last = None
        target = url
        for attempt in range(1, ATTEMPTS + 1):
            r = fetcher.proxied(target, label="toc-walk", options=OPTIONS)
            with lock:
                stats["credits"] += 1
            if r.get("status") == 402:
                stop.set()
                raise CreditsExhausted("Firecrawl returned 402 (credits exhausted)")
            page = usable(fetcher, r) if r.get("ok") else None
            if page:
                with lock:
                    pages[url], receipts[url] = page, r
                    stats["fetched"] += 1
                    not_found.pop(url, None)
                return url
            last = r
            if r.get("ok") and r.get("source_status") == 200:
                with lock:
                    not_found[url] = {"url": url, "attempts": attempt, "retrieved_at": r["retrieved_at"], "sha256": r.get("sha256")}
                if NOT_FOUND.encode() in fetcher.read(r):
                    target = url + UNCACHED
            with lock:
                stats["retries"] += 1
            time.sleep(min(60, 2 ** attempt) if r.get("status") == 429 else attempt)
        print(json.dumps({"unusable": url, "status": last.get("status"), "source_status": last.get("source_status"),
                          "error": last.get("error")}), flush=True)
        return url

    frontier, seen, level = [INDEX], {INDEX}, 0
    t0 = time.time()
    with ThreadPoolExecutor(a.workers) as ex:
        while frontier and not stop.is_set():
            for i, _ in enumerate(ex.map(fetch, frontier), 1):
                if i % 1000 == 0:
                    print(json.dumps({"level": level, "done": i, "of": len(frontier), **stats,
                                      "elapsed_s": round(time.time() - t0)}), flush=True)
            nxt = []
            for url in frontier:
                page = pages.get(url)
                if not page:
                    continue
                for child, _label, _kind in page["toc"]:
                    if child not in seen:
                        seen.add(child)
                        nxt.append(child)
            print(json.dumps({"level": level, "pages": len(frontier), "next": len(nxt), "captured_total": len(pages), **stats,
                              "elapsed_s": round(time.time() - t0)}), flush=True)
            frontier, level = nxt, level + 1
    missing = sorted(u for u in seen if u not in pages)
    pathlib.Path(a.root, "not-found.json").write_text(json.dumps(sorted(not_found.values(), key=lambda x: x["url"]), indent=1))
    pathlib.Path(a.root, "unfetched.json").write_text(json.dumps(missing, indent=1))
    print(json.dumps({"printed_entries": len(seen), "captured": len(pages), "unfetched": len(missing),
                      "not_found": len(not_found), **stats, "elapsed_s": round(time.time() - t0)}), flush=True)
    return 0 if not missing else 1


if __name__ == "__main__":
    sys.exit(main())
