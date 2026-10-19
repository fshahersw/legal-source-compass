"""Build judge_cl_crosswalk: every `judges` record mapped to a CourtListener person id where the evidence allows, with its tier.

Tiers (strongest first; see xwalk_lib for the normalisation):
  T1 exact_id                  the record's own FJC bridge (FJC nid -> FJC jid == CourtListener people.fjc_id), native ids only
  T2 exact_name_same_court     exact full name (incl. suffix) and a CourtListener judicial position at a court the record names; one person
  T3 exact_name_same_state     exact full name and a CourtListener judicial position in the record's state; one person in that state
  T4 compatible_name_same_court  first and last name exact, middle name compatible (initial vs full or absent), suffix not contradictory,
                               judicial position at a named court, one candidate: a possible match that needs review, never an identity link
Records that cannot be resolved are `ambiguous` (several candidates, listed), `fjc_conflict`, `date_conflict`, `withheld_for_review`
(kept from the source bridge) or `not_found`. A CourtListener person claimed by two records in T2-T4 demotes both to `ambiguous`.

    python3 -I -B scripts/enrichment/judge_xwalk/build_judge_xwalk.py
"""
from __future__ import annotations

import json
import os
import sys
import time
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment"))
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment", "courtlistener"))
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import clb_common as cc  # noqa: E402
import corpus_writer as writer  # noqa: E402
import duckdb  # noqa: E402
import xwalk_lib as xl  # noqa: E402

LOOK = os.path.join(ROOT, "private", "build", "judge_xwalk", "lookups")
OUT = os.path.join(ROOT, "private", "build", "judge_xwalk")
DB = os.path.join(ROOT, "private", "acq", "courtlistener", "db", "small.duckdb")
DATASET = "judge_cl_crosswalk"
PEOPLE_URL = cc.BULK_BASE + "people-db-people-2026-09-30.csv.bz2"
POSITIONS_URL = cc.BULK_BASE + "people-db-positions-2026-09-30.csv.bz2"
COURTS_URL = cc.BULK_BASE + "courts-2026-09-30.csv.bz2"
LINKED = ("exact_id", "parent_profile_link", "exact_name_same_court", "exact_name_same_state")
TIER_LABEL = {
    "exact_id": "T1 · exact identifier (FJC id = CourtListener fjc_id)",
    "parent_profile_link": "T1 · the directory record declares it is backed by another directory record whose FJC id links this person",
    "exact_name_same_court": "T2 · exact full name and a CourtListener judicial position at a court the record names",
    "exact_name_same_state": "T3 · exact full name and a CourtListener judicial position in the record's state (only person there)",
    "compatible_name_same_court": "T4 · possible match (middle name differs in form) at a named court — needs review, not linked",
    "ambiguous": "Several CourtListener people fit — not linked",
    "fjc_conflict": "FJC ids disagree — not linked",
    "date_conflict": "Service dates disagree — not linked",
    "withheld_for_review": "Source bridge withheld for review — not linked",
    "no_cl_person_for_fjc_id": "FJC id has no CourtListener person; no name match either",
    "not_found": "No CourtListener person fits",
}


def load_jsonl(name):
    return [json.loads(line) for line in open(os.path.join(LOOK, name), encoding="utf-8")]


