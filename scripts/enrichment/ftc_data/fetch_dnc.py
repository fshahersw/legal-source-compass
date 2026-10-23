"""Fetch Do Not Call reported calls from https://api.ftc.gov/v0/dnc-complaints, one created-date day at a time, and aggregate.

  python3 -I -B fetch_dnc.py --from 2025-10-01 --to 2026-09-30 [--workers 6] [--interval 0.25] [--newest-first]

For each day D the script requests created_date="D" with items_per_page=50 and offset 0, 50, ... until a page has fewer than
50 records, then requests one more page and requires it to be empty (a short page in the middle of a day is never trusted).
Every record is counted by dnc_agg.add_record (state, subject and robocall flag as published) and de-duplicated on the API
record id inside the day. Only the aggregate and a hash chain of the page bodies are kept for each day
(private/acq/ftc_data/dnc/days/D.json); the first page of each day (the 50 most recently created complaints) is stored raw
and unchanged (private/acq/ftc_data/dnc/sample/D.json.gz) with a manifest line. Days already on disk are skipped, so the
script resumes. Re-running a day reproduces its hash chain unless the FTC changed those records.

The API key goes in the X-Api-Key header (ftc_http), so no URL recorded anywhere contains it. The allowance is 20,000
requests an hour per key; the default 0.25 s interval is about 4 requests a second and slows to one per 2 s when fewer than
2,500 remain. HTTP 429 backs off with Retry-After.
"""
import argparse
import datetime as dt
import hashlib
import json
import os
import sys
import threading
import time
import urllib.parse
from concurrent.futures import ThreadPoolExecutor, as_completed

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import dnc_agg  # noqa: E402
import ftc_http as fh  # noqa: E402

BASE = "https://api.ftc.gov/v0/dnc-complaints"
DIR = os.path.join(fh.ACQ, "dnc")
DAYS = os.path.join(DIR, "days")
SAMPLE = os.path.join(DIR, "sample")
LOG = os.path.join(fh.SCRATCH, "dnc_fetch.log")
PAGE = 50
METHOD = "api.ftc.gov /v0/dnc-complaints?created_date=<day> (direct GET, header key); first page of each day stored unchanged"
_log_lock = threading.Lock()


def log(msg):
    line = f"{fh.now_utc()} {msg}"
    with _log_lock:
        os.makedirs(os.path.dirname(LOG), exist_ok=True)
        with open(LOG, "a", encoding="utf-8") as handle:
            handle.write(line + "\n")
        print(line, flush=True)


def day_url(day, offset):
    q = urllib.parse.urlencode({"created_date": f'"{day}"', "items_per_page": PAGE, "offset": offset})
    return f"{BASE}?{q}"


def fetch_day(fetcher, day):
    out_path = os.path.join(DAYS, day + ".json")
    if os.path.exists(out_path):
        return "have"
    agg, quality, seen = {}, dnc_agg.new_quality(), set()
    chain = hashlib.sha256()
    first_sha = None
    pages = 0
    offset = 0
    duplicates = 0
    started = time.time()
    while True:
        url = day_url(day, offset)
        if offset == 0:
            entry, resp = fetcher.fetch_to_file(url, os.path.join(SAMPLE, day + ".json.gz"), METHOD, gz=True)
            first_sha = entry["sha256"]
        else:
            resp = fetcher.get(url)
        if resp.status != 200:
            if offset == 0 and os.path.exists(os.path.join(SAMPLE, day + ".json.gz")):
                os.remove(os.path.join(SAMPLE, day + ".json.gz"))
            raise fh.FetchError(f"{day} offset {offset}: HTTP {resp.status}")
        doc = json.loads(resp.body)
        data = doc.get("data")
        if data is None:
            raise fh.FetchError(f"{day} offset {offset}: no data member")
        pages += 1
        chain.update(hashlib.sha256(resp.body).hexdigest().encode())
        for rec in data:
            rid = rec.get("id")
            if rid in seen:
                duplicates += 1
                continue
            seen.add(rid)
            dnc_agg.add_record(rec.get("attributes") or {}, day, agg, quality)
        if len(data) < PAGE:
            if len(data) == 0 and offset == 0:
                break
            if len(data) == 0:
                break
            # a short page ends the list only if the next page is empty
            offset += PAGE
            nxt = fetcher.get(day_url(day, offset))
            nd = json.loads(nxt.body).get("data") or []
            chain.update(hashlib.sha256(nxt.body).hexdigest().encode())
            pages += 1
            if nd:
                raise fh.FetchError(f"{day}: page after a short page at offset {offset} is not empty")
            break
        offset += PAGE
    result = {
        "day": day,
        "records_seen": quality["records"] + duplicates,
        "distinct_records": len(seen),
        "duplicates_dropped": duplicates,
        "pages": pages,
        "first_page_sha256": first_sha,
        "page_hash_chain_sha256": chain.hexdigest(),
        "quality": quality,
        "agg": dict(sorted(agg.items())),
        "fetched_at": fh.now_utc(),
        "seconds": round(time.time() - started, 1),
        "api_ratelimit_remaining": fetcher.api_remaining,
    }
    os.makedirs(DAYS, exist_ok=True)
    tmp = out_path + ".tmp"
    with open(tmp, "w", encoding="utf-8") as handle:
        json.dump(result, handle, separators=(",", ":"))
    os.replace(tmp, out_path)
    return result


def daterange(a, b):
    d = a
    while d <= b:
        yield d
        d += dt.timedelta(days=1)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--from", dest="start", required=True)
    ap.add_argument("--to", dest="end", required=True)
    ap.add_argument("--workers", type=int, default=2)
    ap.add_argument("--interval", type=float, default=2.0)
    ap.add_argument("--newest-first", action="store_true")
    args = ap.parse_args()
    a, b = dt.date.fromisoformat(args.start), dt.date.fromisoformat(args.end)
    days = [d.isoformat() for d in daterange(a, b)]
    if args.newest_first:
        days.reverse()
    fetcher = fh.Fetcher(interval_override={"api.ftc.gov": args.interval})
    failed = []
    limited = 0
    done = 0
    todo = [d for d in days if not os.path.exists(os.path.join(DAYS, d + ".json"))]
    log(f"start {args.start}..{args.end}: {len(days)} days, {len(todo)} to fetch, {args.workers} workers, interval {args.interval}s")
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(fetch_day, fetcher, d): d for d in todo}
        for fut in as_completed(futures):
            d = futures[fut]
            try:
                res = fut.result()
                done += 1
                log(f"{d} records={res['distinct_records']} dup={res['duplicates_dropped']} pages={res['pages']} {res['seconds']}s remaining_allowance={res['api_ratelimit_remaining']} ({done}/{len(todo)})")
            except fh.RateLimited as err:
                failed.append(d)
                limited = max(limited, err.retry_after)
                log(f"{d} stopped: the API asked to wait {err.retry_after} s")
            except Exception as err:  # noqa: BLE001 - keep going, report at the end
                failed.append(d)
                log(f"{d} FAILED {err!r}")
    log(f"finished: {done} fetched, {len(failed)} not finished {failed}")
    if limited:
        log(f"rate limited: resume in about {limited} s (re-run the same command; finished days are skipped)")
        sys.exit(3)
    if failed:
        sys.exit(1)


if __name__ == "__main__":
    main()
