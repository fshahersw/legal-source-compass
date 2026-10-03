"""Find CL court names whose words differ from the courts-db name (or the court's own short_name) by a one-word misspelling.
Read-only."""
import difflib
import json
import os
import re
import sys

import courts_db

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))


def load(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


cl = {r["cells"]["native_id"]: r["cells"] for r in load("cl_courts.jsonl")}
cdb = {c["id"]: c for c in courts_db.courts}


def toks(s):
    s = s.replace("’", "'")
    return [t for t in re.split(r"[\s,;:()/]+", s.strip().rstrip(".")) if t]


def lev(a, b):
    if a == b:
        return 0
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


out = []
for cid, c in cl.items():
    name = c["full_name"].strip()
    other = []
    if cid in cdb:
        other.append(("courts-db", cdb[cid]["name"]))
    if c["short_name"] and c["short_name"].strip() != name:
        other.append(("short_name", c["short_name"].strip()))
    for src, o in other:
        a, b = toks(name), toks(o)
        if len(a) != len(b):
            continue
        diffs = [(x, y) for x, y in zip(a, b) if x != y]
        if len(diffs) == 1:
            x, y = diffs[0]
            if len(x) >= 5 and len(y) >= 5 and x.isalpha() and y.isalpha() and 0 < lev(x.lower(), y.lower()) <= 2:
                out.append((cid, src, name, o, x, y))
print(len(out))
for r in out:
    print(r)
