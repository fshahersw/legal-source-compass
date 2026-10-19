"""Build clb_bankruptcy_courts: one profile per federal bankruptcy court from CourtListener's bankruptcy-dockets bulk file.

Source: randoms/bankruptcy-dockets-2022-09-19.csv.bz2 (CourtListener's one-off export of bankruptcy-court dockets, dated 2022-09-19,
34.7 million rows), slimmed by ingest_rest.py and aggregated by build_rest_work.py (r_bk_* tables). The file has no chapter, asset,
liability or trustee columns: those live in CourtListener's bankruptcy-information table, which has no public bulk file, so they are
"Not recorded" here. Debtor names are never loaded. Judges are CourtListener person ids exactly as recorded (assigned_to_id); names that
were recorded without an id are counted, not linked. Each court's rows are also looked up by docket id in the 2026-09-30 docket file.
"""
from __future__ import annotations

import json
import os
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import rest_common as rc  # noqa: E402  (sets sys.path for the shared CourtListener modules)
import clb_common as cc  # noqa: E402
import corpus_writer as writer  # noqa: E402
import duckdb  # noqa: E402

DATASET = "clb_bankruptcy_courts"
FILE_DATE = "2022-09-19"
PACER_CODES_URL = "https://pacer.uscourts.gov/sites/default/files/files/bankruptcy_4.1.pdf"
TOP_JUDGES = 12
YEAR_MIN = 1980  # yearly series start; earlier filing years are counted in `before_series`


def rows_by(con, sql, key):
    cur = con.execute(sql)
    cols = [d[0] for d in cur.description]
    out = {}
    for r in cur.fetchall():
        rec = dict(zip(cols, r))
        out.setdefault(rec[key], []).append(rec)
    return out


def one(con, sql, key):
    return {k: v[0] for k, v in rows_by(con, sql, key).items()}


