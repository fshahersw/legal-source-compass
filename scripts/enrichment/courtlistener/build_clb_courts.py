"""Build clb_court_profiles: court-by-court statistics from CourtListener's bulk docket, opinion-cluster, citation and oral-argument tables.

Input: private/acq/courtlistener/db/work.duckdb (build_clb_work.py), small.duckdb (courts, people), the FJC civil district series
(private/build/fjc_idb/fjc_civil_districts.json) and the published bench dataset. Every figure counts rows in CourtListener's collection
(snapshot 2026-09-30). The collection is not a census of court filings: RECAP dockets exist when someone fetched or shared them, and
state and appellate coverage differs by court. Ratios against official filing counts are coverage indicators, not rates.
"""
from __future__ import annotations

import json
import os
import sys
import time
from collections import defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment"))
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment", "fjc_idb"))
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import clb_common as cc  # noqa: E402
import corpus_writer as writer  # noqa: E402
import duckdb  # noqa: E402
import idb_codes  # noqa: E402

DB = os.path.join(ROOT, "private", "acq", "courtlistener", "db")
OUT = os.path.join(ROOT, "private", "build", "courtlistener")
LOOK = os.path.join(ROOT, "private", "build", "fjc_idb", "lookups")
DATASET = "clb_court_profiles"
DOCKETS_URL = cc.BULK_BASE + "dockets-2026-09-30.csv.bz2"
CLUSTERS_URL = cc.BULK_BASE + "opinion-clusters-2026-09-30.csv.bz2"
COURTS_URL = cc.BULK_BASE + "courts-2026-09-30.csv.bz2"
CITATIONS_URL = cc.BULK_BASE + "citations-2026-09-30.csv.bz2"
ORAL_URL = cc.BULK_BASE + "oral-arguments-2026-09-30.csv.bz2"
STATES_WITH_PAGE = set(
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split()
)
MIN_YEAR = 1800
TOP = 8
FY_FIRST = 2000


def lookup(name: str) -> dict:
    return json.load(open(os.path.join(LOOK, name + ".json")))


def facts(pairs):
    return [[k, "Not recorded" if v is None else str(v)] for k, v in pairs]


def by(con, sql: str, key: str = "court_id") -> dict:
    """Group result rows (as dicts) by one column."""
    cur = con.execute(sql)
    cols = [d[0] for d in cur.description]
    out: dict = defaultdict(list)
    for row in cur.fetchall():
        rec = dict(zip(cols, row))
        out[rec[key]].append(rec)
    return out


def one(con, sql: str) -> dict:
    cur = con.execute(sql)
    cols = [d[0] for d in cur.description]
    return {r[0]: dict(zip(cols, r)) for r in cur.fetchall()}


def shares(items, total: int, limit: int = TOP, labels: dict | None = None, extra_label=None) -> list[dict]:
    return cc.shares(items, total, limit, labels, extra_label)


def day(d) -> str | None:
    return None if d is None else str(d)


