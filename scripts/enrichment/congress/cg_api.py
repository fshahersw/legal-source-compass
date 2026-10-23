"""Congress.gov API v3 client for the members and committees stream (api.data.gov key from private secrets, X-Api-Key header only).

Same shape as the legislation stream's client (scripts/enrichment/legislation/congress_api.py): every response body is stored
gzip-compressed under private/acq/congress/ (the stored name never contains the key) and recorded in
private/acq/congress/_manifest.jsonl; a stored response is reused without a request, so re-runs are offline.

Pacing: one request start every INTERVAL seconds (1.25 s = 2,880 per hour, 58 percent of the documented 5,000 per hour per key);
429 responses back off (Retry-After honoured, by common.http_get). The X-RateLimit-Remaining header of every response is
watched: below LOW_WATER requests left in the hour window the client pauses for PAUSE seconds before the next request, so a key
shared with other work is never run dry. This stream has its own request budget (BUDGET) counted across processes in
private/acq/congress/_request_count.json.

  python3 -I -B cg_api.py /member limit=2          (probe; prints the first 4,000 characters)
"""
from __future__ import annotations

import gzip
import json
import re
import sys
import threading
import time
import urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
LEG = HERE.parent / "legislation"
sys.path.insert(0, str(LEG))
sys.path.append(str(HERE.parent / "court_rules"))
import common as lc  # noqa: E402  (legislation stream: polite http_get with per-host pacing and 429 backoff)

BASE = "https://api.congress.gov/v3"
ROOT = lc.ROOT
ACQ = ROOT / "private" / "acq" / "congress"
BUILD = ROOT / "private" / "build" / "congress"
MANIFEST = ACQ / "_manifest.jsonl"
COUNT = ACQ / "_request_count.json"
BUDGET = 16000
INTERVAL = 1.25
LOW_WATER = 1200
PAUSE = 300
METHOD = "Congress.gov API v3 (api.data.gov key in header)"
lc.INTERVAL["api.congress.gov"] = INTERVAL  # per-host start spacing used by common.http_get
_lock = threading.Lock()
_state = {"remaining": None, "last_start": 0.0}

now_utc = lc.now_utc


def record(entry: dict) -> None:
    lc.record(entry, MANIFEST)


def used() -> int:
    try:
        return int(json.loads(COUNT.read_text())["requests"])
    except (OSError, ValueError, KeyError):
        return 0


def _bump() -> int:
    with _lock:
        n = used()
        if n >= BUDGET:
            raise SystemExit(f"Congress.gov request budget of {BUDGET} reached")
        COUNT.parent.mkdir(parents=True, exist_ok=True)
        tmp = COUNT.with_suffix(".part")
        tmp.write_text(json.dumps({"requests": n + 1}))
        tmp.replace(COUNT)
        return n + 1


def stored_name(path: str, params: dict, tag: str | None = None) -> Path:
    """Stored response path; `tag` (e.g. a snapshot date) is added to the file name only, never sent to the API."""
    q = "&".join(f"{k}={v}" for k, v in sorted(params.items()) if k != "api_key")
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", path.strip("/")) + ("__" + re.sub(r"[^A-Za-z0-9._=-]+", "_", q) if q else "")
    if tag:
        name += "__at_" + re.sub(r"[^0-9A-Za-z-]+", "_", tag)
    return ACQ / (name + ".json.gz")


def keep_gz(url: str, body: bytes, dest: Path) -> dict:
    """Store a response body gzip-compressed (decompressing gives the exact bytes) and record it."""
    import hashlib
    import os

    dest.parent.mkdir(parents=True, exist_ok=True)
    tmp = dest.with_suffix(dest.suffix + ".part")
    tmp.write_bytes(gzip.compress(body, 6))
    os.replace(tmp, dest)
    entry = {"url": url, "path": str(dest.relative_to(ROOT)), "sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body),
             "retrieved_at": now_utc(), "http_status": 200, "method": METHOD + " (stored gzip-compressed)"}
    record(entry)
    return entry


def _guard_rate() -> None:
    """Pause when the key's hourly allowance (shared with other streams) is nearly used."""
    with _lock:
        rem = _state["remaining"]
    if rem is not None and rem < LOW_WATER:
        print(json.dumps({"rate_limit_pause_s": PAUSE, "remaining": rem}), flush=True)
        time.sleep(PAUSE)
        with _lock:
            _state["remaining"] = None  # re-learn from the next response


def cached(path: str, _tag: str | None = None, **params) -> dict | None | bool:
    """The stored response if present (dict), None for a stored 404, False when nothing is stored."""
    params = {"format": "json", **{k: str(v) for k, v in params.items()}}
    dest = stored_name(path, params, _tag)
    if dest.exists():
        return json.loads(gzip.decompress(dest.read_bytes()))
    if dest.with_suffix(".missing").exists():
        return None
    return False


def get(path: str, _tag: str | None = None, **params) -> dict | None:
    """GET {BASE}{path}?format=json&...; parsed JSON, or None on 404. Stored responses are reused; a refresh passes a new
    `_tag` so the new response is stored beside the earlier one."""
    hit = cached(path, _tag, **params)
    if hit is not False:
        return hit  # type: ignore[return-value]
    params = {"format": "json", **{k: str(v) for k, v in params.items()}}
    dest = stored_name(path, params, _tag)
    from secrets_env import load  # court_rules/secrets_env.py; the value stays in this process's environment

    key = load("DATA_GOV_API_KEY")
    url = f"{BASE}{path}?" + urllib.parse.urlencode(sorted(params.items()))
    _guard_rate()
    _bump()
    status, body, hdrs = lc.http_get(url, headers={"X-Api-Key": key, "Accept": "application/json"}, attempts=6)
    rem = {k.lower(): v for k, v in hdrs.items()}.get("x-ratelimit-remaining")
    if rem and rem.isdigit():
        with _lock:
            _state["remaining"] = int(rem)
    if status == 404:
        miss = dest.with_suffix(".missing")
        miss.parent.mkdir(parents=True, exist_ok=True)
        miss.write_text("404")
        record({"url": url, "path": None, "sha256": None, "bytes": 0, "retrieved_at": now_utc(), "http_status": 404, "method": METHOD})
        return None
    if status != 200:
        raise RuntimeError(f"Congress.gov {path} -> HTTP {status}")
    keep_gz(url, body, dest)
    return json.loads(body)


if __name__ == "__main__":
    params = dict(a.split("=", 1) for a in sys.argv[2:])
    print(json.dumps(get(sys.argv[1], **params), indent=1)[:4000])
    print("requests used:", used(), "rate remaining:", _state["remaining"])
