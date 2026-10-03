"""Evidence for the CourtListener attorney role codes: in a saved `parties` endpoint result, count (role code, has date_action).
A termination-type role carries a date_action; pro hac vice does not. No DB or network access.
Usage: python cl_role_code_evidence.py <result.txt>"""
import json
import sys
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8")
data = json.load(open(sys.argv[1], encoding="utf-8"))
c = Counter()
ex = {}
for p in data["results"]:
    for a in p.get("attorneys", []):
        key = (a["role"], a["date_action"] is not None)
        c[key] += 1
        ex.setdefault(key, (a["attorney_id"], a["docket_id"], a["date_action"]))
for k in sorted(c):
    print("role", k[0], "| has date_action:", k[1], "| attachments:", c[k], "| example (attorney, docket, date):", ex[k])
