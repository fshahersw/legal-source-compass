"""From a saved CourtListener `parties` endpoint result, list every party that carries an attachment for a given attorney id
on ANY docket, with the party types per docket. No DB or network access.
Usage: python cl_parties_attorney_any_docket.py <result.txt> <attorney_id>"""
import json
import sys

sys.stdout.reconfigure(encoding="utf-8")
path, attorney_id = sys.argv[1], int(sys.argv[2])
data = json.load(open(path, encoding="utf-8"))
for p in data["results"]:
    atts = [a for a in p.get("attorneys", []) if a.get("attorney_id") == attorney_id]
    if not atts:
        continue
    print("party", p["id"], "|", p.get("name"))
    print("  attachments (docket_id, role, date_action):", sorted({(a["docket_id"], a["role"], a["date_action"]) for a in atts}))
    print("  party types:", sorted({(t.get("docket_id"), t.get("name")) for t in p.get("party_types", [])}))
all_dockets = set()
for p in data["results"]:
    for a in p.get("attorneys", []):
        all_dockets.add(a["docket_id"])
    for t in p.get("party_types", []):
        all_dockets.add(t.get("docket_id"))
print("dockets referenced anywhere in result:", sorted(x for x in all_dockets if x))
