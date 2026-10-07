#!/usr/bin/env python3
"""Re-fetch every landed Illinois act page and report which ones changed since the stored capture.

Input: stored_units.json, a list of the landed IL code-source-unit rows ({native_id, unit_key, url, original_sha256, ...}).
Every response is retained content-addressed with a receipt (common/provenance_fetch.py). Direct fetch with a browser
User-Agent and the AIA-completed TLS chain; an ILGA "Access Denied" page or a non-200 answer is retried, then fetched
fresh through Firecrawl (recorded as proxied). Output: <root>/sweep.json with unchanged / changed / failed unit keys.

    sweep.py --units stored_units.json --root /tmp/sc/IL2 [--workers 5]
"""
import argparse
import json
import pathlib
import sys
import time
from concurrent.futures import ThreadPoolExecutor

sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[1] / "common"))
from tls_chain import TlsFetcher  # noqa: E402

BROWSER_UA = "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36"
DENIED = b"Access Denied | Illinois General Assembly"


def blocked(fetcher, receipt):
    return not receipt.get("ok") or DENIED in fetcher.read(receipt)[:4000]


def fetch_one(fetcher, unit, attempts=3):
    receipt = None
    for attempt in range(attempts):
        receipt = fetcher.get(unit["url"], label="act:" + unit["unit_key"], force=attempt > 0)
        if not blocked(fetcher, receipt):
            return {"route": "direct", "receipt": receipt}
        time.sleep(5 * (attempt + 1))
    proxied = fetcher.proxied(unit["url"], service="firecrawl", label="act:" + unit["unit_key"], options={"maxAge": 0})
    return {"route": "firecrawl", "receipt": proxied, "direct": receipt}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--units", required=True)
    ap.add_argument("--root", required=True)
    ap.add_argument("--workers", type=int, default=5)
    a = ap.parse_args()
    units = json.load(open(a.units))
    fetcher = TlsFetcher("IL", a.root, aia_hosts=["www.ilga.gov"], min_interval=0.2, user_agent=BROWSER_UA, timeout=120)
    out = {"unchanged": [], "changed": [], "failed": [], "proxied": []}
    with ThreadPoolExecutor(a.workers) as ex:
        for n, (u, res) in enumerate(zip(units, ex.map(lambda u: fetch_one(fetcher, u), units)), 1):
            rec = res["receipt"]
            if res["route"] != "direct":
                out["proxied" if rec and rec.get("ok") else "failed"].append(u["unit_key"])
            elif rec["sha256"] == u["original_sha256"]:
                out["unchanged"].append(u["unit_key"])
            else:
                out["changed"].append(u["unit_key"])
            if n % 250 == 0:
                print(n, {k: len(v) for k, v in out.items()}, flush=True)
    out["finished_at"] = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    json.dump(out, open(pathlib.Path(a.root) / "sweep.json", "w"), indent=1)
    print(json.dumps({k: (len(v) if isinstance(v, list) else v) for k, v in out.items()}))


if __name__ == "__main__":
    main()
