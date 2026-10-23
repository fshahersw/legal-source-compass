"""Congress.gov API v3 client for the legislation stream (api.data.gov key from private secrets, X-Api-Key header only).

Budget: at most 8,000 requests for this stream in total, paced to at most 3,000 per hour (one request per 1.25 s or
slower); 429 responses back off (Retry-After honoured). Every response body is stored gzip-compressed under
private/acq/legislation/congress/ (the stored name never contains the key) and recorded in _manifest.jsonl; a stored
response is reused without a request, so re-runs are offline. The running request count is kept in
private/acq/legislation/congress/_request_count.json and enforced across processes.

  python3 -I -B congress_api.py /crsreport limit=2       (probe; prints the first 4,000 characters)
"""
from __future__ import annotations

import json
import re
import sys
import threading
import urllib.parse
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.append(str(HERE.parent / "court_rules"))
import common as cm  # noqa: E402

BASE = "https://api.congress.gov/v3"
BUDGET = 8000
STORE = cm.ACQ / "congress"
COUNT = STORE / "_request_count.json"
_lock = threading.Lock()


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
        tmp.replace(COUNT)  # atomic, so a concurrent read never sees a partly written file
        return n + 1


def stored_name(path: str, params: dict, tag: str | None = None) -> Path:
    """Stored response path; `tag` (e.g. a snapshot date) is added to the file name only, never sent to the API."""
    q = "&".join(f"{k}={v}" for k, v in sorted(params.items()) if k != "api_key")
    name = re.sub(r"[^A-Za-z0-9._-]+", "_", path.strip("/")) + ("__" + re.sub(r"[^A-Za-z0-9._=-]+", "_", q) if q else "")
    if tag:
        name += "__at_" + re.sub(r"[^0-9A-Za-z-]+", "_", tag)
    return STORE / (name + ".json.gz")


def get(path: str, _tag: str | None = None, **params) -> dict | None:
    """GET {BASE}{path}?format=json&...; returns parsed JSON, or None on 404. Stored responses are reused; a refresh passes
    a new `_tag` so the new response is stored beside the earlier one."""
    params = {"format": "json", **{k: str(v) for k, v in params.items()}}
    dest = stored_name(path, params, _tag)
    if dest.exists():
        return json.loads(cm.gzip.decompress(dest.read_bytes()))
    missing = dest.with_suffix(".missing")
    if missing.exists():
        return None
    from secrets_env import load  # court_rules/secrets_env.py; the value stays in this process's environment

    key = load("DATA_GOV_API_KEY")
    url = f"{BASE}{path}?" + urllib.parse.urlencode(sorted(params.items()))
    _bump()
    status, body, _ = cm.http_get(url, headers={"X-Api-Key": key, "Accept": "application/json"}, attempts=6)
    if status == 404:
        missing.parent.mkdir(parents=True, exist_ok=True)
        missing.write_text("404")
        cm.record({"url": url, "path": None, "sha256": None, "bytes": 0, "retrieved_at": cm.now_utc(), "http_status": 404,
                   "method": "Congress.gov API v3 (api.data.gov key in header)"})
        return None
    if status != 200:
        raise RuntimeError(f"Congress.gov {path} -> HTTP {status}")
    cm.keep_gz(url, body, dest, method="Congress.gov API v3 (api.data.gov key in header)")
    return json.loads(body)


if __name__ == "__main__":
    params = dict(a.split("=", 1) for a in sys.argv[2:])
    print(json.dumps(get(sys.argv[1], **params), indent=1)[:4000])
    print("requests used:", used())
