"""Fetch every HSR early termination notice from https://api.ftc.gov/v0/hsr-early-termination-notices.

  python3 -I -B fetch_hsr.py

The endpoint reports meta.count (the total) and pages 50 notices at a time with page[offset]/page[limit]. Notices created in
the same second have no fixed order between requests, so one pass can repeat one notice and miss another. Pass 0 reads
offsets 0, 50, 100 ...; later passes read the same list shifted by 25, 10, 35, 5 ... records until the union of distinct
notice ids (the API's own `id`) equals meta.count. Every page is stored unchanged (gzip) with a manifest line; the key is
sent in a header, so recorded URLs carry none.

Output: private/acq/ftc_data/hsr/pages/pass<k>_off<offset>.json.gz and hsr/_pass_log.json
"""
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ftc_http as fh  # noqa: E402

BASE = "https://api.ftc.gov/v0/hsr-early-termination-notices"
DIR = os.path.join(fh.ACQ, "hsr")
PAGES = os.path.join(DIR, "pages")
SHIFTS = [0, 25, 10, 35, 5, 15, 30]
METHOD = "api.ftc.gov /v0/hsr-early-termination-notices (direct GET, header key)"


def page_url(offset, limit):
    return f"{BASE}?page[offset]={offset}&page[limit]={limit}"


def read_page(path):
    import gzip

    with gzip.open(path, "rb") as handle:
        return json.loads(handle.read())


def fetch_page(fetcher, k, offset, limit):
    path = os.path.join(PAGES, f"pass{k}_off{offset:06d}.json.gz")
    if os.path.exists(path):
        return path
    for _ in range(3):
        entry, resp = fetcher.fetch_to_file(page_url(offset, limit), path, METHOD, gz=True)
        if resp.status == 200:
            try:
                doc = json.loads(resp.body)
            except ValueError:
                continue
            if "data" in doc:
                return path
        if os.path.exists(path):
            os.remove(path)
    raise fh.FetchError(f"page {offset} failed")


def main():
    fetcher = fh.Fetcher(interval_override={"api.ftc.gov": float(os.environ.get("FTC_API_INTERVAL", "2.0"))})
    first = json.loads(fetcher.get(page_url(0, 1)).body)
    total = int(first["meta"]["count"])
    print("meta.count", total, flush=True)
    seen = {}
    log = {"meta_count": total, "passes": []}
    for k, shift in enumerate(SHIFTS):
        jobs = []
        if shift:
            jobs.append((0, shift))
        off = shift
        while off < total + 50:
            jobs.append((off, 50))
            off += 50
        with ThreadPoolExecutor(max_workers=2) as pool:
            paths = list(pool.map(lambda j: fetch_page(fetcher, k, j[0], j[1]), jobs))
        for path in paths:
            for rec in read_page(path)["data"]:
                seen.setdefault(rec["id"], rec)
        log["passes"].append({"pass": k, "shift": shift, "pages": len(paths), "distinct_after_pass": len(seen)})
        print("pass", k, "shift", shift, "pages", len(paths), "distinct", len(seen), "of", total, flush=True)
        if len(seen) >= total:
            break
    log["distinct_ids"] = len(seen)
    log["complete"] = len(seen) == total
    with open(os.path.join(DIR, "_pass_log.json"), "w", encoding="utf-8") as handle:
        json.dump(log, handle, indent=1)
    print(json.dumps(log))


if __name__ == "__main__":
    main()
