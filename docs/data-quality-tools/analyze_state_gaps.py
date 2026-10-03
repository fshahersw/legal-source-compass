"""Which court_map rows have an empty state although the court name prints exactly one US state / territory name?
Read-only analysis over the exported JSONL files."""
import json
import os
import re
import sys
from collections import Counter, defaultdict

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))

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
    "Virgin Islands": "VI", "Northern Mariana Islands": "MP", "American Samoa": "AS",
}


def load(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


cmap = load("court_map.jsonl")
print("rows", len(cmap))
print("state empty", sum(1 for r in cmap if not r["state"]))
print("by system (empty state)", Counter(r["system"] for r in cmap if not r["state"]))
print("by system (all)", Counter(r["system"] for r in cmap))
print("court_type values", Counter(r["court_type"] for r in cmap).most_common(40))


def printed_states(name):
    found = {}
    for st, ab in STATES.items():
        if re.search(r"\b" + re.escape(st) + r"\b", name):
            found[st] = ab
    # drop states that are substrings of a longer printed state (Virginia in West Virginia, etc.)
    for st in list(found):
        for other in found:
            if other != st and st in other:
                found.pop(st, None)
                break
    return found


rows = []
for r in cmap:
    if r["state"]:
        continue
    name = r["title"]
    ps = printed_states(name)
    rows.append((r["court_id"], r["system"], r["court_type"], name, ps))
one = [x for x in rows if len(x[4]) == 1]
print("empty-state rows printing exactly one state:", len(one))
print("by system:", Counter(x[1] for x in one))
print("by court_type:", Counter(x[2] for x in one))
for x in one[:60]:
    print("  ", x[0], "|", x[1], "|", x[2], "|", x[3], "|", list(x[4].values()))
multi = [x for x in rows if len(x[4]) > 1]
print("empty-state rows printing >1 state:", len(multi), [(x[0], x[3]) for x in multi[:10]])
none = [x for x in rows if not x[4]]
print("empty-state rows printing no state:", len(none), Counter(x[1] for x in none))
print("samples", [(x[0], x[3]) for x in none[:25]])
