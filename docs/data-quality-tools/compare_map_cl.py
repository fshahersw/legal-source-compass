"""Compare corpus_workspace_court_map (built from the CourtListener 2026-06-30 bulk courts snapshot) against the
cl_courts dataset (CourtListener 2026-09-30 snapshot). Read-only; no DB access (works on the exported JSONL files)."""
import json
import os
import sys
from collections import Counter, defaultdict

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))


def load(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


cmap = {r["court_id"]: r for r in load("court_map.jsonl")}
cl = {r["cells"]["native_id"]: r["cells"] for r in load("cl_courts.jsonl")}
print("court_map", len(cmap), "cl_courts", len(cl), "map-only", len(set(cmap) - set(cl)), "cl-only", len(set(cl) - set(cmap)))

# which map rows have no CL row?
only_map = sorted(set(cmap) - set(cl))
print("map-only sample", only_map[:30])
print("map-only systems", Counter(cmap[c]["system"] for c in only_map))
print("map-only source", Counter(cmap[c]["source_dataset"] for c in only_map))
print("cl-only sample", sorted(set(cl) - set(cmap))[:30])


def fact(r, label_prefix):
    for k, v in r["facts"]:
        if k.startswith(label_prefix):
            return v
    return None


diffs = defaultdict(list)
for cid, r in cmap.items():
    c = cl.get(cid)
    if not c:
        continue
    name = fact(r, "Name")
    if name != c["full_name"]:
        diffs["name"].append((cid, name, c["full_name"]))
    if (fact(r, "Short name") or "") != (c["short_name"] if c["short_name"] != c["full_name"] else ""):
        diffs["short_name"].append((cid, fact(r, "Short name"), c["short_name"]))
    if (fact(r, "Citation string") or "") != (c["citation_string"] or ""):
        diffs["citation_string"].append((cid, fact(r, "Citation string"), c["citation_string"]))
    inuse = {"t": "yes", "f": "no"}.get(c["in_use"], c["in_use"])
    if r["in_use"] != inuse:
        diffs["in_use"].append((cid, r["in_use"], c["in_use"]))
    if (r["end_date"] or None) != (c["end_date"] or None):
        diffs["end_date"].append((cid, r["end_date"], c["end_date"]))
    est = fact(r, "Established")
    if (est or None) != (c["start_date"] or None):
        diffs["start_date"].append((cid, est, c["start_date"]))
    if (r["parent_id"] or None) != (c["parent_court_id"] or None):
        diffs["parent"].append((cid, r["parent_id"], c["parent_court_id"]))
    jur = c["jurisdiction"] or None
    ct = r["court_type"]
    if (ct if ct not in ("[]", "") else None) != jur:
        diffs["court_type"].append((cid, ct, jur))
    fjc = fact(r, "FJC court id")
    if (fjc or "") != (c["fjc_court_id"] or ""):
        diffs["fjc"].append((cid, fjc, c["fjc_court_id"]))
    pacer = fact(r, "PACER court id")
    if (pacer or "") != (c["pacer_court_id"] or ""):
        diffs["pacer"].append((cid, pacer, c["pacer_court_id"]))
for k, v in diffs.items():
    print(k, len(v), v[:8])

# date sanity
print("source_as_of cl:", Counter(c["source_as_of"] for c in cl.values()))
print("source_as_of map facts:", Counter(fact(r, "Source as of") for r in cmap.values()))