def build():
    judges = load_jsonl("judges.jsonl")
    spine_ids = {r["id"] for r in load_jsonl("court_spine.jsonl")}
    con = duckdb.connect(DB, read_only=True)
    courts = {r[0]: {"full": r[1], "short": r[2], "jur": r[3]} for r in con.execute("SELECT id, full_name, short_name, jurisdiction FROM courts").fetchall()}
    court_states = defaultdict(set)
    for cid, st in con.execute("SELECT court_id, state FROM courthouses WHERE state IS NOT NULL").fetchall():
        court_states[cid].add(st)
    alias_index = defaultdict(set)
    for cid, c in courts.items():
        for a in xl.court_aliases(c["full"], c["short"]):
            alias_index[a].add(cid)

    persons = {}
    alias_of = {}
    for pid, first, middle, last, suf, fjc, al, dob, dod in con.execute(
            "SELECT id, name_first, name_middle, name_last, name_suffix, fjc_id, is_alias_of_id, date_dob, date_dod FROM person").fetchall():
        pid = int(pid)
        persons[pid] = {"name": cc.full_name(first, middle, last, suf), "fjc": (fjc or "").strip() or None,
                        "parts": xl.cl_name(first, middle, last, suf), "dob": dob, "dod": dod}
        if al:
            alias_of[pid] = int(al)

    def canon(pid):
        seen = set()
        while pid in alias_of and pid not in seen:
            seen.add(pid)
            pid = alias_of[pid]
        return pid

    judicial_types = set(cc.JUDICIAL_POSITIONS)
    pos = defaultdict(list)  # canonical person -> judicial positions at a court
    for person_id, court_id, ptype, title, start, end in con.execute(
            "SELECT person_id, court_id, position_type, job_title, date_start, date_termination FROM position WHERE court_id IS NOT NULL").fetchall():
        if court_id not in courts or not xl.is_judicial(ptype, title, judicial_types):
            continue
        pos[canon(int(person_id))].append({"court_id": court_id, "court": courts[court_id]["full"], "type": ptype or title,
                                           "start": cc.parse_date(start), "end": cc.parse_date(end)})

    # name indexes over canonical people (alias rows contribute their name forms to the canonical person)
    exact_idx = defaultdict(set)
    fl_idx = defaultdict(set)
    forms = defaultdict(list)
    for pid, p in persons.items():
        c = canon(pid)
        full, suffix, f, m, l = p["parts"]
        if not full:
            continue
        exact_idx[(full, suffix)].add(c)
        if f and l:
            fl_idx[(f[0], l[-1])].add(c)
        forms[c].append((full, suffix, f, m, l))
    fjc_of = {}
    for pid, p in persons.items():
        if p["fjc"]:
            fjc_of[canon(pid)] = p["fjc"]

    def court_ids_for(record):
        ids, unresolved = set(), []
        for name in record.get("courts") or []:
            hit = alias_index.get(xl.norm_court(name))
            if hit:
                ids |= hit
            else:
                unresolved.append(name)
        return ids, unresolved

    def state_codes_for(record):
        out = set()
        for s in (record.get("states") or []) + [record.get("state") or ""]:
            code = xl.STATE_CODES.get((s or "").strip().lower())
            if code:
                out.add(code)
        return out

    def person_courts(c):
        return {p["court_id"] for p in pos.get(c, [])}

    def person_states(c):
        out = set()
        for cid in person_courts(c):
            out |= court_states.get(cid, set())
        return out

    def dates_conflict(record, c, court_ids):
        """True when no dated CourtListener position at the court overlaps the record's dated service there (±3 years).

        A person often holds an earlier role at the same court (a magistrate judge later commissioned as district judge), so a position
        that started earlier and is still open, or ended after the record's service began, is consistent, not a conflict.
        """
        spans = [(p["start"].year, p["end"].year if p["end"] else 2026) for p in pos.get(c, []) if p["court_id"] in court_ids and p["start"]]
        if not spans:
            return False
        windows = []
        for a in record.get("fjcapp") or []:
            y = (a.get("cd") or "")[:4]
            if y.isdigit():
                end = (a.get("td") or a.get("sd") or "")[:4]
                windows.append((int(y), int(end) if end.isdigit() else 2026))
        lo, hi = xl.term_years(record.get("term"))
        if lo and hi:
            windows.append((lo, hi))
        if not windows:
            return False
        overlaps = any(s - 3 <= w_hi and e + 3 >= w_lo for s, e in spans for w_lo, w_hi in windows)
        return not overlaps

    results = {}
    for r in judges:
        rid = r["id"]
        name_key = xl.record_name(r["name"])
        court_ids, unresolved = court_ids_for(r)
        states = state_codes_for(r)
        bridge = r.get("sids") or {}
        status = bridge.get("bridge_status")
        res = {"tier": None, "cl": None, "candidates": [], "court_ids": sorted(court_ids), "unresolved_courts": unresolved, "states": sorted(states),
               "fjc_jid": bridge.get("fjc_jid"), "fjc_nid": bridge.get("fjc_nid"), "notes": []}
        if status == "linked_native_id" and bridge.get("cl_person_id"):
            c = canon(int(bridge["cl_person_id"]))
            res.update(tier="exact_id", cl=c)
            if fjc_of.get(c) and bridge.get("fjc_jid") and fjc_of[c] != str(bridge["fjc_jid"]):
                res.update(tier="fjc_conflict", cl=None, candidates=[c])
            results[rid] = res
            continue
        if status == "withheld_for_review":
            res.update(tier="withheld_for_review")
            results[rid] = res
            continue
        full, suffix = name_key
        cands_exact = exact_idx.get((full, suffix), set())
        at_court = {c for c in cands_exact if person_courts(c) & court_ids} if court_ids else set()
        in_state = {c for c in cands_exact if person_states(c) & states} if states else set()
        tier, chosen, cand = None, None, []
        if len(at_court) == 1:
            tier, chosen = "exact_name_same_court", next(iter(at_court))
        elif len(at_court) > 1:
            tier, cand = "ambiguous", sorted(at_court)
        elif len(in_state) == 1:
            tier, chosen = "exact_name_same_state", next(iter(in_state))
        elif len(in_state) > 1:
            tier, cand = "ambiguous", sorted(in_state)
        if tier is None and full and court_ids:
            compat = set()
            for c in fl_idx.get((full[0], full[-1]), set()):
                if not (person_courts(c) & court_ids):
                    continue
                for pfull, psuf, f, m, l in forms[c]:
                    n = len(full)
                    if n < len(f) + len(l) or full[:len(f)] != f or full[n - len(l):] != l:
                        continue
                    mid = full[len(f):n - len(l)]
                    if not xl.middle_compatible(mid, m):
                        continue
                    if suffix and psuf and suffix != psuf:
                        continue
                    compat.add(c)
                    break
            if len(compat) == 1:
                tier, chosen = "compatible_name_same_court", next(iter(compat))
            elif len(compat) > 1:
                tier, cand = "ambiguous", sorted(compat)
        if chosen is not None:
            if res["fjc_jid"] and fjc_of.get(chosen) and fjc_of[chosen] != str(res["fjc_jid"]):
                tier, cand, chosen = "fjc_conflict", [chosen], None
            elif dates_conflict(r, chosen, court_ids or person_courts(chosen)):
                tier, cand, chosen = "date_conflict", [chosen], None
        if tier is None:
            tier = "no_cl_person_for_fjc_id" if status == "no_courtlistener_person_with_this_fjc_jid" else "not_found"
        res.update(tier=tier, cl=chosen, candidates=cand)
        results[rid] = res

    # One CourtListener person, one directory person. Several records may claim the same person only when the directory itself duplicates
    # that person: identical normalised names (full name and suffix), or a stub that declares (ppid) the natively linked record as its parent.
    # Anything else is demoted: a differently written middle name becomes a possible match for review, other conflicts become ambiguous.
    by_id = {r["id"]: r for r in judges}
    names = {r["id"]: xl.record_name(r["name"]) for r in judges}

    def compatible(a, b):
        fa, fb = a[0], b[0]
        if not fa or not fb or fa[0] != fb[0] or fa[-1] != fb[-1]:
            return False
        if a[1] and b[1] and a[1] != b[1]:
            return False
        return xl.middle_compatible(fa[1:-1], fb[1:-1])

    claims = defaultdict(list)
    for rid, res in results.items():
        if res["cl"] is not None:
            claims[res["cl"]].append(rid)
    demoted = 0
    for c, rids in claims.items():
        if len(rids) < 2:
            continue
        native = [x for x in rids if results[x]["tier"] == "exact_id"]
        if len(native) > 1:  # two native FJC links to one person: never resolved here
            for x in rids:
                results[x].update(tier="ambiguous", candidates=[c], cl=None)
                results[x]["notes"].append(f"CourtListener person {c} is claimed by {len(rids)} records with native ids")
                demoted += 1
            continue
        anchors = native
        if not anchors:  # no native id: the claimants with the strongest exact tier anchor the person, if they all carry one name
            for t in ("exact_name_same_court", "exact_name_same_state"):
                group = [x for x in rids if results[x]["tier"] == t]
                if group and len({names[x] for x in group}) == 1:
                    anchors = group
                    break
        for x in rids:
            if x in anchors:
                continue
            others = [o for o in rids if o != x]
            same_name = [o for o in others if names[o] == names[x]]
            parent = by_id[x].get("ppid")
            if parent and parent in anchors:
                results[x]["tier"] = "parent_profile_link"
                results[x]["notes"].append(f"directory stub of record {parent}")
            elif same_name and results[x]["tier"] != "compatible_name_same_court":
                results[x]["notes"].append("the directory lists this person more than once: " + ", ".join(sorted(same_name)))
            elif any(compatible(names[x], names[o]) for o in others):
                results[x].update(tier="compatible_name_same_court", cl=None, candidates=[c])
                results[x]["notes"].append("same court as record(s) " + ", ".join(sorted(others)) + " whose name differs only in middle-name form")
                demoted += 1
            else:
                results[x].update(tier="ambiguous", candidates=sorted({c} | set(results[x]["candidates"])), cl=None)
                results[x]["notes"].append(f"CourtListener person {c} is also claimed by another record")
                demoted += 1
        # name-tier records that only claim among themselves must all share one name, otherwise all are demoted
        if not anchors:
            linked_now = [x for x in rids if results[x]["cl"] is not None]
            if len({names[x] for x in linked_now}) > 1:
                for x in linked_now:
                    results[x].update(tier="ambiguous", candidates=[c], cl=None)
                    results[x]["notes"].append(f"CourtListener person {c} is claimed by records with different names")
                    demoted += 1
    return judges, results, persons, pos, courts, spine_ids, canon, demoted


