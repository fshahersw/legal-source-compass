"""Independent checks of the recall_patterns build against the raw extracts (the builder's event and grouping code is not used).

- Overview: FDA recall counts equal the distinct openFDA event ids (CPSC recall numbers, NHTSA campaigns) in the extracts.
- Themes: for 4 themes per FDA domain the recall count is recounted by applying that theme's rule to each event's raw reason texts.
- Firms: each FDA firm record's recall count is recounted from the raw rows by the same name key.
- Clusters: every member event exists, is by the stated firm, and its raw reason/product text matches the cluster's hazard rule and
  commodity term; members began within 90 days of the first; at least three distinct firms.
- Suppliers: the supplier name as written appears verbatim in each member's raw reason (FDA) or defect text (NHTSA), and the
  recalling firm differs from the supplier.
- Anomalies: the flagged month's count is recomputed and meets the stated thresholds against the trailing 24 months.
Writes private/build/recall_patterns/verification.json.

    python3 -I -B scripts/enrichment/recall_patterns/verify_recall_patterns.py
"""
import json
import os
import re
import statistics
import sys
from collections import Counter, defaultdict
from datetime import date

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import recall_lib as lib  # noqa: E402  (theme rules and name key are definitions shared with the builder)

LOOK = os.path.join(ROOT, "private", "build", "recall_patterns", "lookups")
spec = json.load(open(os.path.join(ROOT, "private", "build", "recall_patterns", "recall_patterns.json")))
rows = [r["item"]["profile"] | {"_id": r["id"]} for r in spec["rows"]]
failures, checked = [], Counter()


def fail(rid, what):
    failures.append({"id": rid, "check": what})


def jl(name):
    return [json.loads(line) for line in open(os.path.join(LOOK, f"{name}.jsonl"))]


raw = {}
for dom in ("fda_drug", "fda_device", "fda_food"):
    events = defaultdict(list)
    for row in jl(dom):
        f = row["f"]
        events[str(f.get("event_id") or f.get("recall_number") or row["id"])].append(f)
    raw[dom] = events
cpsc_ids = {str((row.get("r") or {}).get("recall_number") or row["id"]) for row in jl("cpsc")}
nhtsa = {str(((row.get("i") or {}).get("recall") or {}).get("campaign") or row["id"]): row for row in jl("nhtsa")}
by = defaultdict(list)
for p in rows:
    by[(p["domain"], p["kind"])].append(p)

# overview counts
expected = {"fda_drug": len(raw["fda_drug"]), "fda_device": len(raw["fda_device"]), "fda_food": len(raw["fda_food"]), "cpsc": len(cpsc_ids), "nhtsa": len(nhtsa)}
for dom, n in expected.items():
    ov = by[(dom, "overview")]
    checked["overview"] += 1
    if len(ov) != 1 or ov[0]["events"] != n:
        fail(f"{dom}:overview", f"events {ov[0]['events'] if ov else None} != {n}")

# theme recounts
for dom in ("fda_drug", "fda_device", "fda_food"):
    rules = {tid: rx for tid, _l, rx in lib.THEMES[dom]}
    themes = sorted(by[(dom, "theme")], key=lambda p: -p["events"])[:4]
    for p in themes:
        checked["theme"] += 1
        rx = re.compile(rules[p["theme"]], re.I)
        n = sum(1 for rs in raw[dom].values() if rx.search(" ".join(sorted({(r.get("reason_for_recall") or "").strip() for r in rs}))))
        if n != p["events"]:
            fail(p["_id"], f"theme count {p['events']} != {n}")

# firm recounts (FDA)
for dom in ("fda_drug", "fda_device", "fda_food"):
    firm_events = Counter()
    for rs in raw[dom].values():
        name = next((r.get("recalling_firm") for r in rs if r.get("recalling_firm")), None) or "Not recorded"
        firm_events[lib.firm_key(name) or name.lower()] += 1
    for p in by[(dom, "firm")]:
        checked["firm"] += 1
        if firm_events.get(p["firm_key"]) != p["events"]:
            fail(p["_id"], f"firm events {p['events']} != {firm_events.get(p['firm_key'])}")

