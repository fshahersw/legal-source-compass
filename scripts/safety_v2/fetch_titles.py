"""Snapshot the official MDL titles the product ↔ MDL map is checked against (read-only corpus GETs).

Sources (both already published from the JPML's own reports):
  mdls                    the JPML pending-MDL report title of every pending MDL (corpus record title, item.date_transferred)
  mdl_terminated_history  the caption printed in the JPML terminated-litigation reports (item.history.mdl, source_url)

Writes private/build/w1025_safety/mdl/titles.json {mdl: {title, dataset, source_url, date_transferred, status}} and its
sha256. Credentials: EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY from the environment (source private/scratch/env.sh
inside the single command); nothing is written to the corpus.

  python3 -I scripts/safety_v2/fetch_titles.py
"""
import json
import os
import sys
import urllib.request
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))
import common as c  # noqa: E402

PENDING_URL = "https://www.jpml.uscourts.gov/pending-mdl-reports-archive"


def get_all(path):
    url = os.environ["EXTERNAL_SUPABASE_URL"].rstrip("/") + "/rest/v1/" + path
    key = os.environ["EXTERNAL_SUPABASE_KEY"]
    rows, start = [], 0
    while True:
        req = urllib.request.Request(url, headers={"apikey": key, "Authorization": f"Bearer {key}", "Range": f"{start}-{start + 999}"})
        with urllib.request.urlopen(req, timeout=120) as r:
            chunk = json.loads(r.read().decode())
        rows.extend(chunk)
        if len(chunk) < 1000:
            return rows
        start += 1000


def snapshot(pending, terminated):
    """Pending titles win over terminated captions for the same MDL (the pending report prints the full title)."""
    out = {}
    for r in terminated:
        h = (r.get("item") or {}).get("history") or {}
        mdl = h.get("mdl")
        if not isinstance(mdl, int) or not r.get("title"):
            continue
        out[str(mdl)] = {"title": r["title"], "dataset": "mdl_terminated_history", "source_url": r.get("source_url") or PENDING_URL,
                         "termination_year": h.get("termination_year"), "status": "terminated"}
    for r in pending:
        item = r.get("item") or {}
        if not r.get("title") or not str(r.get("id", "")).isdigit():
            continue
        out[str(r["id"])] = {"title": r["title"], "dataset": "mdls", "source_url": r.get("source_url") or PENDING_URL,
                             "date_transferred": item.get("date_transferred"), "status": item.get("status"),
                             "litigation_type": item.get("litigation_type")}
    return dict(sorted(out.items(), key=lambda kv: int(kv[0])))


def main():
    pending = get_all("corpus_records?select=id,title,source_url,item&dataset=eq.mdls&order=id.asc")
    terminated = get_all("corpus_records?select=id,title,source_url,item&dataset=eq.mdl_terminated_history&order=id.asc")
    titles = snapshot(pending, terminated)
    outdir = c.BUILD / "mdl"
    outdir.mkdir(parents=True, exist_ok=True)
    data = json.dumps(titles, indent=1, sort_keys=True, ensure_ascii=False).encode()
    (outdir / "titles.json").write_bytes(data)
    print(json.dumps({"mdls": len(titles), "pending": len(pending), "terminated": len(terminated), "sha256": c.sha256_bytes(data)}))


if __name__ == "__main__":
    main()
