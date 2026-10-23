"""Save the read-only corpus lookups the legislation builders join against (no writes anywhere).

  python3 -I -B fetch_lookups.py

public_laws_enacted (owned by the US Code stream): every record of the 108th Congress or later with its id and the public
law number GovInfo printed (detail.law.public_law {congress, number}) and its pl_shared flag, saved to
private/build/legislation/lookups/public_laws_enacted.json. A bill's law number links there only on an exact match of
Congress and number to exactly one record whose number is not shared. Credentials are read from private/scratch/env.sh into
this process only (as scripts/enrichment/judiciary/run_publish.py does); nothing is printed, written or logged from them.
"""
from __future__ import annotations

import json
import os
import sys
import urllib.parse
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as cm  # noqa: E402

ENV = cm.ROOT / "private" / "scratch" / "env.sh"
OUT = cm.BUILD / "lookups"


def load_env() -> None:
    for line in ENV.read_text().splitlines():
        line = line.strip()
        if line.startswith("export "):
            line = line[7:].strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        k, _, v = line.partition("=")
        if k.strip() in ("EXTERNAL_SUPABASE_URL", "EXTERNAL_SUPABASE_KEY") and not os.environ.get(k.strip()):
            os.environ[k.strip()] = v.strip().strip('"').strip("'")


def rest(path: str, start: int, page: int) -> list:
    base = os.environ["EXTERNAL_SUPABASE_URL"].rstrip("/") + "/rest/v1/"
    key = os.environ["EXTERNAL_SUPABASE_KEY"]
    h = {"apikey": key, "Range": f"{start}-{start + page - 1}", "Accept": "application/json"}
    if not key.startswith("sb_"):
        h["Authorization"] = "Bearer " + key
    with urllib.request.urlopen(urllib.request.Request(base + path, headers=h), timeout=180) as r:
        return json.loads(r.read())


def public_laws() -> dict:
    rows, start, page = [], 0, 1000
    sel = "select=id,title,pl:detail->law->public_law,shared:detail->law->pl_shared,kind:detail->law->kind,enacted:detail->law->enacted"
    while True:
        chunk = rest(f"corpus_records?{sel}&dataset=eq.public_laws_enacted&order=id.asc", start, page)
        rows.extend(chunk)
        if len(chunk) < page:
            break
        start += page
    by_key: dict[str, list] = {}
    for r in rows:
        pl = r.get("pl") or {}
        c, n = pl.get("congress"), pl.get("number")
        if isinstance(c, int) and isinstance(n, int) and c >= 108:
            by_key.setdefault(f"{c}-{n}", []).append({"id": r["id"], "shared": bool(r.get("shared")), "kind": r.get("kind"),
                                                       "enacted": r.get("enacted"), "title": r.get("title")})
    return {"dataset": "public_laws_enacted", "records_read": len(rows), "keys_108_plus": len(by_key), "by_key": by_key,
            "fetched_at": cm.now_utc()}


def main() -> None:
    load_env()
    OUT.mkdir(parents=True, exist_ok=True)
    pl = public_laws()
    (OUT / "public_laws_enacted.json").write_text(json.dumps(pl, sort_keys=True))
    print(json.dumps({k: pl[k] for k in ("records_read", "keys_108_plus")}))


if __name__ == "__main__":
    main()
