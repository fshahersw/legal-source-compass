"""Fetch every HSR early termination notice from https://api.ftc.gov/v0/hsr-early-termination-notices.

  python3 -I -B fetch_hsr.py --probe    # three requests: does the fixed sort order give the same notices for overlapping pages?
  python3 -I -B fetch_hsr.py --stable   # one pass in a fixed total order (created, then title, then id)
  python3 -I -B fetch_hsr.py            # shifted passes in the API's default order (created, newest first)

The endpoint reports meta.count (the total) and pages 50 notices at a time with page[offset]/page[limit]. Notices created in
the same second have no fixed order between requests, so one pass can repeat one notice and miss another: the stored first
default-order pass read 11,200 notices of which 10,478 were distinct. The --stable pass adds title and id as further sort keys,
which makes the order total, so one pass reads each notice once. The default mode reads offsets 0, 50, 100 ...; later passes read
the same list shifted by 25, 10, 35, 5 ... records until the union of distinct notice ids (the API's own `id`) equals meta.count.
Every page is stored unchanged (gzip) with a manifest line; the key is sent in a header, so recorded URLs carry none. The count
of distinct ids is taken over every stored page of every pass.

Output: private/acq/ftc_data/hsr/pages/pass<k>_off<offset>.json.gz and hsr/_pass_log.json
"""
import glob
import gzip
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
STABLE_SORT = (
    "&sort[sort-created][path]=created&sort[sort-created][direction]=DESC"
    "&sort[sort-title][path]=title&sort[sort-title][direction]=ASC"
    "&sort[sort-id][path]=id&sort[sort-id][direction]=ASC"
)


def page_url(offset, limit, sort=""):
    return f"{BASE}?page[offset]={offset}&page[limit]={limit}{sort}"


def read_page(path):
    with gzip.open(path, "rb") as handle:
        return json.loads(handle.read())


def fetch_page(fetcher, label, offset, limit, sort=""):
    path = os.path.join(PAGES, f"pass{label}_off{offset:06d}.json.gz")
    if os.path.exists(path):
        return path
    for _ in range(3):
        entry, resp = fetcher.fetch_to_file(page_url(offset, limit, sort), path, METHOD, gz=True)
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


def stored_ids():
    """Distinct notice ids over every stored page of every pass."""
    ids = set()
    for path in glob.glob(os.path.join(PAGES, "*.json.gz")):
        for rec in read_page(path)["data"]:
            ids.add(rec["id"])
    return ids


def new_fetcher():
    return fh.Fetcher(interval_override={"api.ftc.gov": float(os.environ.get("FTC_API_INTERVAL", "2.0"))})


def ids_of(fetcher, offset, limit, sort):
    resp = fetcher.get(page_url(offset, limit, sort))
    if resp.status != 200:
        raise fh.FetchError(f"HTTP {resp.status}")
    return [r["id"] for r in json.loads(resp.body)["data"]]


def probe():
    """Same page twice and an overlapping page of a different size: with a total order the shared positions agree."""
    fetcher = new_fetcher()
    a = ids_of(fetcher, 9000, 50, STABLE_SORT)
    b = ids_of(fetcher, 9000, 50, STABLE_SORT)
    c = ids_of(fetcher, 8975, 50, STABLE_SORT)  # the second half of c is the first half of a
    d = ids_of(fetcher, 9025, 50, STABLE_SORT)  # the first half of d is the second half of a
    same_page = a == b
    overlap = c[25:] == a[:25] and d[:25] == a[25:]
    print(json.dumps({"same_page_twice": same_page, "overlapping_windows": overlap, "distinct_in_page": len(set(a)), "page_len": len(a)}))
    return same_page and overlap and len(set(a)) == len(a) == 50


def main():
    if "--probe" in sys.argv:
        sys.exit(0 if probe() else 1)
    stable = "--stable" in sys.argv
    fetcher = new_fetcher()
    first = json.loads(fetcher.get(page_url(0, 1)).body)
    total = int(first["meta"]["count"])
    print("meta.count", total, "stored distinct before", len(stored_ids()), flush=True)
    log = {"meta_count": total, "mode": "stable" if stable else "shifted", "passes": []}
    plan = [("S", 0, STABLE_SORT)] if stable else [(str(k), shift, "") for k, shift in enumerate(SHIFTS)]
    for label, shift, sort in plan:
        jobs = []
        if shift:
            jobs.append((0, shift))
        off = shift
        while off < total + 50:
            jobs.append((off, 50))
            off += 50
        with ThreadPoolExecutor(max_workers=2) as pool:
            paths = list(pool.map(lambda j: fetch_page(fetcher, label, j[0], j[1], sort), jobs))
        distinct = len(stored_ids())
        log["passes"].append({"pass": label, "shift": shift, "pages": len(paths), "distinct_after_pass": distinct})
        print("pass", label, "shift", shift, "pages", len(paths), "distinct", distinct, "of", total, flush=True)
        if distinct >= total:
            break
    log["distinct_ids"] = len(stored_ids())
    log["complete"] = log["distinct_ids"] == total
    with open(os.path.join(DIR, "_pass_log.json"), "w", encoding="utf-8") as handle:
        json.dump(log, handle, indent=1)
    print(json.dumps(log))


if __name__ == "__main__":
    main()
