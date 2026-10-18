"""Build clb_judge_dockets: judge-level statistics from the CourtListener docket collection (and opinion authorship when loaded).

A judge is a CourtListener people-database person id. Dockets are attributed through the docket's assigned_to_id (district judge) and
referred_to_id (magistrate judge) fields exactly as recorded; nothing is matched by name. The numbers describe dockets in the
collection, not a judge's full caseload: RECAP dockets exist when someone fetched or shared them. Opinion authorship (author_id on
opinions) is added when the opinion table has been loaded.
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
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment", "fjc_idb"))
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import build_clb_courts as bc  # noqa: E402
import clb_common as cc  # noqa: E402
import corpus_writer as writer  # noqa: E402
import duckdb  # noqa: E402
import idb_codes  # noqa: E402

DB = bc.DB
OUT = bc.OUT
DATASET = "clb_judge_dockets"
MIN_DOCKETS = 10
MIN_OPINIONS = 10
OPINION_TYPE_LABEL = {
    "010combined": "Combined opinion", "015unamimous": "Unanimous opinion", "020lead": "Lead opinion", "025plurality": "Plurality opinion",
    "030concurrence": "Concurrence", "035concurrenceinpart": "Concurrence in part", "040dissent": "Dissent", "050addendum": "Addendum",
    "060remittitur": "Remittitur", "070rehearing": "Rehearing", "080onthemerits": "On the merits", "090onfurtherreconsideration": "On further reconsideration",
    "100trialcourt": "Trial court document",
}
LEAD_TYPES = {"010combined", "015unamimous", "020lead", "025plurality", "080onthemerits"}


def has_table(con, name: str) -> bool:
    return bool(con.execute("SELECT count(*) FROM information_schema.tables WHERE table_name = ?", [name]).fetchone()[0])


def build() -> dict[str, dict]:
    con = duckdb.connect(os.path.join(DB, "work.duckdb"), read_only=True)
    sm = duckdb.connect(os.path.join(DB, "small.duckdb"), read_only=True)
    spine = bc.lookup("court_spine")
    spine_ids = set(spine["ids"])
    cl_people_ids = set(bc.lookup("cl_people")["ids"])
    courts = {r[0]: {"name": r[1] or r[0], "jur": r[2]} for r in sm.execute("SELECT id, full_name, jurisdiction FROM courts").fetchall()}
    persons = {}
    for r in sm.execute("SELECT id, name_first, name_middle, name_last, name_suffix, fjc_id, date_dod, is_alias_of_id FROM person").fetchall():
        persons[int(r[0])] = {"name": cc.full_name(r[1], r[2], r[3], r[4]), "fjc_id": r[5], "dod": cc.parse_date(r[6]), "alias_of": int(r[7]) if r[7] else None}
    pos_cols = ("id", "person_id", "court_id", "position_type", "job_title", "date_start", "date_termination", "how_selected", "appointer_id")
    positions = defaultdict(list)
    by_pos_id = {}
    for r in sm.execute(f"SELECT {', '.join(pos_cols)} FROM position").fetchall():
        p = dict(zip(pos_cols, r))
        by_pos_id[p["id"]] = p
        if p["position_type"] in cc.JUDICIAL_POSITIONS and p["court_id"] in courts:
            p["start"], p["end"] = cc.parse_date(p["date_start"]), cc.parse_date(p["date_termination"])
            positions[int(p["person_id"])].append(p)

    w_judge = bc.by(con, "SELECT * FROM w_court_judge", "judge_id")
    w_ref = bc.by(con, "SELECT * FROM w_court_referred", "judge_id")
    w_year = bc.by(con, "SELECT * FROM w_judge_year ORDER BY judge_id, yr", "judge_id")
    w_nos = bc.by(con, "SELECT * FROM w_judge_nos", "judge_id")
    w_dur = bc.one(con, "SELECT * FROM w_judge_dur")
    w_mdl = bc.one(con, "SELECT * FROM w_judge_mdl")
    has_auth = has_table(con, "w_author")
    w_auth = bc.by(con, "SELECT * FROM w_author", "author_id") if has_auth else {}
    w_auth_year = bc.by(con, "SELECT * FROM w_author_year ORDER BY author_id, yr", "author_id") if has_auth else {}
    w_auth_cite = bc.one(con, "SELECT * FROM w_author_cites") if has_auth and has_table(con, "w_author_cites") else {}

    built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    inputs = [{"url": u, "path": f"CourtListener bulk file {u.rsplit('/', 1)[1]} (slim tables in private/acq/courtlistener/db)", "sha256": None}
              for u in (bc.DOCKETS_URL, bc.CLUSTERS_URL, bc.COURTS_URL, cc.BULK_BASE + "people-db-people-2026-09-30.csv.bz2", cc.BULK_BASE + "people-db-positions-2026-09-30.csv.bz2")]

    def cname(cid):
        return courts.get(cid, {}).get("name", cid)

    def link(cid):
        return f"/courts/{cid}" if cid in spine_ids else None

    ids = sorted({int(k) for k in w_judge} | ({int(k) for k in w_auth} if has_auth else set()))
    rows = []
    kept = 0
    for pid in ids:
        assigned = w_judge.get(pid, [])
        n_assigned = sum(r["n"] for r in assigned)
        authored = w_auth.get(pid, [])
        n_authored = sum(r["n"] for r in authored)
        if n_assigned < MIN_DOCKETS and n_authored < MIN_OPINIONS:
            continue
        person = persons.get(pid)
        if not person:
            continue
        kept += 1
        name = person["name"]
        pos = sorted(positions.get(pid, []), key=lambda p: (p["start"] or cc.SNAPSHOT_DATE, p["id"]))
        pos_view = []
        for p in pos[:8]:
            ap = by_pos_id.get(p["appointer_id"]) if p["appointer_id"] else None
            ap_name = persons.get(int(ap["person_id"]), {}).get("name") if ap else None
            pos_view.append({"court_id": p["court_id"], "court": cname(p["court_id"]), "position": cc.POSITION_LABEL.get(p["position_type"], p["position_type"]), "start": str(p["start"]) if p["start"] else None,
                             "end": str(p["end"]) if p["end"] else None, "selected": cc.HOW_SELECTED_LABEL.get(p["how_selected"], p["how_selected"]), "appointer": ap_name, "link": link(p["court_id"])})
        by_court = Counter({r["court_id"]: r["n"] for r in assigned})
        courts_view = [{"court_id": r["court_id"], "name": cname(r["court_id"]), "dockets": r["n"], "terminated": r["n_term"], "first_filed": bc.day(r["first_filed"]), "last_filed": bc.day(r["last_filed"]),
                        "link": link(r["court_id"])} for r in sorted(assigned, key=lambda r: (-r["n"], r["court_id"]))[:8]]
        years = [{"yr": int(r["yr"]), "dockets": r["n"], "terminated": r["n_term"]} for r in w_year.get(pid, []) if r["yr"] and 1900 <= r["yr"] <= 2026]
        grp_counts = Counter()
        for r in w_nos.get(pid, []):
            grp_counts[r["grp"]] += r["n"]
        grp_total = sum(n for g, n in grp_counts.items() if g != "none")
        groups = bc.shares([(g, n) for g, n in grp_counts.items() if g != "none"], grp_total, 10, idb_codes.GROUP_LABEL)
        dur = w_dur.get(pid)
        duration = {"n": dur["n"], "p25_days": cc.r1(dur["p25"]), "median_days": cc.r1(dur["p50"]), "p75_days": cc.r1(dur["p75"])} if dur and dur["n"] >= 30 else None
        mdl = w_mdl.get(pid) or {}
        ref = w_ref.get(pid, [])
        n_ref = sum(r["n"] for r in ref)
        first_year = min((y["yr"] for y in years), default=None)
        last_year = max((y["yr"] for y in years), default=None)
        terminated = sum(r["n_term"] for r in assigned)
        opinions = None
        if authored:
            tot = n_authored
            by_type = Counter()
            for r in authored:
                by_type[r["type"]] += r["n"]
            lead = sum(n for t, n in by_type.items() if t in LEAD_TYPES)
            by_court_o = Counter()
            for r in authored:
                by_court_o[r["court_id"]] += r["n"]
            opinions = {"authored": tot, "per_curiam": sum(r["per_curiam"] for r in authored), "lead_or_combined": lead,
                        "types": bc.shares([(t, n) for t, n in by_type.items()], tot, 8, OPINION_TYPE_LABEL),
                        "courts": [{"court_id": c, "name": cname(c), "opinions": n, "link": link(c)} for c, n in by_court_o.most_common(6)],
                        "by_year": [{"yr": int(r["yr"]), "opinions": r["n"]} for r in w_auth_year.get(pid, []) if r["yr"] and 1700 <= r["yr"] <= 2026],
                        "first_filed": bc.day(min((r["first_filed"] for r in authored if r["first_filed"]), default=None)),
                        "last_filed": bc.day(max((r["last_filed"] for r in authored if r["last_filed"]), default=None))}
            ac = w_auth_cite.get(pid)
            if ac:
                opinions["clusters_with_lead_opinion"] = ac["clusters"]
                opinions["times_cited_total"] = int(ac["cites"] or 0)
                opinions["times_cited_median"] = cc.r1(ac["p50"])
        active = any(p["start"] and not p["end"] for p in pos) and person["dod"] is None
        main_court = by_court.most_common(1)[0][0] if by_court else (max(Counter({r["court_id"]: r["n"] for r in authored}).items(), key=lambda kv: kv[1])[0] if authored else None)
        profile = {"person_id": pid, "name": name, "fjc_id": person["fjc_id"], "alias_of": person["alias_of"], "positions": pos_view, "active_no_recorded_end": active,
                   "dockets": {"assigned": n_assigned, "terminated": terminated, "terminated_pct": cc.share(terminated, n_assigned), "first_year": first_year, "last_year": last_year,
                               "courts": courts_view, "by_year": years, "nos_groups": groups, "nos_recorded": grp_total, "civil_numbered": (w_mdl.get(pid) or {}).get("civil"), "criminal_numbered": (w_mdl.get(pid) or {}).get("criminal"),
                               "recap_pct": cc.share(mdl.get("recap", 0), n_assigned), "mdl_flagged": mdl.get("mdl_flagged", 0), "duration_civil": duration} if n_assigned else None,
                   "referred": {"dockets": n_ref, "courts": [{"court_id": r["court_id"], "name": cname(r["court_id"]), "dockets": r["n"], "link": link(r["court_id"])} for r in sorted(ref, key=lambda r: (-r["n"], r["court_id"]))[:4]]} if n_ref else None,
                   "opinions": opinions}
        rec_link = f"/records/cl_people/cl:people:{pid}" if f"cl:people:{pid}" in cl_people_ids else None
        links = ([{"label": "Judge profile record", "url": rec_link}] if rec_link else []) + [{"label": "CourtListener person page", "url": f"https://www.courtlistener.com/person/{pid}/"}]
        if main_court and link(main_court):
            links.append({"label": "Court profile", "url": link(main_court)})
        rows.append(writer.record(
            DATASET, str(pid), f"{name}: dockets and opinions in CourtListener's collection", source_url=bc.DOCKETS_URL,
            subtitle=(f"{n_assigned:,} assigned dockets" if n_assigned else "") + (" · " if n_assigned and n_authored else "") + (f"{n_authored:,} opinions authored" if n_authored else "") + f" · main court: {cname(main_court)}" if main_court else name,
            cells={"judge": name, "court": cname(main_court) if main_court else None, "dockets": n_assigned or None, "terminated_pct": cc.share(terminated, n_assigned) if n_assigned else None,
                   "civil": (w_mdl.get(pid) or {}).get("civil") if n_assigned else None, "criminal": (w_mdl.get(pid) or {}).get("criminal") if n_assigned else None,
                   "median_days_civil": duration["median_days"] if duration else None, "first_year": first_year, "last_year": last_year, "opinions": n_authored or None,
                   "referred": n_ref or None},
            badges=["CourtListener bulk data", "Collection, not complete caseload"],
            facts=bc.facts([("Judge (CourtListener people id)", f"{name} ({pid})"), ("Positions on record", "; ".join(f"{p['position']}, {p['court']} ({p['start'] or '?'}–{p['end'] or 'no end date'})" for p in pos_view[:4]) or None),
                            ("Dockets assigned in the collection", f"{n_assigned:,}" if n_assigned else None),
                            ("Years of those dockets", f"{first_year}–{last_year}" if first_year else None),
                            ("Terminated (termination date recorded)", f"{terminated:,} ({cc.share(terminated, n_assigned)}%)" if n_assigned else None),
                            ("Median days filing to termination, civil dockets with both dates", f"{duration['median_days']:,.0f} (n = {duration['n']:,})" if duration else None),
                            ("Dockets referred to this judge (magistrate)", f"{n_ref:,}" if n_ref else None),
                            ("Opinions authored in the collection", f"{n_authored:,}" if n_authored else None),
                            ("Counting", "Dockets are attributed through the assigned_to and referred_to person ids exactly as recorded; the collection is not a complete caseload.")]),
            text=f"judge {name} {pid} dockets opinions", filters={"court": [main_court or "unknown"], "active": ["yes" if active else "no"]}, links=links, extra={"profile": profile}))
    summary = {
        "source": "CourtListener bulk data: dockets, opinions, people (Free Law Project)", "snapshot": cc.SNAPSHOT,
        "terms": "CourtListener publishes these bulk files for download without an account; see https://www.courtlistener.com/terms/ and the bulk-data help page.",
        "totals": {"judges": len(rows), "persons_with_assigned_dockets": len(w_judge), "min_assigned_dockets_to_list": MIN_DOCKETS, "min_opinions_to_list": MIN_OPINIONS, "opinion_authorship_loaded": bool(has_auth)},
        "definitions": {"assigned": "docket.assigned_to_id equals the person id", "referred": "docket.referred_to_id equals the person id (magistrate judge referrals)",
                        "duration": "days from date_filed to date_terminated for civil-numbered dockets (docket number contains -cv-) with both dates and termination on or after filing; shown for n >= 30",
                        "terminated": "date_terminated recorded within 1700-2026-09-30", "authored": "opinion.author_id equals the person id; per curiam opinions have no author unless one is recorded"},
        "caveats": ["Dockets in the collection are not a judge's complete caseload; RECAP coverage differs by court and year.",
                    "Dockets are reassigned between judges, so the filing year of an assigned docket can be earlier than the judge's service; first and last year are the earliest and latest filing years of assigned dockets.", "Person ids that CourtListener records as aliases of another person are not merged.",
                    "Statistics are descriptive; they do not measure judge performance or outcomes."],
        "grain": "one record per person with at least 10 assigned dockets or 10 authored opinions"}
    return {DATASET: {
        "dataset": DATASET, "label": "Judge-level dockets and opinions in CourtListener's collection (Sept 30, 2026)",
        "listing_block": writer.listing([("judge", "Judge"), ("court", "Main court"), ("dockets", "Assigned dockets"), ("terminated_pct", "Terminated %"), ("civil", "Civil-numbered"), ("criminal", "Criminal-numbered"),
                                         ("median_days_civil", "Median days, civil"), ("first_year", "Earliest docket year"), ("last_year", "Latest docket year"), ("opinions", "Opinions authored"), ("referred", "Referred dockets")],
                                        [("active", "No recorded end date", {"yes": "Yes", "no": "No"})]),
        "summary": summary, "rows": rows, "built_at": built_at, "inputs": inputs}}


def main() -> None:
    os.makedirs(OUT, exist_ok=True)
    out = build()
    for ds, spec in out.items():
        path = os.path.join(OUT, ds + ".json")
        with open(path + ".tmp", "w") as h:
            json.dump(spec, h, ensure_ascii=False, sort_keys=True, default=str)
        os.replace(path + ".tmp", path)
        print(ds, len(spec["rows"]), "rows", os.path.getsize(path) // 1024, "KB")


if __name__ == "__main__":
    main()
