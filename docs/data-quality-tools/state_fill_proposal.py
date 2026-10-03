"""Sizing of the PROPOSED (not applied) state fill for court_map rows whose name prints exactly one state name but whose State is empty by design
(the directory's State column is labelled "State (only where explicit)" and the builder suppresses a printed state name that is followed by County/City).
Reads the exported JSONL (court_map.jsonl is the pre-round-3 export; only ohctapp1 changed state since). Read-only."""
import json
import os
import re
import sys
from collections import Counter

import courts_db

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
STATES = {
    "Alabama": "AL", "Alaska": "AK", "Arizona": "AZ", "Arkansas": "AR", "California": "CA", "Colorado": "CO", "Connecticut": "CT", "Delaware": "DE", "Florida": "FL",
    "Georgia": "GA", "Hawaii": "HI", "Idaho": "ID", "Illinois": "IL", "Indiana": "IN", "Iowa": "IA", "Kansas": "KS", "Kentucky": "KY", "Louisiana": "LA", "Maine": "ME",
    "Maryland": "MD", "Massachusetts": "MA", "Michigan": "MI", "Minnesota": "MN", "Mississippi": "MS", "Missouri": "MO", "Montana": "MT", "Nebraska": "NE", "Nevada": "NV",
    "New Hampshire": "NH", "New Jersey": "NJ", "New Mexico": "NM", "New York": "NY", "North Carolina": "NC", "North Dakota": "ND", "Ohio": "OH", "Oklahoma": "OK", "Oregon": "OR",
    "Pennsylvania": "PA", "Rhode Island": "RI", "South Carolina": "SC", "South Dakota": "SD", "Tennessee": "TN", "Texas": "TX", "Utah": "UT", "Vermont": "VT", "Virginia": "VA",
    "Washington": "WA", "West Virginia": "WV", "Wisconsin": "WI", "Wyoming": "WY", "District of Columbia": "DC", "Puerto Rico": "PR", "Guam": "GU",
    "Virgin Islands": "VI", "Northern Mariana Islands": "MP", "American Samoa": "AS",
}


def printed(name):
    found = {s: a for s, a in STATES.items() if re.search(r"\b" + re.escape(s) + r"\b", name)}
    for s in list(found):
        if any(o != s and s in o for o in found):
            found.pop(s, None)
    return found


rows = [json.loads(l) for l in open(os.path.join(HERE, "court_map.jsonl"), encoding="utf-8") if l.strip()]
cdb = {c["id"]: c for c in courts_db.courts}
known = {r["court_id"]: r for r in rows}

# id prefix purity learned from rows that already have a state (system state only)
pref = {}
for r in rows:
    if r["state"] and r["system"] == "state":
        m = re.match(r"([a-z]+?)(?=(ct|app|dist|cir|sup|juv|orph|pro|just|mun|cty|cc|cl|fam|dom|prob|small|city|town|vill|mag|tax|land|ind|work|labor)|$)", r["court_id"])
        for n in (2, 3, 4):
            p = r["court_id"][:n]
            pref.setdefault(p, Counter())[r["state"]] += 1

sel = [r for r in rows if not r["state"] and r["system"] == "state" and len(printed(r["title"])) == 1]
print("state-system, empty state, exactly one printed state:", len(sel))
cat = Counter()
fill = []
conflict = []
for r in sel:
    ps = list(printed(r["title"]).values())[0]
    loc = cdb.get(r["court_id"], {}).get("location")
    loc_ab = STATES.get(loc) if loc else None
    # strongest independent signal available
    if loc_ab:
        sig = "courts_db_location_agrees" if loc_ab == ps else "courts_db_location_DISAGREES"
    else:
        # id prefix purity (2..4 chars) among rows that already have a state
        best = None
        for n in (4, 3, 2):
            c = pref.get(r["court_id"][:n])
            if c and sum(c.values()) >= 5:
                best = (n, c.most_common(1)[0][0], c.most_common(1)[0][1] / sum(c.values()))
                break
        if best and best[2] == 1.0 and best[1] == ps:
            sig = "id_prefix_agrees"
        elif best and best[1] != ps:
            sig = "id_prefix_DISAGREES"
        else:
            sig = "no_independent_signal"
    cat[sig] += 1
    (fill if sig in ("courts_db_location_agrees", "id_prefix_agrees") else conflict).append((r["court_id"], r["title"], ps, sig))
print(cat)
print("fillable (two agreeing signals):", len(fill), "| not fillable:", len(conflict))
print("by parent among fillable:", Counter(next((x["parent_id"] for x in rows if x["court_id"] == c[0]), None) for c in fill).most_common(6))
print("not fillable:", [(c[0], c[1], c[2], c[3]) for c in conflict])
json.dump({"fill": fill, "conflict": conflict}, open(os.path.join(HERE, "results", "state_fill_proposal.json"), "w", encoding="utf-8"), ensure_ascii=False, indent=1)
