"""Build clb_court_appeals_to: CourtListener's court-appeals-to table (which court a court's appeals go to), all rows.

Source: court-appeals-to-2026-09-30.csv.bz2 (8 rows) and courts-2026-09-30.csv.bz2 for names, levels and the dates each
court's record gives. One record per row (id "edge:<row id>"), plus one record per court on either side listing its
edges ("court:<id>"). Courts link to /courts/<id> only when that exact id is in the court directory. Rows are shown as
recorded; the table is CourtListener's and covers only these courts (most appeal routes are not in it).
"""
from __future__ import annotations

import os
import sys
import time
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import clb1026_common as cm  # noqa: E402
import corpus_writer as writer  # noqa: E402

DATASET = "clb_court_appeals_to"
EDGES = "court-appeals-to-2026-09-30.csv.bz2"
COURTS = "courts-2026-09-30.csv.bz2"


def court_view(cid, courts, spine, leg):
    c = courts.get(cid)
    if not c:
        return {"court_id": cid, "name": None, "link": None, "level": None, "start": None, "end": None, "in_courts_table": False}
    return {"court_id": cid, "name": cm.blank(c["full_name"]), "link": cm.court_link(cid, spine), "level": cm.label(leg, "courts", "jurisdiction", c["jurisdiction"]),
            "start": cm.show_date(c["start_date"], None), "end": cm.show_date(c["end_date"], None), "in_courts_table": True}


def build() -> dict:
    leg = cm.legends()
    spine = cm.spine_ids()
    courts = {r["id"]: r for r in cm.pg_rows(cm.bulk_path(COURTS))}
    edges = [r for r in cm.pg_rows(cm.bulk_path(EDGES))]
    src = cm.BULK_BASE + EDGES
    rows = []
    by_court = defaultdict(lambda: {"appeals_to": [], "appeals_from": []})
    for e in sorted(edges, key=lambda e: int(e["id"])):
        f = court_view(e["from_court_id"], courts, spine, leg)
        t = court_view(e["to_court_id"], courts, spine, leg)
        by_court[f["court_id"]]["appeals_to"].append({"edge_id": int(e["id"]), **t})
        by_court[t["court_id"]]["appeals_from"].append({"edge_id": int(e["id"]), **f})
        span = lambda c: f"{c['start'] or 'start not recorded'} – {c['end'] or 'no end recorded'}"  # noqa: E731
        rows.append(writer.record(
            DATASET, f"edge:{e['id']}", f"{f['name'] or f['court_id']} → {t['name'] or t['court_id']}", source_url=src,
            subtitle=f"CourtListener court-appeals-to row {e['id']}",
            cells={"kind": "edge", "from": f["name"] or f["court_id"], "to": t["name"] or t["court_id"], "from_id": f["court_id"], "to_id": t["court_id"]},
            badges=["CourtListener bulk data", "As recorded"],
            facts=cm.facts([("From court (id)", f"{f['name']} ({f['court_id']})"), ("From court's recorded dates", span(f)),
                            ("Appeals go to (id)", f"{t['name']} ({t['court_id']})"), ("Destination court's recorded dates", span(t)),
                            ("Row id", e["id"])]),
            text=f"appeals to {f['court_id']} {t['court_id']} {f['name']} {t['name']}", filters={"kind": ["edge"]},
            links=[x for x in ({"label": f["name"], "url": f["link"]}, {"label": t["name"], "url": t["link"]}) if x["url"]],
            extra={"profile": {"edge_id": int(e["id"]), "from": f, "to": t}}))
    for cid, d in sorted(by_court.items()):
        c = court_view(cid, courts, spine, leg)
        rows.append(writer.record(
            DATASET, f"court:{cid}", f"{c['name'] or cid}: appeal routes in CourtListener's court-appeals-to table", source_url=src,
            subtitle="; ".join(x for x in (f"appeals go to {', '.join(a['name'] or a['court_id'] for a in d['appeals_to'])}" if d["appeals_to"] else None,
                                           f"appeals come from {len(d['appeals_from'])} court{'s' if len(d['appeals_from']) != 1 else ''}" if d["appeals_from"] else None) if x),
            cells={"kind": "court", "from": c["name"] or cid, "to": ", ".join(a["name"] or a["court_id"] for a in d["appeals_to"]) or None, "from_id": cid, "to_id": None},
            badges=["CourtListener bulk data", "As recorded"],
            facts=cm.facts([("Court (id)", f"{c['name']} ({cid})"), ("Recorded dates", f"{c['start'] or 'start not recorded'} – {c['end'] or 'no end recorded'}"),
                            ("Appeals go to", "; ".join(f"{a['name']} ({a['court_id']})" for a in d["appeals_to"]) or None),
                            ("Appeals come from", "; ".join(f"{a['name']} ({a['court_id']})" for a in d["appeals_from"]) or None)]),
            text=f"appeal routes {cid} {c['name']}", filters={"kind": ["court"]},
            links=[{"label": c["name"] or cid, "url": c["link"]}] if c["link"] else [],
            extra={"profile": {"court": c, **d}}))
    summary = {"source": "CourtListener bulk data: court-appeals-to and courts (Free Law Project), Sept 30, 2026", "snapshot": cm.SNAPSHOT, "terms": cm.TERMS,
               "totals": {"edges": len(edges), "courts": len(by_court)},
               "definitions": {"appeals to": "CourtListener's field help: 'Appellate courts for this court' (courts API, appeals_to)",
                               "recorded dates": "start and end dates of the court's record in CourtListener's courts table, as stored"},
               "caveats": ["The table holds only the rows CourtListener entered (8 in this snapshot); most courts' appeal routes are not in it.",
                           "Rows are shown as recorded. Row 5 (District Court, D. Montana to the Commerce Court) is CourtListener's entry; the courts table gives the Commerce Court's dates as 1910-01-01 to 1913-01-01."],
               "grain": "one record per row of the table and one per court on either side"}
    return {"dataset": DATASET, "label": "Appeal routes in CourtListener's court-appeals-to table (all 8 rows, Sept 30, 2026)",
            "listing_block": writer.listing([("kind", "Type"), ("from", "From court"), ("to", "Appeals go to")], [("kind", "Type", {"edge": "Row", "court": "Court"})]),
            "summary": summary, "rows": rows, "built_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "inputs": [cm.bulk_input(EDGES), cm.bulk_input(COURTS), {"url": leg["courts"]["_source"]["url"], "path": "OPTIONS legend", "sha256": leg["courts"]["_source"]["sha256"], "retrieved_at": leg["courts"]["_source"]["retrieved_at"]}]}


if __name__ == "__main__":
    cm.write_build(build())
