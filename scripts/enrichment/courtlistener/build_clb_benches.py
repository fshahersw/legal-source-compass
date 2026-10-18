"""Build bench-composition datasets from CourtListener's people-db bulk tables (judicial positions, people, schools).

Datasets: clb_court_benches (one record per court with judicial positions) and clb_bench_cohorts (federal appointment cohorts,
decades, law schools, court levels). Source: private/acq/courtlistener/db/small.duckdb (load_small.py), snapshot 2026-09-30.
"Active" means a judicial position with no recorded end date, for a person with no recorded date of death, as of the snapshot: for
state courts CourtListener's position data is incomplete, so counts are positions on record, not a census of sitting judges.
"""
from __future__ import annotations

import datetime as dt
import hashlib
import json
import os
import sys
import time
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment"))
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import clb_common as cc  # noqa: E402
import corpus_writer as writer  # noqa: E402
import duckdb  # noqa: E402

DB = os.path.join(ROOT, "private", "acq", "courtlistener", "db", "small.duckdb")
OUT = os.path.join(ROOT, "private", "build", "courtlistener")
LOOK = os.path.join(ROOT, "private", "build", "fjc_idb", "lookups")
PEOPLE_URL = "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/people-db-people-2026-09-30.csv.bz2"
POSITIONS_URL = "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/people-db-positions-2026-09-30.csv.bz2"
COURTS_URL = "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/courts-2026-09-30.csv.bz2"
STATES_WITH_PAGE = set(
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split()
)
ACTIVE_LIST_LIMIT = 60


def lookup(name: str) -> dict:
    return json.load(open(os.path.join(LOOK, name + ".json")))


def sha256(path: str) -> str:
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for b in iter(lambda: f.read(1 << 22), b""):
            h.update(b)
    return h.hexdigest()


def facts(pairs):
    return [[k, "Not recorded" if v is None else str(v)] for k, v in pairs]


