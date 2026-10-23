"""Count the Do Not Call records the API lists for a window, by paging with one record per page (no record is read).

  python3 -I -B count_api.py --day 2026-09-16
  python3 -I -B count_api.py --months 2024-01 2024-02 ...  [--out private/acq/ftc_data/dnc/month_counts.json]

The endpoint reports no usable total (its `record-total` member is not a number), so the count is found by binary search on
`offset` with items_per_page=1: the number of records is the first offset that returns an empty page. Each month is counted
for all records, for is_robocall=true and for is_robocall=false; records with no robocall answer are the difference.
A day count can be compared with the FTC's daily file for that day (validation); month counts are published only after
that comparison agrees for the days where both exist.
"""
import argparse
import calendar
import json
import os
import sys
import time
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ftc_http as fh  # noqa: E402

BASE = "https://api.ftc.gov/v0/dnc-complaints"
OUT = os.path.join(fh.ACQ, "dnc", "month_counts.json")
METHOD = "api.ftc.gov /v0/dnc-complaints counted by binary search on offset (items_per_page=1)"


def url(window, offset, robo=None):
    q = dict(window)
    q.update({"items_per_page": 1, "offset": offset})
    if robo is not None:
        q["is_robocall"] = "true" if robo else "false"
    return BASE + "?" + urllib.parse.urlencode(q)


def has_record(fetcher, window, offset, robo, stats):
    resp = fetcher.get(url(window, offset, robo))
    stats["requests"] += 1
    if resp.status != 200:
        raise fh.FetchError(f"HTTP {resp.status} at offset {offset}")
    data = json.loads(resp.body).get("data")
    return bool(data)


def count_window(fetcher, window, robo=None, stats=None):
    """Number of records for the window: exponential search for an upper bound, then bisection."""
    stats = stats if stats is not None else {"requests": 0}
    if not has_record(fetcher, window, 0, robo, stats):
        return 0
    hi = 1
    while has_record(fetcher, window, hi, robo, stats):
        hi *= 2
    lo = hi // 2  # a record exists at lo; none at hi
    while hi - lo > 1:
        mid = (lo + hi) // 2
        if has_record(fetcher, window, mid, robo, stats):
            lo = mid
        else:
            hi = mid
    return lo + 1


def day_window(day):
    return {"created_date": f'"{day}"'}


def month_window(month):
    y, m = int(month[:4]), int(month[5:7])
    last = calendar.monthrange(y, m)[1]
    return {"created_date_from": f'"{y:04d}-{m:02d}-01"', "created_date_to": f'"{y:04d}-{m:02d}-{last:02d}"'}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--day")
    ap.add_argument("--months", nargs="*")
    ap.add_argument("--out", default=OUT)
    args = ap.parse_args()
    fetcher = fh.Fetcher(interval_override={"api.ftc.gov": float(os.environ.get("FTC_API_INTERVAL", "2.0"))})
    if args.day:
        stats = {"requests": 0}
        n = count_window(fetcher, day_window(args.day), None, stats)
        print(json.dumps({"day": args.day, "records": n, "requests": stats["requests"]}))
    if args.months:
        done = {}
        if os.path.exists(args.out):
            done = json.load(open(args.out, encoding="utf-8")).get("months", {})
        for month in args.months:
            if month in done:
                continue
            t0 = time.time()
            stats = {"requests": 0}
            w = month_window(month)
            total = count_window(fetcher, w, None, stats)
            y = count_window(fetcher, w, True, stats)
            n = count_window(fetcher, w, False, stats)
            done[month] = {"total": total, "robo_y": y, "robo_n": n, "requests": stats["requests"], "seconds": round(time.time() - t0), "counted_at": fh.now_utc(), "method": METHOD}
            os.makedirs(os.path.dirname(args.out), exist_ok=True)
            with open(args.out, "w", encoding="utf-8") as handle:
                json.dump({"months": done}, handle, indent=1, sort_keys=True)
            print(month, json.dumps(done[month]), flush=True)


if __name__ == "__main__":
    main()