def main():
    t0 = time.time()
    judges, results, persons, pos, courts, spine_ids, canon, demoted = build()
    judge_dockets = set()
    path = os.path.join(ROOT, "private", "build", "courtlistener", "clb_judge_dockets.json")
    if os.path.exists(path):
        judge_dockets = {r["id"] for r in json.load(open(path))["rows"]}
    built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    rows = []
    tiers = Counter()
    by_system = defaultdict(Counter)
    for r in judges:
        res = results[r["id"]]
        tier = res["tier"]
        tiers[tier] += 1
        by_system[r.get("system") or "Not recorded"][tier] += 1
        c = res["cl"]
        p = persons.get(c) if c is not None else None
        linked = tier in LINKED
        matched = [dict(court_id=x["court_id"], court=x["court"], start=str(x["start"]) if x["start"] else None, end=str(x["end"]) if x["end"] else None,
                        position=x["type"]) for x in pos.get(c, []) if c is not None and (not res["court_ids"] or x["court_id"] in res["court_ids"] or tier == "exact_name_same_state")][:8]
        links = [{"label": "Judge profile", "url": f"/judges/{r['id']}"}]
        if linked:
            links.append({"label": "CourtListener person record", "url": f"/records/cl_people/cl:people:{c}"})
            if str(c) in judge_dockets:
                links.append({"label": "Dockets and opinions in CourtListener's collection", "url": f"/records/clb_judge_dockets/{c}"})
            links.append({"label": "CourtListener person page", "url": f"https://www.courtlistener.com/person/{c}/"})
        state_label = (r.get("state") or "")
        rows.append(writer.record(
            DATASET, r["id"], f"{r['name']}: CourtListener person crosswalk", source_url=PEOPLE_URL, state=state_label,
            subtitle=TIER_LABEL[tier] + (f" · CourtListener person {c} ({p['name']})" if c is not None and p else ""),
            cells={"judge": r["name"], "state": state_label or None, "system": r.get("system") or None, "tier": tier, "cl_person_id": c if linked else None,
                   "cl_name": p["name"] if (p and linked) else None, "courts": "; ".join(r.get("courts") or []) or None},
            badges=["Crosswalk", "Linked" if linked else ("Needs review" if tier == "compatible_name_same_court" else "Not linked")],
            facts=[[k, "Not recorded" if v is None else str(v)] for k, v in [
                ("Judge (directory record)", f"{r['name']} ({r['id']})"), ("Courts named on the record", "; ".join(r.get("courts") or []) or None),
                ("Match tier", TIER_LABEL[tier]), ("CourtListener person", f"{p['name']} ({c})" if (p and c is not None) else None),
                ("CourtListener judicial positions used as evidence", "; ".join(f"{m['court']} ({(m['start'] or '?')[:4]}–{(m['end'] or 'no end')[:10]})" for m in matched[:4]) or None),
                ("Candidates when ambiguous", ", ".join(str(x) for x in res["candidates"][:8]) or None),
                ("Court names not resolved to a CourtListener court", "; ".join(res["unresolved_courts"]) or None),
                ("Method", "Native FJC ids first; otherwise exact full-name match (case, punctuation, honorifics and suffix spelling normalised) against CourtListener people with a judicial position at a named court or in the record's state, unique in that scope. No fuzzy matching. Possible matches with a differently written middle name are shown for review only.")]],
            text=f"crosswalk {r['name']} {state_label} {tier}", filters={"tier": [tier], "system": [(r.get("system") or "unknown").lower() or "unknown"]},
            links=links,
            extra={"profile": {"judges_id": r["id"], "judge_entity_id": r.get("eid"), "name": r["name"], "system": r.get("system") or None, "state": state_label or None,
                               "courts": r.get("courts") or [], "tier": tier, "linked": linked, "needs_review": tier == "compatible_name_same_court",
                               "cl_person_id": c if c is not None else None, "cl_name": p["name"] if p else None, "fjc_jid": res["fjc_jid"], "fjc_nid": res["fjc_nid"],
                               "cl_fjc_id": p["fjc"] if p else None, "court_ids": res["court_ids"], "unresolved_courts": res["unresolved_courts"],
                               "states": res["states"], "matched_positions": matched, "candidates": res["candidates"][:12], "notes": res["notes"],
                               "cl_record": f"/records/cl_people/cl:people:{c}" if linked else None,
                               "cl_dockets_record": f"/records/clb_judge_dockets/{c}" if (linked and str(c) in judge_dockets) else None}}))
    linked_n = sum(tiers[t] for t in LINKED)
    summary = {
        "source": "Judge directory (dataset judges) × CourtListener people, positions and courts (bulk files, snapshot 2026-09-30)", "snapshot": cc.SNAPSHOT,
        "totals": {"records": len(rows), "linked": linked_n, "linked_pct": cc.share(linked_n, len(rows)), "by_tier": dict(tiers),
                   "by_system": {k: dict(v) for k, v in by_system.items()}, "demoted_shared_person": demoted},
        "definitions": {k: v for k, v in TIER_LABEL.items()},
        "normalisation": "lower case; punctuation removed; hyphens and slashes split names; honorific prefixes (Judge, Justice, Hon., Chief ...) and trailing Emeritus/Ret. removed; suffixes Jr/Junior, Sr, II/III/IV normalised and compared separately; CourtListener alias rows resolve to the canonical person; federal court names rewritten between CourtListener style (District Court, N.D. Illinois) and FJC style (U.S. District Court for the Northern District of Illinois).",
        "caveats": ["A link means the evidence tier above was met, not that every fact on both sides agrees.",
                    "T4 possible matches are never treated as the same person; they are listed for review.",
                    "Many state trial-court judges have no CourtListener person; not_found is not evidence that a judge does not exist."],
        "grain": "one record per judges record"}
    spec = {"dataset": DATASET, "label": "Judge directory ↔ CourtListener people crosswalk (exact-evidence tiers, Sept 30, 2026 snapshot)",
            "listing_block": writer.listing([("judge", "Judge"), ("state", "State"), ("system", "System"), ("tier", "Match tier"), ("cl_person_id", "CourtListener person"),
                                             ("cl_name", "CourtListener name"), ("courts", "Courts on record")],
                                            [("tier", "Match tier", {k: v.split(" · ")[0] if " · " in v else v for k, v in TIER_LABEL.items()})]),
            "summary": summary, "rows": rows, "built_at": built_at,
            "inputs": [{"url": u, "path": "private/acq/courtlistener/db/small.duckdb", "sha256": None} for u in (PEOPLE_URL, POSITIONS_URL, COURTS_URL)]
            + [{"url": "corpus:judges", "path": "private/build/judge_xwalk/lookups/judges.jsonl", "sha256": None}]}
    os.makedirs(OUT, exist_ok=True)
    path = os.path.join(OUT, DATASET + ".json")
    with open(path + ".tmp", "w") as h:
        json.dump(spec, h, ensure_ascii=False, sort_keys=True, default=str)
    os.replace(path + ".tmp", path)
    print(DATASET, len(rows), "rows", os.path.getsize(path) // 1024, "KB", f"{time.time() - t0:.1f}s")
    print("tiers", dict(tiers.most_common()))
    print("linked", linked_n, cc.share(linked_n, len(rows)), "% ; demoted", demoted)
    for k, v in by_system.items():
        print(" ", k, dict(v.most_common()))


if __name__ == "__main__":
    main()
