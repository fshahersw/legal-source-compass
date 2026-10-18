"""Build clb_disclosure_coverage: how many judicial financial-disclosure reports CourtListener holds, by filing year and by court.

Source: CourtListener bulk files financial-disclosures and its line-item tables (loaded into small.duckdb as fd, fd_investment, ...).
Only counts are published: reports, people, and numbers of line items per section. No holdings, creditors, gifts, amounts, descriptions or
filer-level contents are published. Joins use exact person ids. The report type codes are not described in the published schema, so they
are shown as stored and not decoded.
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
sys.path.insert(0, os.path.join(ROOT, "private", "scratch", "pylib"))

import clb_common as cc  # noqa: E402
import corpus_writer as writer  # noqa: E402
import duckdb  # noqa: E402

DB = os.path.join(ROOT, "private", "acq", "courtlistener", "db")
OUT = os.path.join(ROOT, "private", "build", "courtlistener")
LOOK = os.path.join(ROOT, "private", "build", "fjc_idb", "lookups")
DATASET = "clb_disclosure_coverage"
FD_URL = cc.BULK_BASE + "financial-disclosures-2026-09-30.csv.bz2"
SECTIONS = [("fd_investment", "investments"), ("fd_gift", "gifts"), ("fd_reimbursement", "reimbursements"), ("fd_position", "outside positions"),
            ("fd_debt", "debts"), ("fd_agreement", "agreements"), ("fd_non_investment_income", "non-investment income"), ("fd_spousal_income", "spousal income")]
MIN_PERSONS_COURT = 5


def facts(pairs):
    return [[k, "Not recorded" if v is None else str(v)] for k, v in pairs]


def build() -> dict[str, dict]:
    con = duckdb.connect(os.path.join(DB, "small.duckdb"), read_only=True)
    spine = json.load(open(os.path.join(LOOK, "court_spine.json")))
    spine_ids = set(spine["ids"])
    courts = {r[0]: {"name": r[1] or r[0], "jur": r[2]} for r in con.execute("SELECT id, full_name, jurisdiction FROM courts").fetchall()}
    total_reports, total_persons, first_year, last_year = con.execute("SELECT count(*), count(DISTINCT person_id), min(TRY_CAST(year AS INTEGER)), max(TRY_CAST(year AS INTEGER)) FROM fd").fetchone()
    by_year = {}
    for r in con.execute(
            """SELECT TRY_CAST(year AS INTEGER) AS yr, count(*), count(DISTINCT person_id), count(*) FILTER (WHERE is_amended = 't'), count(*) FILTER (WHERE has_been_extracted = 't'),
                      median(TRY_CAST(page_count AS INTEGER)), sum(TRY_CAST(page_count AS INTEGER)) FROM fd GROUP BY 1 ORDER BY 1""").fetchall():
        by_year[r[0]] = {"yr": r[0], "reports": r[1], "persons": r[2], "amended": r[3], "extracted": r[4], "median_pages": r[5], "pages": r[6], "types": {}, "items": {}}
    for r in con.execute("SELECT TRY_CAST(year AS INTEGER), report_type, count(*) FROM fd GROUP BY 1, 2").fetchall():
        by_year[r[0]]["types"][r[1]] = r[2]
    section_totals = {}
    for table, label in SECTIONS:
        section_totals[label] = con.execute(f"SELECT count(*) FROM {table}").fetchone()[0]
        for yr, n in con.execute(f"SELECT TRY_CAST(f.year AS INTEGER), count(*) FROM {table} t JOIN fd f ON f.id = t.financial_disclosure_id GROUP BY 1").fetchall():
            by_year[yr]["items"][label] = n
    persons_with = {r[0] for r in con.execute("SELECT DISTINCT person_id FROM fd").fetchall()}
    reports_by_person = Counter()
    years_by_person = defaultdict(set)
    for pid, yr in con.execute("SELECT person_id, TRY_CAST(year AS INTEGER) FROM fd").fetchall():
        reports_by_person[pid] += 1
        years_by_person[pid].add(yr)
    court_people = defaultdict(set)
    judicial = ", ".join(f"'{t}'" for t in sorted(cc.JUDICIAL_POSITIONS))
    for pid, cid in con.execute(f"SELECT DISTINCT person_id, court_id FROM position WHERE position_type IN ({judicial})").fetchall():
        if cid in courts:
            court_people[cid].add(pid)
    all_judicial_people = {p for s in court_people.values() for p in s}
    built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    inputs = [{"url": FD_URL, "path": "CourtListener bulk file financial-disclosures-2026-09-30.csv.bz2 and the line-item files (loaded into private/acq/courtlistener/db/small.duckdb)", "sha256": None}]
    rows = []
    for yr, d in sorted(by_year.items()):
        if yr is None:
            continue
        items_total = sum(d["items"].values())
        rows.append(writer.record(
            DATASET, f"year:{yr}", f"Financial disclosure reports in CourtListener for filing year {yr}", source_url=FD_URL,
            subtitle=f"{d['reports']:,} reports · {d['persons']:,} people · {items_total:,} line items",
            cells={"kind": "year", "name": str(yr), "reports": d["reports"], "persons": d["persons"], "amended_pct": cc.share(d["amended"], d["reports"]), "extracted_pct": cc.share(d["extracted"], d["reports"]),
                   "median_pages": d["median_pages"], "line_items": items_total, "coverage_pct": None},
            badges=["CourtListener bulk data", "Counts only"],
            facts=facts([("Filing year", yr), ("Reports on file", f"{d['reports']:,}"), ("People with a report", f"{d['persons']:,}"), ("Amended reports", f"{d['amended']:,} ({cc.share(d['amended'], d['reports'])}%)"),
                         ("Reports with extracted line items", f"{d['extracted']:,} ({cc.share(d['extracted'], d['reports'])}%)"), ("Median pages", d["median_pages"]),
                         ("Line items by section", "; ".join(f"{k} {v:,}" for k, v in sorted(d["items"].items(), key=lambda kv: -kv[1])) or None),
                         ("Report type codes (as stored)", "; ".join(f"{k}: {v:,}" for k, v in sorted(d["types"].items(), key=lambda kv: -kv[1]))),
                         ("Scope", "Counts only: no holdings, amounts, creditors, gifts or descriptions are published here.")]),
            text=f"financial disclosure reports year {yr}", filters={"kind": ["year"]}, links=[{"label": "CourtListener financial disclosures", "url": "https://www.courtlistener.com/financial-disclosures/"}],
            extra={"profile": {"year": yr, "reports": d["reports"], "persons": d["persons"], "amended": d["amended"], "extracted": d["extracted"], "median_pages": d["median_pages"], "items": d["items"], "report_type_codes": d["types"]}}))
    n_court_rows = 0
    for cid, people in sorted(court_people.items(), key=lambda kv: (-len(kv[1]), kv[0])):
        if len(people) < MIN_PERSONS_COURT:
            continue
        with_report = people & persons_with
        reports = sum(reports_by_person[p] for p in with_report)
        yrs = sorted({y for p in with_report for y in years_by_person[p] if y})
        name = courts[cid]["name"]
        level = cc.JURISDICTION_LABEL.get(courts[cid]["jur"], f"Code {courts[cid]['jur']}")
        n_court_rows += 1
        rows.append(writer.record(
            DATASET, f"court:{cid}", f"{name}: judges with financial disclosure reports in CourtListener", source_url=FD_URL,
            subtitle=f"{len(with_report):,} of {len(people):,} people with a judicial position on record have at least one report",
            cells={"kind": "court", "name": name, "reports": reports, "persons": len(with_report), "amended_pct": None, "extracted_pct": None, "median_pages": None, "line_items": None,
                   "coverage_pct": cc.share(len(with_report), len(people))},
            badges=["CourtListener bulk data", "Counts only", level],
            facts=facts([("Court", name), ("People with a judicial position at this court on record", f"{len(people):,}"), ("Of those, with at least one disclosure report", f"{len(with_report):,} ({cc.share(len(with_report), len(people))}%)"),
                         ("Reports by those people (any court, any year)", f"{reports:,}"), ("Filing years of those reports", f"{yrs[0]}–{yrs[-1]}" if yrs else None),
                         ("Reading", "People are matched to the court by their position records and to reports by person id. Reports follow the person to any court; coverage is a share of people, not of years served.")]),
            text=f"{name} judges financial disclosure coverage", filters={"kind": ["court"]},
            links=([{"label": "Court profile", "url": f"/courts/{cid}"}] if cid in spine_ids else []) + [{"label": "Judicial positions on record", "url": f"/records/clb_court_benches/{cid}"}],
            extra={"profile": {"court_id": cid, "name": name, "level": level, "people": len(people), "with_report": len(with_report), "reports": reports, "first_year": yrs[0] if yrs else None, "last_year": yrs[-1] if yrs else None}}))
    judicial_with = all_judicial_people & persons_with
    rows.append(writer.record(
        DATASET, "overview:all", "Financial disclosure reports in CourtListener: overview", source_url=FD_URL,
        subtitle=f"{total_reports:,} reports · {total_persons:,} people · filing years {first_year}–{last_year}",
        cells={"kind": "overview", "name": "All reports", "reports": total_reports, "persons": total_persons, "amended_pct": None, "extracted_pct": None, "median_pages": None,
               "line_items": sum(section_totals.values()), "coverage_pct": cc.share(len(judicial_with), len(all_judicial_people))},
        badges=["CourtListener bulk data", "Counts only"],
        facts=facts([("Reports on file", f"{total_reports:,}"), ("People with at least one report", f"{total_persons:,}"), ("Filing years", f"{first_year}–{last_year}"),
                     ("People with a judicial position on record who have a report", f"{len(judicial_with):,} of {len(all_judicial_people):,} ({cc.share(len(judicial_with), len(all_judicial_people))}%)"),
                     ("Line items by section", "; ".join(f"{k} {v:,}" for k, v in sorted(section_totals.items(), key=lambda kv: -kv[1]))),
                     ("Scope", "Counts only. The collection holds reports for filing years 1987-2022 in this snapshot; later years are not present.")]),
        text="financial disclosure reports overview", filters={"kind": ["overview"]}, links=[{"label": "CourtListener financial disclosures", "url": "https://www.courtlistener.com/financial-disclosures/"}],
        extra={"profile": {"reports": total_reports, "persons": total_persons, "first_year": first_year, "last_year": last_year, "sections": section_totals,
                           "judicial_people": len(all_judicial_people), "judicial_people_with_report": len(judicial_with),
                           "reports_by_person_distribution": {"1": sum(1 for v in reports_by_person.values() if v == 1), "2-5": sum(1 for v in reports_by_person.values() if 2 <= v <= 5),
                                                              "6-10": sum(1 for v in reports_by_person.values() if 6 <= v <= 10), "11+": sum(1 for v in reports_by_person.values() if v >= 11)}}}))
    summary = {
        "source": "CourtListener bulk data: financial-disclosures and line-item files (Free Law Project), people-db positions", "snapshot": cc.SNAPSHOT,
        "terms": "CourtListener publishes these bulk files for download without an account; see https://www.courtlistener.com/terms/ and the bulk-data help page.",
        "totals": {"reports": total_reports, "people": total_persons, "years": f"{first_year}-{last_year}", "courts_listed": n_court_rows, "line_items": section_totals},
        "definitions": {"coverage": "share of people with a judicial position at the court on record (people-db positions) who have at least one report", "line items": "rows in the report's section tables; one row per listed item, whatever its value",
                        "report type codes": "stored codes; the published schema does not describe them, so they are not decoded here"},
        "caveats": ["Counts only; nothing in a report's contents is published here.", "Coverage reflects what CourtListener collected, not whether a judge was required to file.", "Filing years run 1987-2022 in this snapshot; the collection is sparse before 2003 and absent after 2022."],
        "grain": "year, court (five or more people on record) and overview records"}
    return {DATASET: {
        "dataset": DATASET, "label": "Judicial financial disclosure coverage in CourtListener: reports by year and court (counts only, Sept 30, 2026)",
        "listing_block": writer.listing([("kind", "Type"), ("name", "Name"), ("reports", "Reports"), ("persons", "People"), ("coverage_pct", "Coverage %"), ("amended_pct", "Amended %"),
                                         ("extracted_pct", "Extracted %"), ("median_pages", "Median pages"), ("line_items", "Line items")],
                                        [("kind", "Type", {"year": "Filing year", "court": "Court", "overview": "Overview"})]),
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
