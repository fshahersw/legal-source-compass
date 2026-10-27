"""Snapshot, compare, publish or restore clb_judge_disclosures (release of 2026-10-27: redacted lines keep their published text,
unreadable report file names are listed with an 'attribution not checked' label, no reimbursement display cap).

    python3 -I -B publish_judge_disclosures.py snapshot <out.json.gz>   # live rows + catalog row, for rollback (read-only)
    python3 -I -B publish_judge_disclosures.py diff                     # new build vs live rows: counts only (read-only)
    python3 -I -B publish_judge_disclosures.py publish                  # corpus_writer.publish of private/build/courtlistener_rest/clb_judge_disclosures.json
    python3 -I -B publish_judge_disclosures.py restore <snapshot.json.gz>  # republish a snapshot exactly (rollback)

Credentials come only from EXTERNAL_SUPABASE_URL / EXTERNAL_SUPABASE_KEY in the environment (corpus_writer). Nothing is printed
but counts and digests. `publish` refuses a build whose ids differ from the live ids or that breaks the listing rule.
"""
from __future__ import annotations

import gzip
import json
import os
import sys
import urllib.request

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import rest_common as rc  # noqa: E402
import corpus_writer as writer  # noqa: E402

DATASET = "clb_judge_disclosures"
FULL = "dataset,id,category,state,county_geoids,title,source_url,item,detail,text,filters,ordinal"
KINDS = rc.DISCLOSURE_ITEM_KINDS


def catalog_row() -> dict:
    base, key = writer._base()
    req = urllib.request.Request(base + f"corpus_datasets?select=id,label,metadata&id=eq.{DATASET}", headers={"apikey": key, "Authorization": f"Bearer {key}"})
    with urllib.request.urlopen(req, timeout=120) as r:
        rows = json.loads(r.read().decode())
    if len(rows) != 1:
        raise SystemExit(f"{DATASET}: catalog row not found")
    return rows[0]


def tally(rows) -> dict:
    """Counts the release is checked by (the same fields the verification SELECTs read)."""
    out = {"records": len(rows), "withheld": {k: 0 for k in KINDS}, "listed": {k: 0 for k in KINDS}, "listed_redacted": 0, "listed_not_checked": 0,
           "withheld_other_surname": 0, "withheld_conflict": 0, "listed_from_mismatch_or_conflict": 0}
    for r in rows:
        p = r["item"]["profile"]
        checks = {x["id"]: x["file_check"] for x in p["report_list"]}
        conflict = p["attribution"]["status"] == "conflict"
        for k in KINDS:
            out["withheld"][k] += p["items_withheld"][k]
            out["listed"][k] += len(p[k])
            for it in p[k]:
                out["listed_redacted"] += bool(it.get("redacted"))
                out["listed_not_checked"] += it.get("attribution") == "not_checked"
                if conflict or checks.get(it["report_id"]) not in ("match", "unchecked"):
                    out["listed_from_mismatch_or_conflict"] += 1
        by = p.get("items_withheld_by_reason")
        if by:
            out["withheld_other_surname"] += sum(by["other_surname"].values())
            out["withheld_conflict"] += sum(by["attribution_conflict"].values())
    out["withheld_total"] = sum(out["withheld"].values())
    return out


def main(argv):
    if not argv:
        raise SystemExit(__doc__)
    cmd = argv[0]
    if cmd == "snapshot":
        rows = writer.fetch_all(DATASET, select=FULL)
        with gzip.open(argv[1], "wt", encoding="utf-8") as h:
            json.dump({"catalog": catalog_row(), "rows": rows}, h, ensure_ascii=False, sort_keys=True)
        print(json.dumps({"snapshot": argv[1], "records": len(rows), "tally": tally(rows)}))
    elif cmd == "diff":
        live = writer.fetch_all(DATASET)
        build = rc.read_build(DATASET)["rows"]
        print(json.dumps({"live": tally(live), "build": tally(build),
                          "ids_equal": sorted(r["id"] for r in live) == sorted(r["id"] for r in build)}, indent=1))
    elif cmd == "publish":
        spec = rc.read_build(DATASET)
        t = tally(spec["rows"])
        live_ids = sorted(r["id"] for r in writer.fetch_all(DATASET, select="id"))
        if sorted(r["id"] for r in spec["rows"]) != live_ids:
            raise SystemExit(f"{DATASET}: build ids differ from the live ids; not published")
        if t["listed_from_mismatch_or_conflict"]:
            raise SystemExit(f"{DATASET}: {t['listed_from_mismatch_or_conflict']} items listed from mismatch/conflict reports; not published")
        writer.publish(DATASET, spec["label"], spec["rows"], listing_block=spec["listing_block"], summary=spec["summary"])
        print(json.dumps({"published": DATASET, "tally": t}))
    elif cmd == "restore":
        with gzip.open(argv[1], "rt", encoding="utf-8") as h:
            snap = json.load(h)
        md = snap["catalog"]["metadata"]
        rows = sorted(snap["rows"], key=lambda r: r["ordinal"])  # publish re-numbers ordinals in this order
        for r in rows:
            r.pop("ordinal", None)
        writer.publish(DATASET, snap["catalog"]["label"], rows, listing_block={k: v for k, v in md["listing"].items() if k != "total"}, summary=md["summary"])
        print(json.dumps({"restored": DATASET, "records": len(snap["rows"])}))
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv[1:])
