"""Harvest every DOJ press release from the official News API (no key).

  python3 -I -B scripts/enrichment/enforcement_actions/fetch_doj.py [--workers 5] [--max-pages N]

https://www.justice.gov/api/v1/press_releases.json?sort=created&direction=ASC&pagesize=50&page=N
At most 2 request starts per second to www.justice.gov (the API docs warn that more than 4/s may be blocked).
Each page's raw JSON bytes are stored gzip-compressed, unchanged, in private/acq/enforcement_actions/doj/pages/
and recorded in the manifest. Re-running skips pages already on disk. justice.gov sitemaps are not used.
"""
import argparse
import json
import math
import os
import sys
import threading
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import enf_common as ec  # noqa: E402

API = "https://www.justice.gov/api/v1/press_releases.json"
PAGES = os.path.join(ec.ACQ, "doj", "pages")
LOG = os.path.join(ec.SCRATCH, "doj_fetch.log")


def page_url(n):
    return f"{API}?sort=created&direction=ASC&pagesize=50&page={n}"


def page_path(n):
    return os.path.join(PAGES, f"p{n:05d}.json.gz")


_log_lock = threading.Lock()


def log(msg):
    with _log_lock:
        os.makedirs(os.path.dirname(LOG), exist_ok=True)
        with open(LOG, "a", encoding="utf-8") as handle:
            handle.write(f"{ec.now_utc()} {msg}\n")


def fetch_page(fetcher, n):
    path = page_path(n)
    if os.path.exists(path):
        data = json.loads(ec.read_gz(path))
        return n, len(data.get("results") or []), True
    url = page_url(n)
    for attempt in range(4):
        status, body, _, _ = fetcher.get(url)
        if status != 200:
            raise RuntimeError(f"page {n}: HTTP {status}")
        try:
            data = json.loads(body)
            results = data["results"]
            break
        except (ValueError, KeyError, TypeError):
            log(f"page {n}: malformed JSON on attempt {attempt + 1}")
            results = None
    if results is None:
        raise RuntimeError(f"page {n}: malformed JSON")
    if results:
        ec.write_gz(path, body)
        ec.record_manifest(url, path, body, status, "DOJ News API (direct GET)")
    return n, len(results), False


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--workers", type=int, default=5)
    parser.add_argument("--max-pages", type=int, default=0)
    args = parser.parse_args()
    fetcher = ec.Fetcher(default_interval=0.5, timeout=90)
    status, body, _, _ = fetcher.get(f"{API}?pagesize=1&page=0")
    total = int(json.loads(body)["metadata"]["resultset"]["count"])
    pages = math.ceil(total / 50) + 3
    if args.max_pages:
        pages = min(pages, args.max_pages)
    log(f"start: API count {total}, planning {pages} pages")
    done = failed = empty = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = [pool.submit(fetch_page, fetcher, n) for n in range(pages)]
        for fut in futures:
            try:
                n, count, cached = fut.result()
                done += 1
                if count == 0:
                    empty += 1
                if done % 100 == 0:
                    log(f"progress: {done}/{pages} pages, failed {failed}, empty {empty}, stats {fetcher.stats}")
            except Exception as error:  # recorded and counted; a re-run fetches the gap
                failed += 1
                log(f"FAILED {error}")
    # follow-on pages in case releases were added during the run
    n = pages
    while not args.max_pages:
        _, count, _ = fetch_page(fetcher, n)
        if count < 50:
            break
        n += 1
    log(f"end: {done} pages ok, {failed} failed, {empty} empty, stats {fetcher.stats}")
    print(json.dumps({"pages": pages, "ok": done, "failed": failed, "empty": empty, "api_count": total}))


if __name__ == "__main__":
    main()