def build() -> dict[str, dict]:
    con = duckdb.connect(DB, read_only=True)
    spine = lookup("court_spine")
    spine_ids, spine_state, spine_title = set(spine["ids"]), spine["state"], spine["title"]
    cl_people_ids = set(lookup("cl_people")["ids"])
    courts = {r[0]: dict(zip(("id", "full_name", "short_name", "citation_string", "jurisdiction", "in_use", "start_date", "end_date"), r))
              for r in con.execute("SELECT id, full_name, short_name, citation_string, jurisdiction, in_use, start_date, end_date FROM courts").fetchall()}
    persons = {r[0]: {"id": r[0], "name": cc.full_name(r[1], r[2], r[3], r[4]), "gender": r[5], "fjc_id": r[6], "dod": cc.parse_date(r[7]), "alias_of": r[8]}
               for r in con.execute("SELECT id, name_first, name_middle, name_last, name_suffix, gender, fjc_id, date_dod, is_alias_of_id FROM person").fetchall()}
    cols = ("id", "person_id", "court_id", "position_type", "job_title", "date_start", "date_termination", "termination_reason", "how_selected", "appointer_id",
            "date_nominated", "date_confirmation", "votes_yes", "votes_no", "school_id")
    positions = [dict(zip(cols, r)) for r in con.execute(f"SELECT {', '.join(cols)} FROM position").fetchall()]
    by_id = {p["id"]: p for p in positions}
    parties = defaultdict(list)
    for pid, party, ds in con.execute("SELECT person_id, political_party, date_start FROM political_affiliation").fetchall():
        parties[pid].append((cc.parse_date(ds), party))
    edu = defaultdict(list)
    school_name = dict(con.execute("SELECT id, name FROM school").fetchall())
    for pid, level, sid in con.execute("SELECT person_id, degree_level, school_id FROM education").fetchall():
        edu[pid].append((level, sid))
    race_label = dict(con.execute("SELECT id, race FROM race").fetchall())
    person_race = defaultdict(list)
    for pid, rid in con.execute("SELECT person_id, race_id FROM person_race").fetchall():
        person_race[pid].append(race_label.get(rid))
    inputs = [{"url": u, "path": f"CourtListener bulk file {u.rsplit('/', 1)[1]} (loaded into private/acq/courtlistener/db/small.duckdb)", "sha256": None}
              for u in (PEOPLE_URL, POSITIONS_URL, COURTS_URL)]
    built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())

    for p in positions:
        p["start"] = cc.parse_date(p["date_start"])
        p["end"] = cc.parse_date(p["date_termination"])
        p["nominated"] = cc.parse_date(p["date_nominated"])
        p["confirmed"] = cc.parse_date(p["date_confirmation"])
        p["judicial"] = p["position_type"] in cc.JUDICIAL_POSITIONS and p["court_id"] in courts
        person = persons.get(p["person_id"])
        p["active"] = bool(p["judicial"] and p["start"] and not p["end"] and person and person["dod"] is None)
        p["tenure_years"] = cc.years_between(p["start"], p["end"] or (cc.SNAPSHOT_DATE if p["active"] else None))

    def party_of(person_id, when):
        entries = sorted(((d, pt) for d, pt in parties.get(person_id, []) if pt), key=lambda e: (e[0] or dt.date.min, e[1]))
        if not entries:
            return None
        before = [pt for d, pt in entries if d is not None and when is not None and d <= when]
        return (before[-1] if before else entries[0][1])

    def appointer_person(pos):
        a = by_id.get(pos["appointer_id"]) if pos["appointer_id"] else None
        return persons.get(a["person_id"]) if a else None

    judicial = [p for p in positions if p["judicial"]]
    by_court = defaultdict(list)
    for p in judicial:
        by_court[p["court_id"]].append(p)

    # ------------------------------------------------------------------ court benches
    b_rows = []
    for cid, plist in sorted(by_court.items()):
        court = courts[cid]
        jur = court["jurisdiction"]
        active = [p for p in plist if p["active"]]
        ended = [p for p in plist if p["end"] and p["tenure_years"] is not None]
        gender_all = Counter(persons[p["person_id"]]["gender"] for p in plist if persons.get(p["person_id"]) and persons[p["person_id"]]["gender"])
        gender_act = Counter(persons[p["person_id"]]["gender"] for p in active if persons.get(p["person_id"]) and persons[p["person_id"]]["gender"])
        hs = cc.top_counts([p["how_selected"] for p in plist], 6, cc.HOW_SELECTED_LABEL)
        term = cc.top_counts([p["termination_reason"] for p in plist if p["end"]], 6, cc.TERMINATION_LABEL)
        appointers = Counter()
        for p in plist:
            ap = appointer_person(p)
            if ap:
                appointers[(ap["id"], ap["name"])] += 1
        decades = Counter(cc.decade(p["start"]) for p in plist if p["start"])
        active_sorted = sorted(active, key=lambda p: (p["start"], p["id"]))
        active_list = []
        for p in active_sorted[:ACTIVE_LIST_LIMIT]:
            person = persons[p["person_id"]]
            ap = appointer_person(p)
            active_list.append({
                "person_id": p["person_id"], "name": person["name"], "position": cc.POSITION_LABEL.get(p["position_type"], p["position_type"]),
                "since": str(p["start"]), "years": cc.r2(cc.years_between(p["start"], cc.SNAPSHOT_DATE)),
                "selected": cc.HOW_SELECTED_LABEL.get(p["how_selected"], p["how_selected"]), "appointer": ap["name"] if ap else None,
                "record": f"/records/cl_people/cl:people:{p['person_id']}" if f"cl:people:{p['person_id']}" in cl_people_ids else None,
            })
        tenure_med = cc.r2(cc.median([p["tenure_years"] for p in ended]))
        active_years = [cc.years_between(p["start"], cc.SNAPSHOT_DATE) for p in active]
        women_act = cc.share(gender_act.get("f", 0), sum(gender_act.values()))
        state = spine_state.get(cid)
        links = []
        if cid in spine_ids:
            links.append({"label": "Court profile", "url": f"/courts/{cid}"})
        if state in STATES_WITH_PAGE:
            links.append({"label": f"{state} place profile", "url": f"/places/{state}"})
        links.append({"label": "CourtListener court page", "url": f"https://www.courtlistener.com/court/{cid}/"})
        name = court["full_name"] or cid
        profile = {
            "court_id": cid, "name": name, "jurisdiction": jur, "level": cc.JURISDICTION_LABEL.get(jur, f"Code {jur}"), "state": state,
            "positions": len(plist), "active": len(active), "persons": len({p["person_id"] for p in plist}),
            "women_active_pct": women_act, "gender_active": dict(gender_act), "gender_all": dict(gender_all),
            "median_tenure_years_ended": tenure_med, "median_years_so_far_active": cc.r2(cc.median(active_years)),
            "selected": hs, "termination": term, "appointers": [{"person_id": k[0], "name": k[1], "positions": v} for k, v in appointers.most_common(6)],
            "start_decades": [{"decade": d, "positions": c} for d, c in sorted(decades.items())], "active_judges": active_list,
            "active_listed": len(active_list), "active_total": len(active),
        }
        b_rows.append(writer.record(
            "clb_court_benches", cid, f"{name} — judicial positions on record (CourtListener people database)",
            source_url=POSITIONS_URL, state=state or "",
            subtitle=f"{cc.JURISDICTION_LABEL.get(jur, jur)} · {len(plist):,} positions on record · {len(active):,} with no recorded end date",
            cells={"court": name, "level": cc.JURISDICTION_LABEL.get(jur, f"Code {jur}"), "state": state, "positions": len(plist), "active": len(active),
                   "women_active_pct": women_act, "median_tenure_years": tenure_med, "persons": profile["persons"]},
            badges=["CourtListener people database", cc.JURISDICTION_LABEL.get(jur, jur)] + (["State data incomplete"] if jur in cc.STATE_JURISDICTIONS else []),
            facts=facts([
                ("Court", name), ("CourtListener court id", cid), ("Level (as coded)", cc.JURISDICTION_LABEL.get(jur, f"Code {jur}")),
                ("Positions on record", f"{len(plist):,}"), ("People with a position here", f"{profile['persons']:,}"),
                ("Positions with no recorded end date (as of 2026-09-30, person not recorded as deceased)", f"{len(active):,}"),
                ("Women among those (gender recorded)", f"{women_act}%" if women_act is not None else None),
                ("Median years served, positions that have ended", f"{tenure_med:.1f}" if tenure_med is not None else None),
                ("How seats were filled (recorded)", "; ".join(f"{h['label']} {h['count']:,} ({h['share_pct']}%)" for h in hs) or None),
                ("Most frequent appointers", "; ".join(f"{a['name']} ({a['positions']:,})" for a in profile["appointers"][:4]) or None),
                ("Coverage", "Positions in CourtListener's people database. Federal judges follow the FJC biographical directory; state-court coverage is partial, so counts are positions on record, not a census."),
            ]),
            text=f"{name} judges bench positions {cid}", filters={"level": [jur or "unknown"], "state": [state or "unknown"]}, links=links, extra={"profile": profile}))
    out = {"clb_court_benches": {
        "label": "Judicial positions on record by court (CourtListener people database, Sept 30, 2026)",
        "listing": writer.listing([("court", "Court"), ("level", "Level"), ("state", "State"), ("positions", "Positions on record"), ("active", "No recorded end date"),
                                   ("women_active_pct", "Women (of those) %"), ("median_tenure_years", "Median years served (ended)")],
                                  [("level", "Level", {k: v for k, v in cc.JURISDICTION_LABEL.items()})]),
        "summary": {"source": "CourtListener bulk data people-db-positions, people-db-people, courts (Free Law Project)", "snapshot": cc.SNAPSHOT,
                    "terms": "CourtListener publishes these bulk files for download without an account; see https://www.courtlistener.com/terms/ and the bulk-data help page.",
                    "definitions": {"judicial position": sorted(cc.JUDICIAL_POSITIONS), "active": "judicial position with a start date, no recorded end date, and a person with no recorded date of death, as of 2026-09-30",
                                    "tenure": "years from start to end date for positions that have ended; positions with no recorded end are not counted"},
                    "caveats": ["State-court position data is incomplete; counts are positions on record.", "Gender is recorded for part of the people; shares use only those with a recorded value."],
                    "grain": "one record per court with at least one judicial position"},
        "rows": b_rows}}

    # ------------------------------------------------------------------ cohorts
    fed = [p for p in judicial if courts[p["court_id"]]["jurisdiction"] in cc.FEDERAL_JURISDICTIONS]
    fed_pres = [p for p in fed if p["how_selected"] == "a_pres"]
    c_rows = []

    def cohort_stats(plist):
        gender = Counter(persons[p["person_id"]]["gender"] for p in plist if persons.get(p["person_id"]) and persons[p["person_id"]]["gender"])
        conf_days = [(p["confirmed"] - p["nominated"]).days for p in plist if p["confirmed"] and p["nominated"] and p["confirmed"] >= p["nominated"]]
        vote_share = []
        for p in plist:
            y, nn = str(p["votes_yes"] or ""), str(p["votes_no"] or "")
            if y.isdigit() and nn.isdigit() and int(y) + int(nn) > 0:
                vote_share.append(100.0 * int(y) / (int(y) + int(nn)))
        by_level = Counter(courts[p["court_id"]]["jurisdiction"] for p in plist)
        tenure = [p["tenure_years"] for p in plist if p["end"] and p["tenure_years"] is not None]
        term = cc.top_counts([p["termination_reason"] for p in plist if p["end"]], 5, cc.TERMINATION_LABEL)
        return {
            "positions": len(plist), "persons": len({p["person_id"] for p in plist}),
            "women_pct": cc.share(gender.get("f", 0), sum(gender.values())), "gender_recorded": sum(gender.values()),
            "median_days_nomination_to_confirmation": cc.median(conf_days), "with_confirmation_dates": len(conf_days),
            "median_senate_yes_pct": None if not vote_share else round(cc.median(vote_share), 1), "with_vote_counts": len(vote_share),
            "by_level": [{"level": cc.JURISDICTION_LABEL.get(k, k), "code": k, "positions": v} for k, v in sorted(by_level.items(), key=lambda kv: -kv[1])],
            "median_tenure_years_ended": cc.r2(cc.median(tenure)), "ended": len(tenure), "still_without_end": sum(1 for p in plist if not p["end"]),
            "termination": term,
        }

    by_appointer = defaultdict(list)
    for p in fed_pres:
        ap = appointer_person(p)
        if ap:
            by_appointer[ap["id"]].append(p)
    for apid, plist in sorted(by_appointer.items(), key=lambda kv: -len(kv[1])):
        ap = persons[apid]
        first_start = min((p["start"] for p in plist if p["start"]), default=None)
        code = party_of(apid, first_start)
        party = cc.PARTY_LABEL.get(code, code)
        stats = cohort_stats(plist)
        first = min((p["start"] for p in plist if p["start"]), default=None)
        last = max((p["start"] for p in plist if p["start"]), default=None)
        c_rows.append(writer.record(
            "clb_bench_cohorts", f"appointer:{apid}", f"Federal judicial appointments by {ap['name']} (CourtListener people database)", source_url=POSITIONS_URL,
            subtitle=f"{len(plist):,} positions · {first.year if first else '?'}–{last.year if last else '?'} · party on record: {party or 'Not recorded'}",
            cells={"kind": "appointer", "name": ap["name"], "party": party, "positions": len(plist), "first_year": first.year if first else None,
                   "last_year": last.year if last else None, "women_pct": stats["women_pct"], "median_confirmation_days": stats["median_days_nomination_to_confirmation"],
                   "median_tenure_years": stats["median_tenure_years_ended"]},
            badges=["CourtListener people database", "Federal courts"],
            facts=facts([("Appointing president (as recorded)", ap["name"]), ("Party on record", party), ("Federal judicial positions filled by presidential appointment", f"{len(plist):,}"),
                         ("People", f"{stats['persons']:,}"), ("First / last start date", f"{first} / {last}"),
                         ("Women among appointees (gender recorded)", f"{stats['women_pct']}% of {stats['gender_recorded']:,}" if stats["women_pct"] is not None else None),
                         ("Median days from nomination to confirmation", f"{stats['median_days_nomination_to_confirmation']:.0f} (n = {stats['with_confirmation_dates']:,})" if stats["median_days_nomination_to_confirmation"] is not None else None),
                         ("Median years served, positions that ended", f"{stats['median_tenure_years_ended']:.1f} (n = {stats['ended']:,})" if stats["median_tenure_years_ended"] is not None else None),
                         ("Counting", "A position counts once per court seat held; a judge elevated to another court counts for each appointment.")]),
            text=f"federal judicial appointments {ap['name']}", filters={"kind": ["appointer"], "party": [party or "unknown"]},
            links=[{"label": "CourtListener people bulk data", "url": PEOPLE_URL}], extra={"profile": {"appointer_person_id": apid, "name": ap["name"], "party": party, **stats,
                   "by_year": [{"year": y, "positions": n} for y, n in sorted(Counter(p["start"].year for p in plist if p["start"]).items())]}}))
    for dec in sorted({cc.decade(p["start"]) for p in fed if p["start"]}):
        plist = [p for p in fed if p["start"] and cc.decade(p["start"]) == dec]
        stats = cohort_stats(plist)
        c_rows.append(writer.record(
            "clb_bench_cohorts", f"decade:{dec}", f"Federal judicial positions started in the {dec}s (CourtListener people database)", source_url=POSITIONS_URL,
            subtitle=f"{len(plist):,} positions", cells={"kind": "decade", "name": f"{dec}s", "party": None, "positions": len(plist), "first_year": dec, "last_year": dec + 9,
                                                         "women_pct": stats["women_pct"], "median_confirmation_days": stats["median_days_nomination_to_confirmation"],
                                                         "median_tenure_years": stats["median_tenure_years_ended"]},
            badges=["CourtListener people database", "Federal courts"],
            facts=facts([("Decade of start date", f"{dec}s"), ("Federal judicial positions started", f"{len(plist):,}"),
                         ("Women (gender recorded)", f"{stats['women_pct']}% of {stats['gender_recorded']:,}" if stats["women_pct"] is not None else None),
                         ("Median days nomination to confirmation", f"{stats['median_days_nomination_to_confirmation']:.0f}" if stats["median_days_nomination_to_confirmation"] is not None else None)]),
            text=f"federal judicial positions {dec}s", filters={"kind": ["decade"]}, links=[{"label": "CourtListener positions bulk data", "url": POSITIONS_URL}],
            extra={"profile": {"decade": dec, **stats}}))
    school_counts: Counter = Counter()
    school_people: dict = defaultdict(set)
    fed_people = {p["person_id"] for p in fed}
    for pid in fed_people:
        for level, sid in edu.get(pid, []):
            if level in ("jd", "llb") and sid in school_name:
                school_people[sid].add(pid)
    n_with_law = len({pid for sid, s in school_people.items() for pid in s})
    for sid, s in sorted(school_people.items(), key=lambda kv: (-len(kv[1]), school_name[kv[0]]))[:25]:
        c_rows.append(writer.record(
            "clb_bench_cohorts", f"school:{sid}", f"Federal judges with a law degree from {school_name[sid]}", source_url=PEOPLE_URL,
            subtitle=f"{len(s):,} federal judges on record · {cc.share(len(s), n_with_law)}% of those with a recorded law school",
            cells={"kind": "law school", "name": school_name[sid], "party": None, "positions": len(s), "first_year": None, "last_year": None, "women_pct": None,
                   "median_confirmation_days": None, "median_tenure_years": None},
            badges=["CourtListener people database", "Law school"],
            facts=facts([("School (as recorded)", school_name[sid]), ("Federal judges with a JD/LLB from it on record", f"{len(s):,}"),
                         ("Denominator", f"{n_with_law:,} federal judges with a recorded law school out of {len(fed_people):,} on record"),
                         ("Counting", "Each person counts once per school; a person can appear under two schools.")]),
            text=f"federal judges law school {school_name[sid]}", filters={"kind": ["school"]}, links=[{"label": "CourtListener people bulk data", "url": PEOPLE_URL}],
            extra={"profile": {"school_id": sid, "school": school_name[sid], "persons": len(s), "denominator_with_school": n_with_law, "denominator_federal": len(fed_people)}}))
    for code in sorted({courts[p["court_id"]]["jurisdiction"] for p in judicial}):
        plist = [p for p in judicial if courts[p["court_id"]]["jurisdiction"] == code]
        stats = cohort_stats(plist)
        courts_n = len({p["court_id"] for p in plist})
        c_rows.append(writer.record(
            "clb_bench_cohorts", f"level:{code}", f"{cc.JURISDICTION_LABEL.get(code, code)} courts: judicial positions on record", source_url=POSITIONS_URL,
            subtitle=f"{len(plist):,} positions across {courts_n:,} courts", cells={"kind": "court level", "name": cc.JURISDICTION_LABEL.get(code, code), "party": None, "positions": len(plist),
                                                                                  "first_year": None, "last_year": None, "women_pct": stats["women_pct"],
                                                                                  "median_confirmation_days": stats["median_days_nomination_to_confirmation"], "median_tenure_years": stats["median_tenure_years_ended"]},
            badges=["CourtListener people database"],
            facts=facts([("Court level (as coded)", f"{cc.JURISDICTION_LABEL.get(code, code)} ({code})"), ("Courts with positions", f"{courts_n:,}"), ("Positions on record", f"{len(plist):,}"),
                         ("Positions with no recorded end date", f"{stats['still_without_end']:,}"),
                         ("Women (gender recorded)", f"{stats['women_pct']}% of {stats['gender_recorded']:,}" if stats["women_pct"] is not None else None),
                         ("Coverage", "State-level data is partial; counts are positions on record.")]),
            text=f"court level {code} judges", filters={"kind": ["court level"]}, links=[{"label": "CourtListener positions bulk data", "url": POSITIONS_URL}],
            extra={"profile": {"code": code, "courts": courts_n, **stats}}))
    persons_n = len(persons)
    out["clb_bench_cohorts"] = {
        "label": "Federal bench cohorts: appointing presidents, decades, law schools and court levels (CourtListener people database)",
        "listing": writer.listing([("kind", "Cohort type"), ("name", "Cohort"), ("party", "Party on record"), ("positions", "Positions / people"), ("first_year", "From"), ("last_year", "To"),
                                   ("women_pct", "Women %"), ("median_confirmation_days", "Median days to confirmation"), ("median_tenure_years", "Median years served (ended)")],
                                  [("kind", "Cohort type", {"appointer": "Appointing president", "decade": "Decade", "school": "Law school", "court level": "Court level"})]),
        "summary": {"source": "CourtListener bulk data people-db-positions, people-db-people, people-db-educations, people-db-schools, people-db-political-affiliations, courts", "snapshot": cc.SNAPSHOT,
                    "terms": "CourtListener publishes these bulk files for download without an account; see https://www.courtlistener.com/terms/.",
                    "totals": {"people": persons_n, "positions": len(positions), "judicial_positions": len(judicial), "federal_judicial_positions": len(fed), "federal_presidential_appointments": len(fed_pres),
                               "federal_people": len(fed_people)},
                    "definitions": {"federal courts": "courts coded F, FD, FB, FBP or FS", "appointer": "the person whose position the judge's position record names as appointer",
                                    "confirmation days": "date_confirmation minus date_nominated where both are recorded and ordered",
                                    "party": "the appointer's political-affiliation record in force at the first appointment (else the earliest recorded); only Democratic and Republican are labelled, other codes are shown as stored"},
                    "caveats": ["Party and gender are recorded for part of the people; shares use only recorded values.", "These are descriptive cohort statistics, not causal comparisons."],
                    "grain": "appointer, decade, law-school and court-level cohorts"},
        "rows": c_rows}
    for ds, spec in out.items():
        spec.update({"dataset": ds, "built_at": built_at, "inputs": inputs, "listing_block": spec.pop("listing")})
    return out


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    out = build()
    for ds, spec in out.items():
        payload = {"dataset": ds, "label": spec["label"], "listing_block": spec["listing_block"], "summary": spec["summary"], "rows": spec["rows"],
                   "built_at": spec["built_at"], "inputs": spec["inputs"]}
        path = os.path.join(OUT, ds + ".json")
        with open(path + ".tmp", "w") as h:
            json.dump(payload, h, ensure_ascii=False, sort_keys=True, default=str)
        os.replace(path + ".tmp", path)
        print(ds, len(spec["rows"]), "rows", os.path.getsize(path) // 1024, "KB")


if __name__ == "__main__":
    main()
