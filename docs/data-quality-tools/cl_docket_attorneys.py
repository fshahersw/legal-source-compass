"""From a saved CourtListener `parties` endpoint result (filtered by docket), list attorney ids attached on one docket,
with the party name and party type on that docket. No DB or network access.
Usage: python cl_docket_attorneys.py <result.txt> <docket_id>"""
import json
import sys
from collections import defaultdict

sys.stdout.reconfigure(encoding="utf-8")
path, docket_id = sys.argv[1], int(sys.argv[2])
data = json.load(open(path, encoding="utf-8"))
by_att = defaultdict(set)
for p in data["results"]:
    types = sorted({t.get("name") for t in p.get("party_types", []) if t.get("docket_id") == docket_id})
    for a in p.get("attorneys", []):
        if a.get("docket_id") == docket_id:
            by_att[a["attorney_id"]].add((p.get("name"), tuple(types), a.get("role")))
print("attorneys attached on docket", docket_id, ":", len(by_att))
for att, v in sorted(by_att.items()):
    print(att, sorted(v))
