"""Build clb_judge_disclosures: each judge's financial disclosure reports in CourtListener, year by year, as filed.

Source: financial-disclosures-2026-09-30 and its line-item files (loaded whole into small.duckdb by load_small.py: fd, fd_investment,
fd_gift, fd_reimbursement, fd_agreement, fd_position, fd_debt, fd_non_investment_income, fd_spousal_income), joined on exact ids
(financial_disclosure_id -> fd.id -> person_id). Per person and report year: number of reports, amended flags, page counts, report type
codes as stored (the schema does not describe them) and the number of line items in every section. Gifts, reimbursements and
agreements are listed item by item exactly as CourtListener extracted them from the report (text trimmed to 300 characters); an item
CourtListener marks redacted keeps the text CourtListener published for it (what remained readable around the filer's redaction) and is
marked 'Redacted in the report'. Items are listed from reports whose file name carries the person's surname and from reports whose
file name could not be read (labelled 'attribution not checked'); items of reports whose file name carries another surname, and every
item of a conflict report (rest_common.resolve_conflict), are counted but not listed (rest_common.split_disclosure_items). Every
listed reimbursement is kept (no display cap). Investment, debt, income and position sections are counted only. No value is inferred,
summed or converted.
"""
from __future__ import annotations

import os
import sys
import time
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import rest_common as rc  # noqa: E402
import clb_common as cc  # noqa: E402
import corpus_writer as writer  # noqa: E402
import duckdb  # noqa: E402

DATASET = "clb_judge_disclosures"
SECTIONS = [("fd_investment", "investments"), ("fd_gift", "gifts"), ("fd_reimbursement", "reimbursements"), ("fd_agreement", "agreements"),
            ("fd_position", "outside_positions"), ("fd_debt", "debts"), ("fd_non_investment_income", "non_investment_income"), ("fd_spousal_income", "spousal_income")]
SECTION_LABEL = {"investments": "Investments", "gifts": "Gifts", "reimbursements": "Reimbursements", "agreements": "Agreements", "outside_positions": "Outside positions",
                 "debts": "Debts", "non_investment_income": "Non-investment income", "spousal_income": "Spousal income"}
KINDS = rc.DISCLOSURE_ITEM_KINDS


def by_recency(r):
    return (-(r["year"] or 0), r["report_id"] or 0)


def as_int(v):
    try:
        return int(v)
    except (TypeError, ValueError):
        return None