# clusters
rule_food = {tid: re.compile(rx, re.I) for tid, _l, rx in lib.THEMES["fda_food"]}
for p in by[("fda_food", "cluster")]:
    checked["cluster"] += 1
    firms = set()
    start0 = date.fromisoformat(p["start"])
    for m in p["members"]:
        rs = raw["fda_food"].get(m["id"])
        if not rs:
            fail(p["_id"], f"member {m['id']} missing")
            continue
        reason = " ".join(sorted({(r.get("reason_for_recall") or "").strip() for r in rs}))
        text = (reason + " " + " ".join(r.get("product_description") or "" for r in rs)).lower()
        firms.add(lib.firm_key(m["firm"]))
        if not rule_food[p["theme"]].search(reason):
            fail(p["_id"], f"member {m['id']} reason lacks theme {p['theme']}")
        if not re.search(lib.commodity_pattern(p["commodity"]), text):
            fail(p["_id"], f"member {m['id']} lacks commodity {p['commodity']}")
        if m["start"] and (date.fromisoformat(m["start"]) - start0).days > 90:
            fail(p["_id"], f"member {m['id']} outside 90 days")
    if p["members_total"] == len(p["members"]) and len(firms) < 3:
        fail(p["_id"], "fewer than three firms")

# suppliers
for p in [x for x in rows if x["kind"] == "supplier"]:
    checked["supplier"] += 1
    for m in p["members"]:
        dom = next(k for k, v in {"fda_drug": "FDA drugs", "fda_device": "FDA medical devices", "fda_food": "FDA foods, supplements and cosmetics",
                                  "nhtsa": "NHTSA vehicles and equipment", "cpsc": "CPSC consumer products"}.items() if v == m["domain"])
        if dom == "nhtsa":
            text = ((nhtsa[m["id"]]["i"].get("recall") or {}).get("defect")) or ""
        else:
            text = " ".join((r.get("reason_for_recall") or "") for r in raw[dom].get(m["id"], []))
        if not any(s in re.sub(r"\s+", " ", text) for s in p["spellings"]):
            fail(p["_id"], f"supplier not written in {m['id']}")
        if lib.firm_key(m["firm"]) == lib.firm_key(p["supplier"]):
            fail(p["_id"], f"supplier equals recalling firm in {m['id']}")

# anomalies (recall-count measure for FDA)
for dom in ("fda_drug", "fda_device", "fda_food"):
    series = Counter()
    for rs in raw[dom].values():
        reports = sorted(r.get("report_date") for r in rs if isinstance(r.get("report_date"), str) and re.match(r"^\d{4}-\d{2}-\d{2}$", r.get("report_date")))
        if reports:
            series[reports[0][:7]] += 1
    months = lib.month_range(min(series), max(series))
    ov = by[(dom, "overview")][0]
    for a in ov["anomalies"]:
        if a["measure"] != "recalls":
            continue
        checked["anomaly"] += 1
        i = months.index(a["month"])
        past = [series.get(m, 0) for m in months[i - 24:i]]
        med = statistics.median(past)
        x = series.get(a["month"], 0)
        if x != a["count"] or med != a["trailing_median"] or x < 1.8 * max(med, 1):
            fail(f"{dom}:{a['month']}", f"anomaly recount {x}/{med} vs {a['count']}/{a['trailing_median']}")

summary = {"records": len(rows), "checked": dict(checked), "failures": len(failures), "examples": failures[:25]}
with open(os.path.join(ROOT, "private", "build", "recall_patterns", "verification.json"), "w") as h:
    json.dump(summary, h, indent=1)
print(json.dumps(summary)[:1500])
raise SystemExit(1 if failures else 0)
