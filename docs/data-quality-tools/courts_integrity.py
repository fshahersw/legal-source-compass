"""Integrity checks for the court map (names, parent ids, dates, duplicates). Read-only over the exported JSONL."""
import difflib
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import date

import courts_db

sys.stdout.reconfigure(encoding="utf-8")
HERE = os.path.dirname(os.path.abspath(__file__))


def load(name):
    with open(os.path.join(HERE, name), encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


cmap = {r["court_id"]: r for r in load("court_map.jsonl")}
cl = {r["cells"]["native_id"]: r["cells"] for r in load("cl_courts.jsonl")}
cdb = {c["id"]: c for c in courts_db.courts}


def fact(r, prefix):
    for k, v in r["facts"]:
        if k.startswith(prefix):
            return v
    return None


# ---- names ----
susp = []
for cid, r in cmap.items():
    t = r["title"]
    why = []
    if t != t.strip():
        why.append("outer-space")
    if "  " in t:
        why.append("double-space")
    if re.search(r"(\bNo\.?|\bof|\bthe|\band|\bfor|\bat|\bin|,|-|–|\(|&)$", t):
        why.append("dangling-end")
    if t.count("(") != t.count(")"):
        why.append("paren")
    if re.search(r"\b(\w+)\s+\1\b", t, re.I):
        why.append("repeated-word")
    if t.islower() or t.isupper():
        why.append("single-case")
    if why:
        susp.append((cid, t, why))
print("suspicious titles:", len(susp))
for x in susp[:60]:
    print("  ", x)

# typos vs courts-db name (small edit distance but not equal)
typo = []
for cid, c in cdb.items():
    r = cmap.get(cid)
    if not r or cid not in cl:
        continue
    a = r["title"].strip().lower()
    b = c["name"].strip().lower()
    if a != b:
        ratio = difflib.SequenceMatcher(None, a, b).ratio()
        if ratio >= 0.93:
            typo.append((round(ratio, 3), cid, r["title"], c["name"]))
typo.sort(reverse=True)
print("map title vs courts-db name near-equal (>=0.93) but different:", len(typo))
for x in typo[:60]:
    print("  ", x)

# ---- parents ----
ids = set(cmap)
dangling = []
selfpar = []
for cid, r in cmap.items():
    p = r["parent_id"]
    if not p:
        continue
    if p == cid:
        selfpar.append(cid)
    if p not in ids:
        dangling.append((cid, p))
print("parent dangling:", len(dangling), dangling[:15], "self:", selfpar)
# cycles
cyc = []
for cid in cmap:
    seen = set()
    cur = cid
    while cur and cur in cmap and cmap[cur]["parent_id"]:
        if cur in seen:
            cyc.append(cid)
            break
        seen.add(cur)
        cur = cmap[cur]["parent_id"]
print("parent cycles:", len(cyc))
# parent fact vs parent id
pf = []
for cid, r in cmap.items():
    f = fact(r, "Parent court")
    p = r["parent_id"]
    if bool(f) != bool(p):
        pf.append((cid, p, f))
    elif f and p and f"({p})" not in f:
        pf.append((cid, p, f))
print("Parent fact vs parent_id mismatches:", len(pf), pf[:10])
# parent pseudo
print("parent_id values (top):", Counter(r["parent_id"] for r in cmap.values() if r["parent_id"]).most_common(12))
# parent in CL snapshot differs (should be 0, checked before) and parent title vs fact name
badname = []
for cid, r in cmap.items():
    f = fact(r, "Parent court")
    p = r["parent_id"]
    if f and p and p in cmap:
        nm = f.rsplit(" (", 1)[0]
        if nm != cmap[p]["title"]:
            badname.append((cid, f, cmap[p]["title"]))
print("Parent fact name != parent title:", len(badname), badname[:10])

# ---- dates ----
snap = date(2026, 9, 30)
bad = []
for cid, c in cl.items():
    s, e = c["start_date"], c["end_date"]
    for lab, v in (("start", s), ("end", e)):
        if v and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", v):
            bad.append((cid, lab, v))
    if s and e and re.fullmatch(r"\d{4}-\d{2}-\d{2}", s) and re.fullmatch(r"\d{4}-\d{2}-\d{2}", e) and e < s:
        bad.append((cid, "end<start", s, e))
    if e and re.fullmatch(r"\d{4}-\d{2}-\d{2}", e) and date.fromisoformat(e) > snap:
        bad.append((cid, "end>snapshot", e))
print("date problems:", len(bad), bad[:20])
iu_end = [(cid, c["end_date"], c["in_use"]) for cid, c in cl.items() if c["end_date"] and c["in_use"] == "t"]
print("CL in_use=t with end_date:", len(iu_end), iu_end[:40])
iu_noend_old = [(cid) for cid, c in cl.items() if c["in_use"] == "f" and not c["end_date"]]
print("CL in_use=f without end_date:", len(iu_noend_old))

# ---- duplicate titles among CL rows ----
by_title = defaultdict(list)
for cid in cl:
    by_title[cmap[cid]["title"].strip().lower()].append(cid)
dups = {t: v for t, v in by_title.items() if len(v) > 1}
print("duplicate titles among CL courts:", len(dups), "rows:", sum(len(v) for v in dups.values()))
for t, v in list(dups.items())[:25]:
    print("  ", t, v, [(cl[i]["in_use"], cl[i]["jurisdiction"], cl[i]["parent_court_id"]) for i in v])

# ---- county rows (non-CL) ----
cty = [r for cid, r in cmap.items() if cid not in cl]
print("non-CL rows:", len(cty), Counter(r["court_type"] for r in cty).most_common(12))
print("non-CL rows empty state:", sum(1 for r in cty if not r["state"]))
print("non-CL titles w/ dangling", sum(1 for r in cty if r["parent_id"] and r["parent_id"] not in cmap))

# duplicate titles within state among county rows
by = defaultdict(list)
for r in cty:
    by[(r["state"], r["title"].strip().lower())].append(r["court_id"])
d2 = {k: v for k, v in by.items() if len(v) > 1}
print("non-CL duplicate (state,title) groups:", len(d2), "rows", sum(len(v) for v in d2.values()))
print([(k, v) for k, v in list(d2.items())[:10]])