def build() -> dict:
    sm = duckdb.connect(os.path.join(rc.DB, "small.duckdb"), read_only=True)
    spine = rc.spine_ids()
    judge_ids = rc.published_ids("clb_judge_dockets")
    courts = {r[0]: r[1] or r[0] for r in sm.execute("SELECT id, full_name FROM courts").fetchall()}
    persons = {int(r[0]): cc.full_name(r[1], r[2], r[3], r[4]) for r in sm.execute("SELECT id, name_first, name_middle, name_last, name_suffix FROM person").fetchall()}
    reports = defaultdict(list)
    fd_person = {}
    for rid, pid, year, rtype, amended, pages, extracted in sm.execute(
            "SELECT id, person_id, year, report_type, is_amended, page_count, has_been_extracted FROM fd ORDER BY TRY_CAST(year AS INTEGER), TRY_CAST(id AS BIGINT)").fetchall():
        p = as_int(pid)
        if p is None:
            continue
        fd_person[rid] = (p, as_int(year))
        reports[p].append({"id": as_int(rid), "year": as_int(year), "report_type_code": rtype, "amended": amended == "t", "pages": as_int(pages), "extracted": extracted == "t"})
    # attribution check from each report's original file name (fd_file, loaded by ingest_rest.py fd_files)
    fcon = duckdb.connect(os.path.join(rc.DB, "fd_file.duckdb"), read_only=True)
    files = {int(r[0]): (r[1], r[2]) for r in fcon.execute("SELECT id, filepath, download_filepath FROM fd_file").fetchall()}
    last_names = {int(r[0]): r[1] for r in sm.execute("SELECT id, name_last FROM person").fetchall()}
    attr = {}
    parsed_by_person = {}
    for p, reps_p in reports.items():
        parsed = [rc.parse_filer_file(files.get(r["id"], (None, None))[1]) for r in reps_p]
        a = rc.attribution(last_names.get(p), parsed)
        attr[p] = a
        parsed_by_person[p] = parsed
        for r, prs, chk in zip(reps_p, parsed, a["checks"]):
            fp = files.get(r["id"], (None, None))[0]
            # CourtListener's own copy of the report: storage path us/federal/judicial/financial-disclosures/<person id>/<file>.pdf
            pdf = f"https://storage.courtlistener.com/{fp}" if fp and fp.startswith(f"us/federal/judicial/financial-disclosures/{p}/") and fp.endswith(".pdf") else None
            code = " ".join(x for x in (prs.get("position"), prs.get("court_code"), prs.get("district")) if x) if prs and prs["kind"] == "ao" else None
            r.update({"file_check": chk, "filer_code": code or None, "pdf": pdf})
    counts = defaultdict(Counter)  # (pid, year) -> section -> n
    redacted = defaultdict(Counter)
    for table, key in SECTIONS:
        for fid, n, nred in sm.execute(f"SELECT financial_disclosure_id, count(*), count(*) FILTER (WHERE redacted = 't') FROM {table} GROUP BY 1").fetchall():
            if fid in fd_person:
                counts[fd_person[fid]][key] += n
                redacted[fd_person[fid]][key] += nred
    items = defaultdict(lambda: {"gifts": [], "reimbursements": [], "agreements": []})
    for fid, src, desc, val, red in sm.execute("SELECT financial_disclosure_id, source, description, value, redacted FROM fd_gift ORDER BY TRY_CAST(id AS BIGINT)").fetchall():
        if fid in fd_person:
            pid, yr = fd_person[fid]
            items[pid]["gifts"].append(rc.gift_item(yr, fid, src, desc, val, red))
    for fid, src, date_raw, loc, purpose, paid, red in sm.execute(
            "SELECT financial_disclosure_id, source, date_raw, location, purpose, items_paid_or_provided, redacted FROM fd_reimbursement ORDER BY TRY_CAST(id AS BIGINT)").fetchall():
        if fid in fd_person:
            pid, yr = fd_person[fid]
            items[pid]["reimbursements"].append(rc.reimbursement_item(yr, fid, src, date_raw, loc, purpose, paid, red))
    for fid, date_raw, terms, red in sm.execute("SELECT financial_disclosure_id, date_raw, parties_and_terms, redacted FROM fd_agreement ORDER BY TRY_CAST(id AS BIGINT)").fetchall():
        if fid in fd_person:
            pid, yr = fd_person[fid]
            items[pid]["agreements"].append(rc.agreement_item(yr, fid, date_raw, terms, red))
    # the court of each person's most recent judicial position at a court in the courts table (for display and the court filter only)
    judicial = ", ".join(f"'{t}'" for t in sorted(cc.JUDICIAL_POSITIONS))
    recent_court = {}
    for pid, cid, start in sm.execute(f"SELECT person_id, court_id, date_start FROM position WHERE position_type IN ({judicial}) AND court_id IS NOT NULL ORDER BY person_id, date_start NULLS FIRST").fetchall():
        p = as_int(pid)
        if p is not None and cid in courts:
            recent_court[p] = cid
    built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    rows = []
    for pid in sorted(reports):
        reps = reports[pid]
        name = persons.get(pid, "Name not recorded")
        yrs = sorted({r["year"] for r in reps if r["year"] is not None})
        by_year = []
        tot = Counter()
        tot_red = Counter()
        for y in yrs + ([None] if any(r["year"] is None for r in reps) else []):
            yr_reps = [r for r in reps if r["year"] == y]
            c = counts.get((pid, y), Counter())
            tot.update(c)
            tot_red.update(redacted.get((pid, y), Counter()))
            by_year.append({"year": y, "reports": len(yr_reps), "amended": sum(1 for r in yr_reps if r["amended"]), "pages": sum(r["pages"] or 0 for r in yr_reps),
                            "report_type_codes": sorted({r["report_type_code"] for r in yr_reps if r["report_type_code"] is not None}),
                            "items": {k: c.get(k, 0) for _, k in SECTIONS}})
        it = items.get(pid, {"gifts": [], "reimbursements": [], "agreements": []})
        a = attr[pid]
        cid = recent_court.get(pid)
        # a conflict is resolved per report (rest_common.resolve_conflict): a circuit digit that differs inside one district court is not
        # evidence of another filer (status becomes 'consistent'); otherwise only the reports of the recorded court's district are listed
        resolution = rc.resolve_conflict(parsed_by_person[pid], a["checks"], cid) if a["status"] == "conflict" else None
        status = "consistent" if resolution and resolution["resolution"] == "same_district" else a["status"]
        conflict = status == "conflict"
        held_ids = {reps[i]["id"] for i in resolution["held"]} if conflict else set()
        for r in reps:
            r["conflict_hold"] = (r["id"] in held_ids) if conflict else None
        # listed: items of reports whose file name carries this person's surname, and of reports whose file name could not be read
        # (labelled 'not_checked'). Not listed, on evidence from the report files themselves: items of reports whose file name carries
        # another surname, and every item of a person whose matching reports carry more than one numbered circuit (CourtListener may
        # have joined two judges' reports).
        it, withheld_by_reason = rc.split_disclosure_items(it, {r["id"]: r["file_check"] for r in reps}, conflict, held_ids)
        withheld = {k: sum(withheld_by_reason[reason][k] for reason in withheld_by_reason) for k in KINDS}
        listed_unchecked = {k: sum(1 for r in it[k] if r["attribution"] == "not_checked") for k in KINDS}
        report_list = [{k: r[k] for k in ("id", "year", "amended", "pages", "report_type_code", "file_check", "filer_code", "pdf", "conflict_hold")} for r in sorted(reps, key=lambda r: (-(r["year"] or 0), -(r["id"] or 0)))]
        profile = {"person_id": pid, "name": name, "reports": len(reps), "amended": sum(1 for r in reps if r["amended"]), "first_year": yrs[0] if yrs else None, "last_year": yrs[-1] if yrs else None,
                   "years": by_year, "items_total": {k: tot.get(k, 0) for _, k in SECTIONS}, "items_redacted": {k: tot_red.get(k, 0) for _, k in SECTIONS},
                   "gifts": sorted(it["gifts"], key=by_recency), "agreements": sorted(it["agreements"], key=by_recency),
                   "reimbursements": sorted(it["reimbursements"], key=by_recency), "reimbursements_listed": len(it["reimbursements"]),
                   "items_withheld": withheld, "items_withheld_by_reason": withheld_by_reason, "items_listed_attribution_not_checked": listed_unchecked,
                   "attribution": {"status": status, "conflict_resolution": resolution["resolution"] if resolution else None,
                                   "conflict_district": resolution["district"] if resolution else None, "circuits": a["circuits"], "reports_matching_surname": a["match"], "reports_other_surname": a["mismatch"], "reports_unchecked": a["unchecked"]},
                   "court_id": cid, "court": courts.get(cid) if cid else None, "court_link": rc.court_link(cid, spine), "stats_record": rc.judge_record_link(pid, judge_ids), "report_list": report_list}
        span = f"{yrs[0]}–{yrs[-1]}" if yrs else "years not recorded"
        links = [{"label": "CourtListener person page", "url": f"https://www.courtlistener.com/person/{pid}/"}, {"label": "CourtListener financial disclosures", "url": "https://www.courtlistener.com/financial-disclosures/"}]
        if profile["stats_record"]:
            links.insert(0, {"label": "Dockets and opinions record", "url": profile["stats_record"]})
        rows.append(writer.record(
            DATASET, str(pid), f"{name}: financial disclosure reports in CourtListener", source_url=rc.FD_URL,
            subtitle=f"{len(reps):,} report{'s' if len(reps) != 1 else ''} · {span} · {tot.get('gifts', 0):,} gifts · {tot.get('reimbursements', 0):,} reimbursements · {tot.get('investments', 0):,} investments",
            cells={"judge": name, "court": courts.get(cid) if cid else None, "reports": len(reps), "first_year": profile["first_year"], "last_year": profile["last_year"],
                   "investments": tot.get("investments", 0), "gifts": tot.get("gifts", 0), "reimbursements": tot.get("reimbursements", 0), "agreements": tot.get("agreements", 0)},
            badges=["CourtListener bulk data", "As filed, not verified"] + (["Attribution conflict: some items withheld" if len(held_ids) < len(reps) else "Attribution conflict: items withheld"] if conflict else [])
                   + (["Some items: attribution not checked"] if any(listed_unchecked.values()) else []),
            facts=rc.facts([("Judge (CourtListener person id)", f"{name} ({pid})"), ("Reports on file", f"{len(reps):,} ({profile['amended']} amended)"), ("Report years", span),
                            *[(f"{SECTION_LABEL[k]} listed (all reports)", f"{tot.get(k, 0):,}" + (f" ({tot_red.get(k, 0):,} redacted by the filer)" if tot_red.get(k) else "")) for _, k in SECTIONS],
                            ("Attribution check (report file names)", (
                                (f"conflict: the reports carry more than one circuit code ({', '.join(f'{c}: {n}' for c, n in a['circuits'].items())}) and more than one district code; "
                                 + (f"items are listed only from the {len(reps) - len(held_ids)} reports coded for district {resolution['district']}, the district of the recorded court"
                                    if resolution["resolution"] == "recorded_court" else "they may belong to more than one judge, so no items are listed"))
                                if conflict else f"{a['match']} of {len(reps)} report file names carry this surname; {a['mismatch']} carry another name; {a['unchecked']} could not be read"
                                + (f"; the circuit code differs between reports ({', '.join(f'{c}: {n}' for c, n in a['circuits'].items())}) but every one names the same district ({resolution['district']})" if resolution else ""))),
                            ("Items listed with attribution not checked (report file name unreadable)", "; ".join(f"{k} {v:,}" for k, v in listed_unchecked.items() if v) or "none"),
                            ("Items not listed", "; ".join(
                                f"{k} {v:,} ({'attribution conflict' if withheld_by_reason['attribution_conflict'][k] else 'report file name carries another surname'})"
                                for k, v in withheld.items() if v) or "none"),
                            ("Reading", "Items are as CourtListener extracted them from the scanned reports; values are the report's own codes or text. Nothing is summed or converted.")]),
            text=f"financial disclosure {name} {pid} gifts reimbursements agreements", filters={"court": [cid or "unknown"]}, links=links, extra={"profile": profile}))
    rows.sort(key=lambda r: (-r["item"]["cells"]["reports"], r["id"]))
    summary = {
        "source": "CourtListener bulk data: financial-disclosures and its line-item files, people and positions (Free Law Project)", "snapshot": cc.SNAPSHOT, "terms": rc.TERMS,
        "totals": {"people": len(rows), "reports": sum(r["item"]["cells"]["reports"] for r in rows), "people_with_attribution_conflict": sum(1 for r in rows if r["item"]["profile"]["attribution"]["status"] == "conflict"),
                   "people_with_circuit_code_variance_only": sum(1 for r in rows if r["item"]["profile"]["attribution"]["conflict_resolution"] == "same_district"),
                   "reports_other_surname": sum(v["mismatch"] for v in attr.values()), "reports_unchecked": sum(v["unchecked"] for v in attr.values()),
                   "items_withheld": {k: sum(r["item"]["profile"]["items_withheld"][k] for r in rows) for k in KINDS},
                   "items_withheld_by_reason": {reason: {k: sum(r["item"]["profile"]["items_withheld_by_reason"][reason][k] for r in rows) for k in KINDS}
                                                for reason in ("other_surname", "attribution_conflict")},
                   "items_listed_attribution_not_checked": {k: sum(r["item"]["profile"]["items_listed_attribution_not_checked"][k] for r in rows) for k in KINDS}},
        "definitions": {"report year": "the year field of the disclosure report", "line items": "rows of each section table linked to the report by its id; one row per listed item",
                        "as filed": "text CourtListener extracted from the report; spelling and errors are the extraction's",
                        "redacted in the report": "CourtListener marks the line as redacted by the filer; the text shown is what CourtListener extracted around the redaction, and the redacted part is not in the source",
                        "attribution not checked": "the report's original file name has no readable name pattern, so the surname check could not be made; the item is listed on CourtListener's own link of the report to the person",
                        "report type code": "the stored code; the published schema does not describe it, so it is not decoded",
                        "court": "court of the person's latest-starting judicial position on record (display and filter only; reports follow the person)",
                        "attribution check": "CourtListener links each report to a person. This project reads the original file name of every report (Administrative Office names such as King-RB. J3. 04, Judicial Watch and nomination names) and checks, without similarity scoring, that it carries the person's surname. Items are listed from reports that pass and, labelled 'attribution not checked', from reports whose file name cannot be read; items of reports whose file name carries another surname are not listed. When a person's passing reports carry two different numbered circuits (01-11), the district codes decide: if every one names the same district, only the circuit digit differs and all items are listed; if they name more than one district, items are listed only from the reports coded for the district of the person's recorded court (when that district is carried by most of the reports), and otherwise no items are listed (attribution conflict)",
                        "report pdf": "CourtListener's copy of the report at storage.courtlistener.com, linked when its stored path names this person id"},
        "caveats": ["Reports cover what CourtListener collected (report years 1987-2022 in this snapshot), not every report a judge filed.",
                    "Extraction from scanned forms can misread text; check the report itself before relying on an item.",
                    "Investments, debts, income and outside positions are counted, not listed.", "Counts per year include every report CourtListener attributes to the person, also those whose items are withheld by the attribution check."],
        "grain": "one record per CourtListener person with at least one disclosure report"}
    return {DATASET: {
        "dataset": DATASET, "label": "Judges' financial disclosure reports in CourtListener by year: counts, gifts, reimbursements and agreements as filed (Sept 30, 2026)",
        "listing_block": writer.listing([("judge", "Judge"), ("court", "Court"), ("reports", "Reports"), ("first_year", "First year"), ("last_year", "Last year"), ("investments", "Investments"),
                                         ("gifts", "Gifts"), ("reimbursements", "Reimbursements"), ("agreements", "Agreements")], []),
        "summary": summary, "rows": rows, "built_at": built_at,
        "inputs": [{"url": rc.FD_URL, "path": "small.duckdb fd and line-item tables (financial-disclosure*-2026-09-30.csv.bz2)", "sha256": None}, {"url": rc.PEOPLE_URL, "path": "small.duckdb person", "sha256": None},
                   {"url": rc.FD_URL, "path": "fd_file.duckdb: report file paths (ingest_rest.py fd_files)", "sha256": None}]}}


if __name__ == "__main__":
    rc.write(build())
