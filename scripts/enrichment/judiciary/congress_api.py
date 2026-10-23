"""Congress.gov API v3 client (api.data.gov key from private secrets, sent only as the X-Api-Key header).

Every response is stored gzip-compressed under private/acq/judiciary/congress/ by fetchlib (the stored name never contains
the key) and counted in private/acq/judiciary/congress/_request_count.json so the stream's 15,000-request budget is
enforced across runs.
"""
from __future__ import annotations

import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
sys.path.append(str(HERE.parent / "court_rules"))
import fetchlib as fl  # noqa: E402
from secrets_env import load  # noqa: E402

import threading  # noqa: E402

_COUNT_LOCK = threading.Lock()
BASE = "https://api.congress.gov/v3"
BUDGET = 15000
COUNT = fl.ACQ / "congress" / "_request_count.json"


def _count() -> int:
    try:
        return int(json.loads(COUNT.read_text())["requests"])
    except (OSError, ValueError, KeyError):
        return 0


def get(path: str, **params) -> dict | None:
    """GET {BASE}{path}?format=json&...; returns parsed JSON, or None on 404."""
    query = "&".join(f"{k}={v}" for k, v in sorted({"format": "json", **params}.items()))
    url = f"{BASE}{path}?{query}"
    name = fl.safe_name(url)
    stored = fl.ACQ / "congress" / (name + ".gz")
    if not stored.exists() and not (fl.ACQ / "congress" / (name + ".missing")).exists():
        with _COUNT_LOCK:
            used = _count()
            if used >= BUDGET:
                raise SystemExit(f"api.data.gov budget of {BUDGET} requests reached")
            COUNT.parent.mkdir(parents=True, exist_ok=True)
            COUNT.write_text(json.dumps({"requests": used + 1}))
    key = load("DATA_GOV_API_KEY")
    status, body, _ = fl.fetch(url, "congress", headers={"X-Api-Key": key, "Accept": "application/json"},
                               method="Congress.gov API v3 (api.data.gov key in header)")
    if status != 200:
        return None
    return json.loads(body)


if __name__ == "__main__":
    # probe: python3 -I -B congress_api.py /nomination/118 limit=3
    params = dict(a.split("=", 1) for a in sys.argv[2:])
    print(json.dumps(get(sys.argv[1], **params), indent=1)[:6000])
