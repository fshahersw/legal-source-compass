"""Emit the SQL VALUES list for the approved state fill (223 suppressed state-court rows with two agreeing signals).
Reads results/state_fill_proposal.json (written by state_fill_proposal.py) and court_map.jsonl; recomputes the id-prefix evidence. No DB access."""
import json
import os
import re
import sys
from collections import Counter

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))
d = json.load(open(os.path.join(HERE, "results", "state_fill_proposal.json"), encoding="utf-8"))
rows = [json.loads(l) for l in open(os.path.join(HERE, "court_map.jsonl"), encoding="utf-8") if l.strip()]
byid = {r["court_id"]: r for r in rows}

pref = {}
for r in rows:
    if r["state"] and r["system"] == "state":
        for n in (2, 3, 4):
            pref.setdefault(r["court_id"][:n], Counter())[r["state"]] += 1

out = []
for cid, title, code, sig in d["fill"]:
    prefix = ""
    if sig == "id_prefix_agrees":
        for n in (4, 3, 2):
            c = pref.get(cid[:n])
            if c and sum(c.values()) >= 5:
                prefix = cid[:n]
                break
        assert prefix, cid
        c = pref[prefix]
        assert len(c) == 1 and next(iter(c)) == code, (cid, c)
    kind = "courts_db" if sig == "courts_db_location_agrees" else "id_prefix"
    out.append((cid, code, kind, prefix))
out.sort()
assert len(out) == 223, len(out)
print("-- generated: %d rows (%d courts_db, %d id_prefix)" % (len(out), sum(1 for o in out if o[2] == "courts_db"), sum(1 for o in out if o[2] == "id_prefix")))
lines = ["(%s,%s,%s,%s)" % tuple("'" + x.replace("'", "''") + "'" for x in o) for o in out]
text = ",\n    ".join(lines)
open(os.path.join(HERE, "results", "state_fill_values.sql.txt"), "w", encoding="utf-8").write(text)
print(Counter(o[3] for o in out if o[3]))
print(text[:600])
