"""Acquire openFDA count aggregates for the fda_adverse_events stream (FAERS, MAUDE, CAERS), raw bytes unchanged.

Usage: python3 -I -B scripts/enrichment/fda_adverse_events/fetch_fda_adverse_events.py [--retry-errors] [--dry-run]

Every response body is written unchanged to private/acq/fda_adverse_events/openfda/<key>.json and logged in
private/acq/fda_adverse_events/_manifest.jsonl (url, path, sha256, bytes, retrieved_at UTC, http status, method).
Runs are resumable: a key already on disk is not fetched again (with --retry-errors, keys whose stored status was
5xx/429/400 are refetched). openFDA without an API key allows 240 requests/minute and 1,000/day per IP, so the
fetcher keeps to <= 2 requests/second and stops at the first repeated 429. Only count= aggregates are requested:
no case-level report is stored.
"""
import hashlib
import json
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fae_common as fc  # noqa: E402

ROOT = HERE.parents[2]
ACQ = ROOT / "private" / "acq" / "fda_adverse_events"
RAW = ACQ / "openfda"
MANIFEST = ACQ / "_manifest.jsonl"
# Snapshot of scripts/enrichment/mass_tort_products.json (sha256 recorded in the build inputs), so the plan and the
# builder read the same product list even if the tracked file changes later.
PRODUCTS = ROOT / "private" / "build" / "fda_adverse_events" / "lookups" / "mass_tort_products.json"
METHOD = "direct HTTPS GET, openFDA API without key (count aggregate)"
PAUSE = 0.6  # seconds between requests (<= 2 req/s)


class DailyLimit(Exception):
    pass


def manifest_index():
    out = {}
    if MANIFEST.exists():
        for line in MANIFEST.read_text().splitlines():
            if line.strip():
                rec = json.loads(line)
                out[rec["path"]] = rec
    return out


def get(url):
    req = urllib.request.Request(url, headers={"User-Agent": fc.USER_AGENT, "Accept": "application/json"})
    rate_waits = 0
    for attempt in range(4):
        try:
            with urllib.request.urlopen(req, timeout=120) as resp:
                return resp.status, resp.read()
        except urllib.error.HTTPError as err:
            body = err.read()
            if err.code == 429:
                rate_waits += 1
                if rate_waits >= 2:
                    raise DailyLimit(url) from None
                time.sleep(65)
                continue
            if err.code >= 500 and attempt < 2:
                time.sleep(5 * (attempt + 1) ** 2)
                continue
            return err.code, body
        except urllib.error.URLError:
            if attempt < 3:
                time.sleep(5 * (attempt + 1))
                continue
            raise
    raise RuntimeError(f"no response for {url}")


def fetch(specs, known, retry_errors, dry_run):
    done = skipped = 0
    for s in specs:
        path = RAW / f"{s['key']}.json"
        rel = str(path.relative_to(ROOT))
        prev = known.get(rel)
        if path.exists() and prev and prev["url"] == s["url"]:
            if not (retry_errors and prev["status"] not in (200, 404)):
                skipped += 1
                continue
        if dry_run:
            print("would fetch", s["key"], s["url"])
            continue
        status, body = get(s["url"])
        path.write_bytes(body)
        rec = {"url": s["url"], "path": rel, "sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body),
               "retrieved_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "status": status,
               "method": METHOD, "key": s["key"], "purpose": s["purpose"]}
        with MANIFEST.open("a") as fh:
            fh.write(json.dumps(rec) + "\n")
        known[rel] = rec
        done += 1
        print(f"{status} {s['key']}", flush=True)
        time.sleep(PAUSE)
    return done, skipped


def load_json(key):
    path = RAW / f"{key}.json"
    return json.loads(path.read_bytes()) if path.exists() else None


def main():
    retry_errors = "--retry-errors" in sys.argv
    dry_run = "--dry-run" in sys.argv
    RAW.mkdir(parents=True, exist_ok=True)
    products = json.loads(PRODUCTS.read_text())["mdls"]
    known = manifest_index()
    try:
        d1, s1 = fetch(fc.phase1_specs(products), known, retry_errors, dry_run)
        ind = load_json("caers_nat_industry")
        brand = load_json("caers_nat_brand")
        if ind is None or brand is None:
            print("phase 2 waits for the CAERS national rankings")
            return
        industries, brands = fc.choose_caers_ranked(fc.term_counts(ind.get("results", [])), fc.term_counts(brand.get("results", [])))
        d2, s2 = fetch(fc.caers_ranked_specs(industries, brands), known, retry_errors, dry_run)
    except DailyLimit as exc:
        print(f"STOPPED: openFDA rate limit (429 twice) at {exc}; rerun later to resume", flush=True)
        sys.exit(2)
    print(json.dumps({"fetched": d1 + d2, "already_on_disk": s1 + s2}))


if __name__ == "__main__":
    main()
