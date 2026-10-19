"""Independent verification of judge_cl_crosswalk, written separately from the builder.

Re-derives each linked record from the CourtListener slim tables with plain SQL and a different, simpler name normaliser (letters and digits
only, honorific and suffix words dropped), and checks:
  - T1 exact_id: the CourtListener person's fjc_id equals the FJC jid carried by the directory record (contradictions must be 0)
  - T2: the person has a judicial position at one of the record's resolved courts and is the only person with that name there
  - T3: the person has a judicial position in the record's state and is the only person with that name in that state
  - every linked person id exists; no person is linked to two records with different names
Writes private/build/judge_xwalk/verification.json.

    python3 -I -B scripts/enrichment/judge_xwalk/verify_judge_xwalk.py
"""
from __future__ import annotations

import json
import os
import re
import sys
from collections import defaultdict

ROOT = "/home/user/legal-source-compass"
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))
import duckdb  # noqa: E402

BUILD = os.path.join(ROOT, "private", "build", "judge_xwalk")
DROP = {"judge", "justice", "hon", "honorable", "the", "chief", "jr", "sr", "ii", "iii", "iv", "junior", "senior", "associate", "magistrate",
        "presiding", "president", "retired", "acting", "emeritus", "emerita", "ret"}


def alnum(*parts) -> str:
    words = []
    for p in parts:
        for w in re.findall(r"[a-z0-9]+", (p or "").lower()):
            if w not in DROP:
                words.append(w)
    return " ".join(words)


def main() -> int:
    spec = json.load(open(os.path.join(BUILD, "judge_cl_crosswalk.json")))
    look = {json.loads(line)["id"]: json.loads(line) for line in open(os.path.join(BUILD, "lookups", "judges.jsonl"), encoding="utf-8")}
    con = duckdb.connect(os.path.join(ROOT, "private", "acq", "courtlistener", "db", "small.duckdb"), read_only=True)
    names = defaultdict(set)  # canonical person -> alnum name forms (alias rows included)
    canon = {}
    fjc = {}
    for pid, f, m, l, al, fj in con.execute("SELECT id, name_first, name_middle, name_last, is_alias_of_id, fjc_id FROM person").fetchall():
        canon[int(pid)] = int(al) if al else int(pid)
        if fj:
            fjc[int(pid)] = fj.strip()
    for pid, f, m, l in con.execute("SELECT id, name_first, name_middle, name_last FROM person").fetchall():
        names[canon[int(pid)]].add(alnum(f, m, l))
    jud = set(r[0] for r in con.execute("SELECT DISTINCT person_id FROM position WHERE court_id IS NOT NULL").fetchall())
    court_people = defaultdict(set)
    state_people = defaultdict(set)
    for person_id, court_id, state in con.execute(
            """SELECT p.person_id, p.court_id, h.state FROM position p LEFT JOIN courthouses h ON h.court_id = p.court_id
               WHERE p.court_id IS NOT NULL AND (p.position_type IS NULL OR p.position_type NOT IN ('clerk','prac','prof','adj-prof','legis','mayor','da','ada','com'))""").fetchall():
        c = canon[int(person_id)]
        court_people[court_id].add(c)
        if state:
            state_people[state].add(c)
    checks = {"t1_checked": 0, "t1_fjc_contradictions": 0, "t2_checked": 0, "t2_failed": 0, "t3_checked": 0, "t3_failed": 0,
              "missing_person": 0, "person_linked_to_different_names": 0}
    failures = []
    by_person = defaultdict(set)
    for row in spec["rows"]:
        p = row["item"]["profile"]
        if not p["linked"]:
            continue
        c = int(p["cl_person_id"])
        if c not in names:
            checks["missing_person"] += 1
            failures.append((row["id"], "person id not in people table"))
            continue
        rec = look[row["id"]]
        rec_name = alnum(rec["name"])
        by_person[c].add(rec_name)
        if p["tier"] in ("exact_id", "parent_profile_link"):
            checks["t1_checked"] += 1
            jid = (rec.get("sids") or {}).get("fjc_jid")
            if p["tier"] == "parent_profile_link":
                parent = look.get(rec.get("ppid") or "")
                jid = ((parent or {}).get("sids") or {}).get("fjc_jid")
            if jid and fjc.get(c) and fjc[c] != str(jid):
                checks["t1_fjc_contradictions"] += 1
                failures.append((row["id"], f"fjc {jid} vs person fjc {fjc[c]}"))
            continue
        if p["tier"] == "exact_name_same_court":
            checks["t2_checked"] += 1
            same = {x for cid in p["court_ids"] for x in court_people.get(cid, set()) if rec_name in names[x]}
            if same != {c}:
                checks["t2_failed"] += 1
                failures.append((row["id"], f"T2 recheck found {sorted(same)[:5]}"))
        elif p["tier"] == "exact_name_same_state":
            checks["t3_checked"] += 1
            same = {x for st in p["states"] for x in state_people.get(st, set()) if rec_name in names[x]}
            if c not in same:
                checks["t3_failed"] += 1
                failures.append((row["id"], f"T3 recheck: person not found by name in state ({sorted(same)[:5]})"))
            elif len(same) > 1:
                checks["t3_failed"] += 1
                failures.append((row["id"], f"T3 recheck: several people by name in state {sorted(same)[:5]}"))
    for c, ns in by_person.items():
        if len(ns) > 1:
            checks["person_linked_to_different_names"] += 1
            failures.append((f"person {c}", "linked from records with different names: " + " | ".join(sorted(ns))))
    out = {"method": "plain SQL on the CourtListener people, position and courthouses tables with an independent letters-and-digits name normaliser",
           "checks": checks, "failures": failures[:200]}
    with open(os.path.join(BUILD, "verification.json"), "w") as h:
        json.dump(out, h, indent=1)
    print(json.dumps(checks))
    for f in failures[:25]:
        print("FAIL", f)
    return 0


if __name__ == "__main__":
    sys.exit(main())
