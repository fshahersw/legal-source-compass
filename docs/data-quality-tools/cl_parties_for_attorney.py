"""Read a saved CourtListener `parties` endpoint result (JSON text saved by the MCP tool) and report, for one docket,
which parties a given attorney id is attached to and the party types on that docket. No DB or network access.
Usage: python cl_parties_for_attorney.py <result.txt> <docket_id> <attorney_id>"""
import json
import sys

sys.stdout.reconfigure(encoding="utf-8")
path, docket_id, attorney_id = sys.argv[1], int(sys.argv[2]), int(sys.argv[3])
raw = open(path, encoding="utf-8").read()
data = json.loads(raw)
rows = data["results"]
print("parties in result:", len(rows))
hits = 0
for p in rows:
    atts = [a for a in p.get("attorneys", []) if a.get("attorney_id") == attorney_id and a.get("docket_id") == docket_id]
    if not atts:
        continue
    hits += 1
    types = [t.get("name") for t in p.get("party_types", []) if t.get("docket_id") == docket_id]
    print("party", p["id"], "| name:", p.get("name"), "| party types on this docket:", types, "| attorney links:", [(a.get("role"), a.get("date_action")) for a in atts])
print("parties with the attorney on this docket:", hits)
# overall distribution of party type names on this docket, to see what the docket looks like
from collections import Counter
c = Counter()
for p in rows:
    for t in p.get("party_types", []):
        if t.get("docket_id") == docket_id:
            c[t.get("name")] += 1
print("party type names on docket:", dict(c))