def build() -> dict[str, dict]:
    con = duckdb.connect(os.path.join(DB, "work.duckdb"), read_only=True)
    sm = duckdb.connect(os.path.join(DB, "small.duckdb"), read_only=True)
    spine = lookup("court_spine")
    spine_ids, spine_state = set(spine["ids"]), spine["state"]
    cl_people_ids = set(lookup("cl_people")["ids"])
    cur = sm.execute("SELECT id, full_name, short_name, citation_string, jurisdiction, in_use, start_date, end_date, parent_court_id, pacer_court_id, fjc_court_id FROM courts")
    courts = {r[0]: dict(zip(("id", "full_name", "short_name", "citation_string", "jurisdiction", "in_use", "start_date", "end_date", "parent_court_id", "pacer_court_id", "fjc_court_id"), r))
              for r in cur.fetchall()}
    persons = {int(r[0]): cc.full_name(r[1], r[2], r[3], r[4]) for r in sm.execute("SELECT id, name_first, name_middle, name_last, name_suffix FROM person").fetchall()}

    w_court = one(con, "SELECT * FROM w_court")
    w_year = by(con, "SELECT * FROM w_court_year ORDER BY court_id, yr")
    w_source = by(con, "SELECT * FROM w_court_source")
    w_ctype = by(con, "SELECT * FROM w_court_casetype")
    w_nos = by(con, "SELECT * FROM w_court_nos")
    w_cause = by(con, "SELECT * FROM w_court_cause")
    w_jt = by(con, "SELECT * FROM w_court_jt")
    w_jury = by(con, "SELECT * FROM w_court_jury")
    w_dur = by(con, "SELECT * FROM w_court_dur")
    w_fy = by(con, "SELECT * FROM w_court_fy_cv ORDER BY court_id, fy")
    w_judge = by(con, "SELECT * FROM w_court_judge")
    w_ref = by(con, "SELECT * FROM w_court_referred")
    w_appeal = by(con, "SELECT * FROM w_appeal")
    c_court = one(con, "SELECT * FROM w_cl_court")
    c_year = by(con, "SELECT * FROM w_cl_court_year ORDER BY court_id, yr")
    c_prec = by(con, "SELECT * FROM w_cl_court_prec")
    c_top = by(con, "SELECT * FROM w_cl_top ORDER BY court_id, rn")
    c_rep = by(con, "SELECT * FROM w_cl_reporter")
    c_cov = one(con, "SELECT * FROM w_cl_cov")
    o_court = one(con, "SELECT * FROM w_oral_court")
    o_year = by(con, "SELECT * FROM w_oral_year ORDER BY court_id, yr")
    has_ops = bool(con.execute("SELECT count(*) FROM information_schema.tables WHERE table_name = 'w_court_op'").fetchone()[0])
    op_court = by(con, "SELECT * FROM w_court_op") if has_ops else {}
    cite_out = by(con, "SELECT citing_court AS court_id, cited_court, n FROM w_cite_flow") if has_ops and con.execute("SELECT count(*) FROM information_schema.tables WHERE table_name = 'w_cite_flow'").fetchone()[0] else {}
    cite_in = defaultdict(list)
    for citing, rows in cite_out.items():
        for r in rows:
            cite_in[r["cited_court"]].append({"citing_court": citing, "n": r["n"]})
    scotus_year = [dict(zip(("yr", "clusters", "scdb", "unanimous", "five_four", "with_votes", "dir_conservative", "dir_liberal", "dir_unspecifiable"), r))
                   for r in con.execute("SELECT yr, clusters, scdb, unanimous, five_four, with_votes, dir_conservative, dir_liberal, dir_unspecifiable FROM w_scotus_year ORDER BY yr").fetchall()]

    fjc = {r["id"]: r["item"]["profile"] for r in json.load(open(os.path.join(ROOT, "private", "build", "fjc_idb", "fjc_civil_districts.json")))["rows"]}
    benches = {r["id"]: r["item"]["profile"] for r in json.load(open(os.path.join(OUT, "clb_court_benches.json")))["rows"]}
    built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    inputs = [{"url": u, "path": f"CourtListener bulk file {u.rsplit('/', 1)[1]} (slim tables in private/acq/courtlistener/db)", "sha256": None}
              for u in (DOCKETS_URL, CLUSTERS_URL, CITATIONS_URL, ORAL_URL, COURTS_URL)]

    def cname(cid: str) -> str:
        c = courts.get(cid)
        return (c["full_name"] if c and c["full_name"] else None) or cid

    def court_link(cid: str):
        return f"/courts/{cid}" if cid in spine_ids else None

    ids = sorted(i for i in set(w_court) | set(c_court) | set(o_court) | set(benches) if i and i in courts)
    rows = []
    totals = {"dockets": sum(v["dockets"] for v in w_court.values()), "clusters": sum(v["clusters"] for k, v in c_court.items()), "oral": sum(v["n"] for v in o_court.values())}

    for cid in ids:
        court = courts[cid]
        jur = court["jurisdiction"]
        wc = w_court.get(cid)
        cc_ = c_court.get(cid)
        oc = o_court.get(cid)
        state = spine_state.get(cid)
        name = cname(cid)

        docket = None
        if wc:
            n = wc["dockets"]
            years = [{"yr": int(r["yr"]), "dockets": r["dockets"], "civil": r["civil"], "criminal": r["criminal"], "recap": r["recap"], "terminated": r["terminated"]}
                     for r in w_year.get(cid, []) if r["yr"] and MIN_YEAR <= r["yr"] <= 2026]
            src_items = [(r["source"], r["n"]) for r in w_source.get(cid, [])]
            ctypes = [(r["case_type"], r["n"]) for r in w_ctype.get(cid, [])]
            nos_rows = w_nos.get(cid, [])
            nos_total = sum(r["n"] for r in nos_rows)
            grp_counts: dict = defaultdict(int)
            for r in nos_rows:
                g = idb_codes.NOS_TO_GROUP.get(r["nos_code"]) if r["nos_code"] is not None else None
                grp_counts[g or ("unmapped" if r["nos_code"] is not None else "none")] += r["n"]
            top_nos = shares([(r["nos_text"], r["n"]) for r in nos_rows], nos_total)
            groups = shares([(g, n_) for g, n_ in grp_counts.items() if g != "none"], nos_total, 20, idb_codes.GROUP_LABEL)
            causes = shares([(r["cause"], r["n"]) for r in w_cause.get(cid, [])], wc["with_cause"])
            jts = shares([(r["jurisdiction_type"], r["n"]) for r in w_jt.get(cid, [])], sum(r["n"] for r in w_jt.get(cid, [])))
            jury = shares([(r["jury_demand"], r["n"]) for r in w_jury.get(cid, [])], sum(r["n"] for r in w_jury.get(cid, [])))
            dur = {}
            for r in w_dur.get(cid, []):
                if r["n"] >= 30:
                    dur["civil" if r["scope"] == "cv" else r["scope"]] = {"n": r["n"], "p25_days": cc.r1(r["p25"]), "median_days": cc.r1(r["p50"]), "p75_days": cc.r1(r["p75"]), "p90_days": cc.r1(r["p90"])}
            judges = [{"person_id": int(r["judge_id"]), "name": persons.get(int(r["judge_id"]), "Name not recorded"), "dockets": r["n"], "terminated": r["n_term"],
                       "first_filed": day(r["first_filed"]), "last_filed": day(r["last_filed"]),
                       "record": f"/records/cl_people/cl:people:{int(r['judge_id'])}" if f"cl:people:{int(r['judge_id'])}" in cl_people_ids else None}
                      for r in sorted(w_judge.get(cid, []), key=lambda r: (-r["n"], r["judge_id"]))[:10]]
            referred = [{"person_id": int(r["judge_id"]), "name": persons.get(int(r["judge_id"]), "Name not recorded"), "dockets": r["n"]}
                        for r in sorted(w_ref.get(cid, []), key=lambda r: (-r["n"], r["judge_id"]))[:5]]
            origins = [{"court_id": r["from_court"], "name": cname(r["from_court"]) if r["from_court"] in courts else r["from_court"], "dockets": r["n"],
                        "share_pct": cc.share(r["n"], wc["with_appeal_from"]), "link": court_link(r["from_court"])}
                       for r in sorted(w_appeal.get(cid, []), key=lambda r: (-r["n"], str(r["from_court"])))[:TOP]]
            docket = {
                "total": n, "dated": wc["dated"], "no_filed_date": wc["no_filed_date"], "implausible_filed": wc["implausible_filed"],
                "first_filed": day(wc["first_filed"]), "last_filed": day(wc["last_filed"]), "terminated": wc["terminated"],
                "terminated_pct": cc.share(wc["terminated"], wc["dated"]), "recap": wc["recap"], "recap_pct": cc.share(wc["recap"], n),
                "with_assigned_judge": wc["with_assigned"], "with_assigned_pct": cc.share(wc["with_assigned"], n),
                "with_fjc_record": wc["with_idb"], "with_fjc_record_pct": cc.share(wc["with_idb"], n),
                "with_nature_of_suit": wc["with_nos"], "with_cause": wc["with_cause"], "mdl_flagged": wc["mdl_flagged"], "blocked": wc["blocked"],
                "with_appeal_from": wc["with_appeal_from"], "with_origin_info": wc["with_origin_info"],
                "by_year": years,
                "sources": [{**s, "flags": cc.source_flags(s["value"] if isinstance(s["value"], int) else int(s["value"]))} for s in shares(src_items, n, 8)],
                "case_types": shares(ctypes, n, 8), "case_type_not_recorded": n - sum(c for v, c in ctypes if v not in (None, "")),
                "nos_groups": groups, "top_nos": top_nos, "nos_recorded": nos_total, "top_causes": causes,
                "jurisdiction_types": jts, "jury_demand": jury, "duration": dur, "judges_assigned": judges, "judges_referred": referred, "appeal_from": origins,
            }

        clusters = None
        if cc_:
            cn = cc_["clusters"]
            reporters = shares([(r["reporter"], r["n"]) for r in c_rep.get(cid, [])], sum(r["n"] for r in c_rep.get(cid, [])), 6)
            clusters = {
                "total": cn, "dated": cc_["dated"], "first_filed": day(cc_["first_filed"]), "last_filed": day(cc_["last_filed"]),
                "by_year": [{"yr": int(r["yr"]), "clusters": r["clusters"], "cited": r["cited"], "cite_total": int(r["cite_total"] or 0)} for r in c_year.get(cid, []) if r["yr"] and MIN_YEAR <= r["yr"] <= 2026],
                "precedential": shares([(r["prec"], r["n"]) for r in c_prec.get(cid, [])], cn, 6),
                "cited": cc_["cited"], "cited_pct": cc.share(cc_["cited"], cn), "cite_total": int(cc_["cite_total"] or 0), "cite_max": cc_["cite_max"],
                "cite_median_among_cited": cc.r1(cc_["cite_p50_cited"]), "cite_p90_among_cited": cc.r1(cc_["cite_p90_cited"]), "cite_p99_among_cited": cc.r1(cc_["cite_p99_cited"]),
                "top_cited": [{"cluster_id": r["cid"], "docket_id": r["docket_id"], "case_name": r["case_name"], "date_filed": day(r["filed"]), "times_cited": r["cites"],
                               "url": f"https://www.courtlistener.com/opinion/{r['cid']}/"} for r in c_top.get(cid, [])],
                "reporters": reporters, "with_reporter_cite": (c_cov.get(cid) or {}).get("with_reporter_cite", 0),
                "with_reporter_cite_pct": cc.share((c_cov.get(cid) or {}).get("with_reporter_cite", 0), cn),
                "with_syllabus_pct": cc.share(cc_["with_syllabus"], cn), "with_headnotes_pct": cc.share(cc_["with_headnotes"], cn), "with_summary_pct": cc.share(cc_["with_summary"], cn),
                "with_scdb": cc_["with_scdb"],
            }
            if cid == "scotus":
                clusters["scotus_by_year"] = scotus_year

        oral = None
        if oc:
            oral = {"total": oc["n"], "dockets": oc["dockets"], "first_created": day(oc["first_created"]), "last_created": day(oc["last_created"]),
                    "median_minutes": cc.r1(oc["p50_seconds"] / 60.0) if oc["p50_seconds"] else None, "total_hours": cc.r1(oc["total_seconds"] / 3600.0) if oc["total_seconds"] else None,
                    "with_transcript": oc["with_transcript"], "by_year": [{"yr": int(r["yr"]), "n": r["n"]} for r in o_year.get(cid, []) if r["yr"]]}

        opinions = None
        if op_court.get(cid):
            ops = op_court[cid]
            tot = sum(r["n"] for r in ops)
            opinions = {"total": tot, "types": shares([(r["type"], r["n"]) for r in ops], tot, 10),
                        "with_author_pct": cc.share(sum(r["with_author"] for r in ops), tot), "per_curiam": sum(r["per_curiam"] for r in ops),
                        "ocr_pct": cc.share(sum(r["ocr"] for r in ops), tot), "with_joined_by_pct": cc.share(sum(r["with_joined_by"] for r in ops), tot)}
        citations = None
        if cid in cite_out or cid in cite_in:
            out_rows = cite_out.get(cid, [])
            in_rows = cite_in.get(cid, [])
            out_total = sum(r["n"] for r in out_rows)
            in_total = sum(r["n"] for r in in_rows)
            citations = {
                "cites_made": out_total, "cited_by_others": in_total,
                "cites_made_to": [{"court_id": r["cited_court"], "name": cname(r["cited_court"]) if r["cited_court"] in courts else r["cited_court"], "n": r["n"], "share_pct": cc.share(r["n"], out_total),
                                   "link": court_link(r["cited_court"]) if r["cited_court"] else None} for r in sorted(out_rows, key=lambda r: (-r["n"], str(r["cited_court"]))) if r["cited_court"]][:TOP],
                "cited_by": [{"court_id": r["citing_court"], "name": cname(r["citing_court"]) if r["citing_court"] in courts else r["citing_court"], "n": r["n"], "share_pct": cc.share(r["n"], in_total),
                              "link": court_link(r["citing_court"]) if r["citing_court"] else None} for r in sorted(in_rows, key=lambda r: (-r["n"], str(r["citing_court"]))) if r["citing_court"]][:TOP],
                "self_citation_pct": cc.share(sum(r["n"] for r in out_rows if r["cited_court"] == cid), out_total),
            }

        coverage = None
        f = fjc.get(cid)
        if f and w_fy.get(cid):
            fjc_by_fy = {s["fy"]: s for s in f["series"]}
            cov = []
            for r in w_fy[cid]:
                fy = int(r["fy"]) if r["fy"] else None
                if fy is None or fy < FY_FIRST or fy > f["latest_fy"]:
                    continue
                s = fjc_by_fy.get(fy)
                if not s:
                    continue
                cov.append({"fy": fy, "cl_civil_dockets": r["civil"], "cl_with_fjc_record": r["with_idb"], "fjc_filings": s["filings"],
                            "cl_to_fjc_ratio": cc.ratio(r["civil"], s["filings"]), "matched_to_fjc_ratio": cc.ratio(r["with_idb"], s["filings"])})
            recent = [c for c in cov if f["latest_fy"] - 9 <= c["fy"] <= f["latest_fy"] and c["cl_to_fjc_ratio"] is not None]
            coverage = {"by_fy": cov, "latest_complete_fy": f["latest_fy"],
                        "median_ratio_last_10_fy": cc.r2(cc.median([c["cl_to_fjc_ratio"] for c in recent])) if len(recent) >= 5 else None,
                        "latest_ratio": next((c["cl_to_fjc_ratio"] for c in cov if c["fy"] == f["latest_fy"]), None)}

        bench = benches.get(cid)
        bench_s = {k: bench[k] for k in ("positions", "active", "persons", "women_active_pct", "median_tenure_years_ended")} if bench else None

        d_total = docket["total"] if docket else 0
        c_total = clusters["total"] if clusters else 0
        o_total = oral["total"] if oral else 0
        level = cc.JURISDICTION_LABEL.get(jur, f"Code {jur}")
        links = []
        if court_link(cid):
            links.append({"label": "Court profile", "url": court_link(cid)})
        if state in STATES_WITH_PAGE:
            links.append({"label": f"{state} place profile", "url": f"/places/{state}"})
        if bench:
            links.append({"label": "Judicial positions on record", "url": f"/records/clb_court_benches/{cid}"})
        links.append({"label": "CourtListener court page", "url": f"https://www.courtlistener.com/court/{cid}/"})
        med_civil = (docket or {}).get("duration", {}).get("civil", {}).get("median_days") if docket else None
        # Where a court's records come from opinion sources, CourtListener creates one docket row per opinion cluster: counts then match
        # and the docket count says nothing about cases filed.
        opinion_source = bool(docket and clusters and docket["recap"] == 0 and abs(d_total - c_total) <= 0.05 * max(d_total, c_total))
        latest_ratio = coverage["latest_ratio"] if coverage else None
        span = f"{((docket or {}).get('first_filed') or '')[:4] or '?'}–{((docket or {}).get('last_filed') or '')[:4] or '?'}" if docket else None
        profile = {"court_id": cid, "name": name, "short_name": court["short_name"], "citation_string": court["citation_string"], "jurisdiction": jur, "level": level, "state": state,
                   "in_use": court["in_use"], "start_date": court["start_date"], "end_date": court["end_date"], "parent_court_id": court["parent_court_id"],
                   "pacer_court_id": court["pacer_court_id"], "fjc_court_id": court["fjc_court_id"],
                   "opinion_source_dockets": opinion_source,
                   "dockets": docket, "clusters": clusters, "oral_arguments": oral, "opinions": opinions, "citations": citations, "fjc_coverage": coverage, "bench": bench_s}
        rows.append(writer.record(
            DATASET, cid, f"{name}: dockets, opinions and citations in CourtListener's collection", source_url=DOCKETS_URL, state=state or "",
            subtitle=f"{level} · {d_total:,} dockets · {c_total:,} opinion clusters" + (f" · {o_total:,} oral arguments" if o_total else ""),
            cells={"court": name, "level": level, "state": state, "dockets": d_total, "clusters": c_total, "oral_arguments": o_total,
                   "first_year": int((docket or {}).get("first_filed", "0000")[:4]) if docket and docket.get("first_filed") else None,
                   "recap_pct": docket["recap_pct"] if docket else None, "median_civil_days": med_civil, "fjc_coverage_ratio": latest_ratio,
                   "cited_pct": clusters["cited_pct"] if clusters else None},
            badges=["CourtListener bulk data", level, "Collection, not complete court totals"] + (["Docket rows created from opinions"] if opinion_source else []),
            facts=facts([
                ("Court", name), ("CourtListener court id", cid), ("Level (as coded)", level), ("Dockets in the collection", f"{d_total:,}" if docket else None),
                ("Docket filing dates on record", f"{span} ({docket['dated']:,} dated; {docket['no_filed_date']:,} without a date; {docket['implausible_filed']:,} outside 1700–2026 excluded)" if docket else None),
                ("Dockets from RECAP (PACER) sources", f"{docket['recap']:,} ({docket['recap_pct']}%)" if docket else None),
                ("Dockets with a termination date", f"{docket['terminated']:,} ({docket['terminated_pct']}% of dated)" if docket else None),
                ("Median days filing to termination, civil dockets with both dates", f"{med_civil:,.0f} (n = {docket['duration']['civil']['n']:,})" if med_civil is not None else None),
                ("Dockets with an assigned judge", f"{docket['with_assigned_judge']:,} ({docket['with_assigned_pct']}%)" if docket else None),
                *([("Dockets CourtListener flags as blocked from search engines", f"{docket['blocked']:,} ({cc.share(docket['blocked'], d_total)}%); counted here like any other docket")] if docket and docket["blocked"] else []),
                ("Opinion clusters", f"{c_total:,}" if clusters else None),
                ("Clusters cited at least once by other opinions in the CourtListener citation network", f"{clusters['cited']:,} ({clusters['cited_pct']}%)" if clusters else None),
                ("Oral argument recordings", f"{o_total:,}" if oral else None),
                ("Civil dockets vs FJC civil filings, latest complete fiscal year", f"{latest_ratio:.2f}× (FY{coverage['latest_complete_fy']}; a coverage indicator, not a rate)" if latest_ratio is not None else None),
                ("Judicial positions on record", f"{bench['positions']:,} ({bench['active']:,} with no recorded end date)" if bench else None),
                *([("Docket rows", "CourtListener created one docket row for each opinion cluster here (no RECAP source, counts match), so the docket count is not a count of cases filed.")] if opinion_source else []),
                ("Coverage", "Counts are rows in CourtListener's collection (snapshot 2026-09-30), not complete court totals. RECAP dockets exist when someone fetched or shared them; coverage differs by court and year."),
            ]),
            text=f"{name} {cid} court dockets opinions clusters citations oral arguments {state or ''}", filters={"level": [jur or "unknown"], "state": [state or "unknown"]},
            links=links, extra={"profile": profile}))
    unmatched_clusters = sum(v["clusters"] for k, v in c_court.items() if k is None)
    summary = {
        "source": "CourtListener bulk data: dockets, opinion-clusters, citations, oral-arguments, courts, people (Free Law Project)", "snapshot": cc.SNAPSHOT,
        "terms": "CourtListener publishes these bulk files for download without an account; see https://www.courtlistener.com/terms/ and the bulk-data help page.",
        "totals": {"courts_in_schema": len(courts), "courts_with_records": len(rows), "dockets": totals["dockets"], "opinion_clusters": totals["clusters"], "oral_arguments": totals["oral"],
                   "clusters_without_matching_docket": unmatched_clusters},
        "definitions": {
            "docket": "one row of CourtListener's docket table (a case or appeal in one court), counted by court_id",
            "filing date": "date_filed when it falls between 1700-01-01 and 2026-09-30; other values are counted as outside the plausible range and left out of year series",
            "recap": "docket source field has the RECAP bit (value 1) set; the field is a bit mask (1 RECAP, 2 scraper, 4 Columbia, 8 FJC IDB, 16 Harvard)",
            "civil / criminal": "the two-letter case type inside a federal docket number (5:15-cv-02674 is cv, 1:15-cr-00123 is cr); CourtListener's own parsed case type fills in where the number does not match; dockets with neither are 'Not recorded'",
            "duration": "days from date_filed to date_terminated for dockets with both dates and termination on or after filing; shown only when n >= 30; RECAP dockets are a convenience sample",
            "times cited": "CourtListener's citation_count for an opinion cluster: how many opinions in its citation network cite it",
            "fjc coverage ratio": "CourtListener civil-numbered dockets (docket number contains -cv-) filed in a fiscal year divided by FJC Integrated Database civil filings for the same district and fiscal year; >1 or <1 does not measure error, only collection overlap",
            "fiscal year": "October 1 through September 30, labelled by the year it ends (the AO convention)"},
        "caveats": ["The collection is not a census of court filings; RECAP dockets exist when someone fetched or shared them.", "State and appellate coverage varies by court.",
                    "Durations and shares describe the dockets in the collection, not the court's whole caseload.", "Attorneys, parties and docket entries are not part of CourtListener's public bulk files, so no firm or attorney statistics are derived here."],
        "grain": "one record per court with dockets, opinion clusters, oral arguments or judicial positions on record",
    }
    return {DATASET: {
        "dataset": DATASET, "label": "Court-by-court dockets, opinions, citations and oral arguments in CourtListener's collection (Sept 30, 2026)",
        "listing_block": writer.listing([("court", "Court"), ("level", "Level"), ("state", "State"), ("dockets", "Dockets"), ("clusters", "Opinion clusters"), ("oral_arguments", "Oral arguments"),
                                         ("first_year", "First docket year"), ("recap_pct", "RECAP %"), ("median_civil_days", "Median days, civil"), ("fjc_coverage_ratio", "vs FJC civil filings"), ("cited_pct", "Clusters cited %")],
                                        [("level", "Level", dict(cc.JURISDICTION_LABEL))]),
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
