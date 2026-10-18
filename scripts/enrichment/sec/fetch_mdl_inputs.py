"""Snapshot the MDL inputs this lane links against (datasets mdl_analytics and mdl_terminated_history).

Writes private/acq/sec-companies/mdl_inputs.json so later steps are reproducible offline.
"""
import json
import sys
from datetime import date
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent))
import corpus_writer as cw  # noqa: E402

ROOT = HERE.parents[2]
OUT = ROOT / "private" / "acq" / "sec-companies" / "mdl_inputs.json"


def main():
    analytics = cw.fetch_all("mdl_analytics", select="id,title,item")
    history = cw.fetch_all("mdl_terminated_history", select="id,title,item")
    mdls = []
    for row in analytics:
        a = (row.get("item") or {}).get("analytics")
        if not a or not isinstance(a.get("mdl"), int):
            continue
        mdls.append({
            "mdl": a["mdl"], "title": row["title"], "type": a.get("type"), "status": a.get("status"),
            "district": a.get("district"), "judge": a.get("judge"), "pending": a.get("pending"),
            "total": a.get("total"), "as_of": a.get("as_of"), "change_12m": a.get("change_12m"),
            "date_filed": a.get("date_filed"), "date_transferred": a.get("date_transferred"), "date_closed": a.get("date_closed"),
            "master_docket": a.get("master_docket"),
            "series": a.get("series") or [],
        })
    terminated = []
    for row in history:
        h = (row.get("item") or {}).get("history")
        if h and isinstance(h.get("mdl"), int):
            terminated.append(h)
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps({"retrieved": date.today().isoformat(), "mdls": mdls, "terminated": terminated}, indent=1))
    types = {}
    for m in mdls:
        types[(m["type"], m["status"])] = types.get((m["type"], m["status"]), 0) + 1
    print(len(mdls), "mdl rows;", len(terminated), "terminated rows")
    for k, v in sorted(types.items(), key=lambda kv: -kv[1]):
        print(k, v)


if __name__ == "__main__":
    main()
