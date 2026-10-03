"""Cross-check corpus_workspace_court_map (CourtListener-sourced rows) against courts-db 0.10.27 (Free Law Project).
Read-only. Prints counts and writes results/courts_db_check.json with the row lists needed by the fix contracts."""
import json
import os
import re
import sys
from collections import Counter, defaultdict

import courts_db

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
os.makedirs(os.path.join(HERE, "results"), exist_ok=True)

STATES = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA", "Colorado": "CO",
    "Connecticut": "CT", "Delaware": "DE", "Florida": "FL", "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID",
    "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA",
    "Maine": "ME", "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN",
    "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC",
    "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR", "Pennsylvania": "PA",
    "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX",
    "Utah": "UT", "Vermont": "VT", "Virginia": "VA", "Washington": "WA", "West Virginia": "WV",
    "Wisconsin": "WI", "Wyoming": "WY", "District of Columbia": "DC", "Puerto Rico": "PR", "Guam": "GU",
    "Virgin Islands": "VI", "U.S. Virgin Islands": "VI", "Northern Mariana Islands": "MP", "American Samoa": "AS",
}


def load(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


cmap = {r["court_id"]: r for r in load("court_map.jsonl")}
cl = {r["cells"]["native_id"]: r["cells"] for r in load("cl_courts.jsonl")}
cdb = {c["id"]: c for c in courts_db.courts}
print("court_map", len(cmap), "cl", len(cl), "courts-db", len(cdb))

in_cdb = [c for c in cl if c in cdb]
print("CL ids found in courts-db:", len(in_cdb), "of", len(cl))
print("courts-db ids not in CL snapshot:", len(set(cdb) - set(cl)))

# 1. state: courts-db location vs map state
agree = disagree = 0
dis_rows = []
fill_rows = []
nofill = []
for cid, r in cmap.items():
    c = cdb.get(cid)
    loc = (c or {}).get("location")
    ab = STATES.get(loc) if loc else None
    if r["state"]:
        if ab:
            if ab == r["state"]:
                agree += 1
            else:
                disagree += 1
                dis_rows.append((cid, r["title"], r["state"], loc))
    else:
        if ab:
            fill_rows.append((cid, r["title"], r["system"], ab, loc))
        else:
            nofill.append((cid, r["title"], r["system"], loc))
print("state present in map and courts-db location mapped: agree", agree, "disagree", disagree)
print("disagreements:", dis_rows[:15])
print("empty-state rows fillable from courts-db location:", len(fill_rows), Counter(x[2] for x in fill_rows))
print("empty-state rows NOT fillable:", len(nofill), Counter(x[2] for x in nofill))

# 2. system, parent, in_use / dates
sysmap = {"federal": "federal", "state": "state", "tribal": "tribal"}
sys_dis = []
par_dis = []
for cid, r in cmap.items():
    c = cdb.get(cid)
    if not c or cid not in cl:
        continue
    if c.get("system") and c["system"] != r["system"] and not (c["system"] in ("", None)):
        sys_dis.append((cid, r["system"], c["system"]))
    cp = c.get("parent") or None
    mp = r["parent_id"] or None
    if cp != mp:
        par_dis.append((cid, mp, cp))
print("system disagreements map vs courts-db:", len(sys_dis), Counter((a, b) for _, a, b in sys_dis).most_common(10))
print("parent disagreements:", len(par_dis), par_dis[:10])


def cdb_dates(c):
    ds = c.get("dates") or []
    starts = [d.get("start") for d in ds if d.get("start")]
    ends = [d.get("end") for d in ds if d.get("end")]
    return (min(starts) if starts else None), (max(ends) if ends and all(d.get("end") for d in ds) else None)


end_dis = []
for cid, r in cmap.items():
    c = cdb.get(cid)
    if not c or cid not in cl:
        continue
    s, e = cdb_dates(c)
    mend = r["end_date"]
    mcl = cl[cid]
    if (e or None) != (mend or None):
        end_dis.append((cid, mend, e, r["in_use"]))
print("end_date disagreements map vs courts-db:", len(end_dis), Counter((x[1] is None, x[2] is None) for x in end_dis))

json.dump(
    {
        "fill_state": fill_rows,
        "state_disagree": dis_rows,
        "nofill": nofill,
        "sys_dis": sys_dis,
        "par_dis": par_dis,
        "end_dis": end_dis,
    },
    open(os.path.join(HERE, "results", "courts_db_check.json"), "w", encoding="utf-8"),
    ensure_ascii=False,
    indent=1,
)