def build() -> dict:
    con = duckdb.connect(os.path.join(rc.DB, "rest_work.duckdb"), read_only=True)
    sm = duckdb.connect(os.path.join(rc.DB, "small.duckdb"), read_only=True)
    spine = rc.spine_ids()
    judge_ids = rc.published_ids("clb_judge_dockets")
    cl_people = set(json.load(open(os.path.join(rc.ROOT, "private", "build", "fjc_idb", "lookups", "cl_people.json")))["ids"])
    courts = {r[0]: {"name": r[1] or r[0], "jur": r[2]} for r in sm.execute("SELECT id, full_name, jurisdiction FROM courts").fetchall()}
    persons = {int(r[0]): cc.full_name(r[1], r[2], r[3], r[4]) for r in sm.execute("SELECT id, name_first, name_middle, name_last, name_suffix FROM person").fetchall()}
    done = json.load(open(os.path.join(rc.DB, "bankruptcy.done.json")))

    base = one(con, "SELECT * FROM r_bk_court", "court_id")
    dur = one(con, "SELECT * FROM r_bk_dur", "court_id")
    years = rows_by(con, "SELECT * FROM r_bk_year ORDER BY court_id, yr", "court_id")
    types = rows_by(con, "SELECT * FROM r_bk_type", "court_id")
    judges = rows_by(con, "SELECT * FROM r_bk_judge ORDER BY court_id, n DESC, pid", "court_id")
    names = rows_by(con, "SELECT * FROM r_bk_judge_name ORDER BY court_id, n DESC, name", "court_id")
    created = rows_by(con, "SELECT * FROM r_bk_created ORDER BY court_id, yr", "court_id")
    indock = one(con, "SELECT * FROM r_bk_in_docket", "court_id")
    dtot = one(con, "SELECT * FROM r_bk_docket_total", "court_id")

    built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    inputs = [{"url": rc.BANKRUPTCY_URL, "path": "streamed, not stored; slim table private/acq/courtlistener/db/bankruptcy.duckdb (bankruptcy.done.json)", "sha256": None},
              {"url": rc.DOCKETS_URL, "path": "slim table private/acq/courtlistener/db/docket.duckdb (id lookup only)", "sha256": None},
              {"url": rc.COURTS_URL, "path": "small.duckdb courts", "sha256": None}, {"url": rc.PEOPLE_URL, "path": "small.duckdb person", "sha256": None}]
    rows = []
    not_bk = []
    totals = {"dockets": 0, "terminated": 0, "with_judge_id": 0, "blocked": 0, "in_docket": 0}
    national_years: dict[int, int] = {}
    for cid in sorted(base):
        b = base[cid]
        c = courts.get(cid)
        if not c or c["jur"] != "FB":
            not_bk.append({"court_id": cid, "rows": b["n"], "jurisdiction": c["jur"] if c else None, "name": c["name"] if c else None})
            continue
        name = c["name"]
        n = b["n"]
        for k in totals:
            totals[k] += (indock.get(cid) or {}).get("in_docket", 0) if k == "in_docket" else b[k if k != "dockets" else "n"]
        d = dur.get(cid)
        duration = {"n": d["n"], **rc.quantiles(d["q"])} if d and d["n"] >= 30 else None
        yr_rows = [y for y in years.get(cid, []) if y["yr"] is not None]
        before = sum(y["n"] for y in yr_rows if y["yr"] < YEAR_MIN)
        series = [{"yr": int(y["yr"]), "dockets": y["n"], "terminated": y["terminated"], "ap": y["ap"],
                   "median_days": cc.r1(y["p50_days"]) if y["n_dur"] >= 30 else None, "n_dur": y["n_dur"]} for y in yr_rows if y["yr"] >= YEAR_MIN]
        for y in series:
            national_years[y["yr"]] = national_years.get(y["yr"], 0) + y["dockets"]
        tys = []
        for t in sorted(types.get(cid, []), key=lambda t: (-t["n"], t["dn_type"])):
            tys.append({"code": t["dn_type"], "label": rc.DN_TYPE_LABEL.get(t["dn_type"], f"{t['dn_type']} (as recorded)"), "dockets": t["n"], "share_pct": cc.share(t["n"], n),
                        "terminated": t["terminated"], "median_days": cc.r1(t["p50_days"]) if t["n_dur"] >= 30 else None, "n_dur": t["n_dur"]})
        jud = []
        for j in judges.get(cid, [])[:TOP_JUDGES]:
            pid = int(j["pid"])
            jud.append({"person_id": pid, "name": persons.get(pid, "Name not recorded"), "dockets": j["n"], "share_pct": cc.share(j["n"], n),
                        "first_filed": str(j["first_filed"]) if j["first_filed"] else None, "last_filed": str(j["last_filed"]) if j["last_filed"] else None,
                        "median_days": cc.r1(j["p50_days"]) if j["n_dur"] >= 30 else None, "n_dur": j["n_dur"],
                        "record": f"/records/cl_people/cl:people:{pid}" if f"cl:people:{pid}" in cl_people else None,
                        "stats_record": rc.judge_record_link(pid, judge_ids)})
        n_judges = len(judges.get(cid, []))
        unlinked = [{"name": r["name"], "dockets": r["n"]} for r in names.get(cid, [])[:5]]
        ind = indock.get(cid) or {}
        tot = dtot.get(cid) or {}
        in_2026 = {"in_docket_file": ind.get("in_docket", 0), "in_docket_file_pct": cc.share(ind.get("in_docket", 0), n), "same_court": ind.get("same_court", 0),
                   "same_filed_date": ind.get("same_filed", 0), "same_terminated_date": ind.get("same_term", 0), "same_judge_id": ind.get("same_judge", 0),
                   "docket_file_rows_for_court": tot.get("n"), "docket_file_rows_filed_by_2022_09_19": tot.get("filed_by_file_date")}
        cr = [{"yr": int(r["yr"]), "n": r["n"]} for r in created.get(cid, []) if r["yr"] is not None]
        term_pct = cc.share(b["terminated"], n)
        ap = next((t for t in tys if t["code"] == "ap"), None)
        profile = {
            "court_id": cid, "name": name, "file_date": FILE_DATE, "dockets": n, "dated": b["dated"], "no_filed_date": b["no_filed"], "implausible_filed": b["implausible_filed"],
            "first_filed": str(b["first_filed"]) if b["first_filed"] else None, "last_filed": str(b["last_filed"]) if b["last_filed"] else None,
            "terminated": b["terminated"], "terminated_pct": term_pct, "terminated_before_filed": b["term_before_filed"], "duration_days": duration,
            "by_year": series, "before_series": before, "year_series_from": YEAR_MIN, "case_types": tys,
            "judges": jud, "judges_with_id": n_judges, "with_judge_id": b["with_judge_id"], "with_judge_id_pct": cc.share(b["with_judge_id"], n),
            "judge_name_only": b["judge_name_only"], "judge_names_without_id": unlinked,
            "blocked": b["blocked"], "blocked_pct": cc.share(b["blocked"], n), "created_by_year": cr, "in_2026_docket_file": in_2026,
            "chapter": None, "assets": None, "liabilities": None,
        }
        sub = f"{n:,} dockets in the file · {term_pct}% with a termination date" + (f" · median {duration['p50']:,.0f} days to termination" if duration else "")
        links = [{"label": "Bankruptcy-dockets bulk file", "url": rc.BANKRUPTCY_URL}] + ([{"label": "Court profile", "url": f"/courts/{cid}"}] if cid in spine else [])
        rows.append(writer.record(
            DATASET, cid, f"{name}: dockets in CourtListener's bankruptcy-dockets file ({FILE_DATE})", source_url=rc.BANKRUPTCY_URL, subtitle=sub,
            cells={"court": name, "dockets": n, "first_year": b["first_filed"].year if b["first_filed"] else None, "last_year": b["last_filed"].year if b["last_filed"] else None,
                   "terminated_pct": term_pct, "median_days": duration["p50"] if duration else None, "ap_pct": ap["share_pct"] if ap else None,
                   "judge_id_pct": cc.share(b["with_judge_id"], n), "in_2026_pct": in_2026["in_docket_file_pct"]},
            badges=["CourtListener bulk data", f"File dated {FILE_DATE}", "No chapter or asset fields"],
            facts=rc.facts([
                ("Court (CourtListener id)", f"{name} ({cid})"), ("Dockets in the file", f"{n:,}"),
                ("Filing dates", f"{b['first_filed']} to {b['last_filed']}" if b["first_filed"] else None),
                ("Dockets with no usable filing date", f"{b['no_filed'] + b['implausible_filed']:,}"),
                ("With a termination date", f"{b['terminated']:,} ({term_pct}%)"),
                ("Days from filing to termination (median, middle half)", f"{duration['p50']:,.0f} ({duration['p25']:,.0f}–{duration['p75']:,.0f}), n = {duration['n']:,}" if duration else None),
                ("Case-type code in the docket number", "; ".join(f"{t['label']}: {t['dockets']:,} ({t['share_pct']}%)" for t in tys[:4]) or None),
                ("Assigned judge recorded as a CourtListener person id", f"{b['with_judge_id']:,} ({cc.share(b['with_judge_id'], n)}%) across {n_judges} people"),
                ("Judge recorded by name only (not linked)", f"{b['judge_name_only']:,}"),
                ("Flagged by CourtListener as blocked from search engines", f"{b['blocked']:,} ({cc.share(b['blocked'], n)}%)"),
                ("Same docket id found in the 2026-09-30 docket file", f"{in_2026['in_docket_file']:,} ({in_2026['in_docket_file_pct']}%)"),
                ("Chapter, assets, liabilities", "Not recorded: the file has no such columns (CourtListener's bankruptcy-information table has no public bulk file)"),
                ("Counting", "Every row of the file for this court; durations use dockets whose termination date is on or after the filing date; yearly medians need at least 30 such dockets."),
            ]),
            text=f"bankruptcy court dockets {name} {cid}", filters={"court": [cid]}, links=links, extra={"profile": profile}))
    rows.sort(key=lambda r: -r["item"]["cells"]["dockets"])
    ov_years = [{"yr": y, "dockets": national_years[y]} for y in sorted(national_years)]
    overview = {"dockets_in_file": done["rows"], "skipped_invalid_rows": done["skipped_invalid_rows"], "bankruptcy_courts": len(rows),
                "rows_in_bankruptcy_courts": totals["dockets"], "terminated": totals["terminated"], "with_judge_id": totals["with_judge_id"], "blocked": totals["blocked"],
                "in_2026_docket_file": totals["in_docket"], "rows_in_other_courts": not_bk, "by_year": ov_years}
    rows.append(writer.record(
        DATASET, "overview:all", f"CourtListener bankruptcy-dockets file ({FILE_DATE}): overview", source_url=rc.BANKRUPTCY_URL,
        subtitle=f"{done['rows']:,} rows · {len(rows)} bankruptcy courts",
        cells={"court": "All bankruptcy courts", "dockets": totals["dockets"], "first_year": None, "last_year": None, "terminated_pct": cc.share(totals["terminated"], totals["dockets"]),
               "median_days": None, "ap_pct": None, "judge_id_pct": cc.share(totals["with_judge_id"], totals["dockets"]), "in_2026_pct": cc.share(totals["in_docket"], totals["dockets"])},
        badges=["CourtListener bulk data", f"File dated {FILE_DATE}"],
        facts=rc.facts([("Rows in the file", f"{done['rows']:,}"), ("Rows skipped because their column count was wrong (not repaired)", f"{done['skipped_invalid_rows']:,}"),
                         ("Bankruptcy courts with rows", len(rows)), ("Rows in those courts", f"{totals['dockets']:,}"),
                         ("Rows whose court is not a bankruptcy court in the courts table", "; ".join(f"{x['court_id']} ({x['jurisdiction']}): {x['rows']:,}" for x in not_bk) or None),
                         ("Same docket id found in the 2026-09-30 docket file", f"{totals['in_docket']:,} ({cc.share(totals['in_docket'], totals['dockets'])}%)")]),
        text="bankruptcy dockets overview", filters={"court": ["all"]}, links=[{"label": "Bankruptcy-dockets bulk file", "url": rc.BANKRUPTCY_URL}], extra={"profile": overview}))
    summary = {
        "source": "CourtListener bulk data: randoms/bankruptcy-dockets-2022-09-19 (Free Law Project), with the 2026-09-30 courts, people and docket files",
        "snapshot": FILE_DATE, "terms": rc.TERMS,
        "totals": {"rows_in_file": done["rows"], "bankruptcy_courts": len(rows) - 1, "rows_in_bankruptcy_courts": totals["dockets"], "skipped_invalid_rows": done["skipped_invalid_rows"]},
        "definitions": {
            "dockets": "rows of the bankruptcy-dockets file for the court (one row per CourtListener docket id)",
            "terminated": "a termination date is recorded (dates after the file date or before 1700 count as not recorded)",
            "days to termination": "termination date minus filing date for dockets with both dates and termination on or after filing; quantiles over those dockets; shown when n >= 30",
            "case-type code": f"the two letters inside a PACER docket number office:yy-tt-nnnnn: bk bankruptcy, ap adversary proceeding, mp miscellaneous proceeding (PACER, {PACER_CODES_URL}); numbers without the code are counted as none",
            "assigned judge": "assigned_to_id, a CourtListener person id, exactly as recorded; names recorded without an id are counted and listed as recorded, never linked",
            "in the 2026 docket file": "the same docket id exists in dockets-2026-09-30; same court, filing date, termination date and judge id are compared field by field",
            "blocked": "CourtListener's flag that the docket is blocked from search engines (common for individual debtors); no debtor names are loaded or shown"},
        "caveats": ["The file is a one-off export dated 2022-09-19, not the 2026 snapshot; dockets filed after that date are absent.",
                    "It is CourtListener's collection (mostly created in 2020-2021 from PACER case lists), not a complete count of bankruptcy filings.",
                    "Chapter, assets, liabilities and trustee are not in the file and are not inferred.",
                    "Termination dates can be missing for open cases and for cases CourtListener never refreshed."],
        "grain": "one record per bankruptcy court (jurisdiction FB) plus an overview record"}
    return {DATASET: {
        "dataset": DATASET, "label": "Bankruptcy courts in CourtListener's bankruptcy-dockets file (Sept 19, 2022): filings, durations, case types, judges",
        "listing_block": writer.listing([("court", "Court"), ("dockets", "Dockets"), ("first_year", "First filing year"), ("last_year", "Last filing year"), ("terminated_pct", "Terminated %"),
                                         ("median_days", "Median days to termination"), ("ap_pct", "Adversary proceedings %"), ("judge_id_pct", "Judge id recorded %"), ("in_2026_pct", "In 2026 docket file %")], []),
        "summary": summary, "rows": rows, "built_at": built_at, "inputs": inputs}}


if __name__ == "__main__":
    rc.write(build())
