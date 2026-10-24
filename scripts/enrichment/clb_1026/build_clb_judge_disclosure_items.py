"""Build clb_judge_disclosure_items: what each judge's financial disclosure reports in CourtListener contain, by report year
and section, with value ranges kept as the printed form codes.

Source: the nine financial-disclosure bulk files of Sept 30, 2026 (reports and their eight line-item sections), joined on exact
ids (line item financial_disclosure_id -> report id -> person id). Per person and report year:
* reports by report type (CourtListener's legend: Nomination, Initial, Annual, Final, Unknown), amended, pages;
* line items per section (investments, gifts, reimbursements, agreements, outside positions, debts, non-investment income,
  spousal income);
* investments counted by the printed gross value code (J ... P4), income code (A ... H2), income type as printed, transaction
  type as printed and transaction value code; debts counted by the printed value code. Each code is shown with the range the
  form assigns to it (CourtListener's legend). No amount is summed, averaged or converted, and no midpoint is used;
* listed items (outside positions, non-investment income with the amount as filed, spousal income, debts with their value code)
  only from reports whose original file name carries the person's surname, and never for a person whose matching reports carry
  two numbered circuits (the attribution rule of clb_judge_disclosures, reused unchanged from courtlistener_rest/rest_common.py).
Overview records per report year give the same counts for all reports together.
"""
from __future__ import annotations

import os
import sys
import time
from collections import Counter, defaultdict

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", "..", ".."))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment", "courtlistener_rest"))

import clb1026_common as cm  # noqa: E402
import corpus_writer as writer  # noqa: E402
import rest_common as rc  # noqa: E402  (attribution helpers only)

DATASET = "clb_judge_disclosure_items"
REPORTS = "financial-disclosures-2026-09-30.csv.bz2"
SECTIONS = [
    ("investments", "financial-disclosure-investments-2026-09-30.csv.bz2", "Investments"),
    ("gifts", "financial-disclosures-gifts-2026-09-30.csv.bz2", "Gifts"),
    ("reimbursements", "financial-disclosures-reimbursements-2026-09-30.csv.bz2", "Reimbursements"),
    ("agreements", "financial-disclosures-agreements-2026-09-30.csv.bz2", "Agreements"),
    ("outside_positions", "financial-disclosures-positions-2026-09-30.csv.bz2", "Outside positions"),
    ("debts", "financial-disclosures-debts-2026-09-30.csv.bz2", "Debts"),
    ("non_investment_income", "financial-disclosures-non-investment-income-2026-09-30.csv.bz2", "Non-investment income"),
    ("spousal_income", "financial-disclosures-spousal-income-2026-09-30.csv.bz2", "Spousal income"),
]
SECTION_KEYS = [k for k, _, _ in SECTIONS]
PEOPLE = "people-db-people-2026-09-30.csv.bz2"
VALUE_CODES = ["J", "K", "L", "M", "N", "O", "P1", "P2", "P3", "P4", "-1"]
INCOME_CODES = ["A", "B", "C", "D", "E", "F", "G", "H1", "H2", "-1"]
NOT_RECORDED = "none"  # key for a blank code: the line carries no code
LIST_CAP = 300  # listed items per section per person (most recent report years first); all are counted
TOP_TEXT = 8  # printed income/transaction types kept per person (all years)


def code_key(v, allowed):
    c = cm.blank(v)
    if c is None:
        return NOT_RECORDED
    return c if c in allowed else "other"


def ordered_counts(counter: Counter, order: list[str]) -> list[list]:
    """[[code, n], ...] in form order, then 'other' and 'none'; zero counts dropped."""
    keys = [k for k in order if counter.get(k)] + [k for k in ("other", NOT_RECORDED) if counter.get(k)]
    return [[k, counter[k]] for k in keys]


def top_text(counter: Counter, n: int = TOP_TEXT) -> list[list]:
    return [[k, v] for k, v in sorted(counter.items(), key=lambda kv: (-kv[1], kv[0]))[:n]]


def build() -> dict:
    leg = cm.legends()
    rt_legend = leg["financial-disclosures"]["report_type"]
    val_legend = leg["investments"]["gross_value_code"]
    inc_legend = leg["investments"]["income_during_reporting_period_code"]
    debt_legend = leg["debts"]["value_code"]
    if val_legend != debt_legend or val_legend != leg["investments"]["transaction_value_code"]:
        raise SystemExit("value-code legends differ between endpoints: check before building")
    people = {int(r["id"]): r for r in cm.pg_rows(cm.bulk_path(PEOPLE))}
    reports = {}
    by_person = defaultdict(list)
    for r in cm.pg_rows(cm.bulk_path(REPORTS)):
        pid = cm.as_int(r["person_id"])
        rid = int(r["id"])
        rep = {"id": rid, "person_id": pid, "year": cm.as_int(r["year"]), "type_code": cm.blank(r["report_type"]), "amended": r["is_amended"] == "t",
               "pages": cm.as_int(r["page_count"]), "extracted": r["has_been_extracted"] == "t", "filepath": cm.blank(r["filepath"]),
               "download": cm.blank(r["download_filepath"])}
        reports[rid] = rep
        if pid is not None:
            by_person[pid].append(rep)
    # attribution check per person (same rule and helpers as clb_judge_disclosures)
    shown = set()
    attr = {}
    for pid, reps in by_person.items():
        parsed = [rc.parse_filer_file(r["download"]) for r in reps]
        a = rc.attribution(cm.blank(people.get(pid, {}).get("name_last")), parsed)
        attr[pid] = a
        for r, chk in zip(reps, a["checks"]):
            r["file_check"] = chk
            if chk == "match" and a["status"] != "conflict":
                shown.add(r["id"])
    # per (person, year) aggregates and the national per-year aggregates
    agg = defaultdict(lambda: {"sections": Counter(), "redacted": Counter(), "gross": Counter(), "income": Counter(), "income_type": Counter(),
                               "tx_type": Counter(), "tx_value": Counter(), "transactions": 0, "inferred": 0, "debt_value": Counter()})
    nat = defaultdict(lambda: {"sections": Counter(), "redacted": Counter(), "gross": Counter(), "income": Counter(), "tx_value": Counter(),
                               "transactions": 0, "debt_value": Counter()})
    items = defaultdict(lambda: defaultdict(list))
    orphan = Counter()
    rows_read = Counter()
    for key, fname, _ in SECTIONS:
        for r in cm.pg_rows(cm.bulk_path(fname)):
            rows_read[key] += 1
            rep = reports.get(cm.as_int(r["financial_disclosure_id"]))
            if rep is None or rep["person_id"] is None:
                orphan[key] += 1
                continue
            a = agg[(rep["person_id"], rep["year"])]
            n = nat[rep["year"]]
            a["sections"][key] += 1
            n["sections"][key] += 1
            red = r.get("redacted") == "t"
            if red:
                a["redacted"][key] += 1
                n["redacted"][key] += 1
            if key == "investments":
                g = code_key(r["gross_value_code"], VALUE_CODES)
                i = code_key(r["income_during_reporting_period_code"], INCOME_CODES)
                a["gross"][g] += 1
                n["gross"][g] += 1
                a["income"][i] += 1
                n["income"][i] += 1
                t = cm.clip(r["income_during_reporting_period_type"], 40)
                if t:
                    a["income_type"][t] += 1
                tx = cm.clip(r["transaction_during_reporting_period"], 40)
                if tx:
                    a["transactions"] += 1
                    n["transactions"] += 1
                    a["tx_type"][tx] += 1
                    v = code_key(r["transaction_value_code"], VALUE_CODES)
                    a["tx_value"][v] += 1
                    n["tx_value"][v] += 1
                if r["has_inferred_values"] == "t":
                    a["inferred"] += 1
                continue
            if key == "debts":
                v = code_key(r["value_code"], VALUE_CODES)
                a["debt_value"][v] += 1
                n["debt_value"][v] += 1
            if rep["id"] not in shown or key not in ("outside_positions", "non_investment_income", "spousal_income", "debts"):
                continue
            base = {"year": rep["year"], "report_id": rep["id"], "redacted": red}
            if red:
                items[rep["person_id"]][key].append(base)
            elif key == "outside_positions":
                items[rep["person_id"]][key].append({**base, "position": cm.clip(r["position"], 160), "organization": cm.clip(r["organization_name"], 200)})
            elif key == "non_investment_income":
                items[rep["person_id"]][key].append({**base, "date_as_filed": cm.clip(r["date_raw"], 60), "source_as_filed": cm.clip(r["source_type"], 240),
                                                     "amount_as_filed": cm.clip(r["income_amount"], 80)})
            elif key == "spousal_income":
                items[rep["person_id"]][key].append({**base, "source_as_filed": cm.clip(r["source_type"], 240), "date_as_filed": cm.clip(r["date_raw"], 60)})
            elif key == "debts":
                vc = cm.blank(r["value_code"])
                items[rep["person_id"]][key].append({**base, "creditor_as_filed": cm.clip(r["creditor_name"], 160), "description_as_filed": cm.clip(r["description"], 200),
                                                     "value_code": vc, "value_range": debt_legend.get(vc) if vc else None})
    built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    src = cm.BULK_BASE + REPORTS
    rows = []

    def year_view(a, reps_y):
        types = Counter(r["type_code"] for r in reps_y)
        return {
            "reports": len(reps_y), "amended": sum(1 for r in reps_y if r["amended"]), "pages": sum(r["pages"] or 0 for r in reps_y),
            "report_types": [[c, rt_legend.get(c, "Code not in CourtListener's legend"), n] for c, n in sorted(types.items(), key=lambda kv: (-kv[1], str(kv[0])))],
            "items": {k: a["sections"].get(k, 0) for k in SECTION_KEYS},
            "redacted": {k: a["redacted"][k] for k in SECTION_KEYS if a["redacted"].get(k)},
            "investments": {"gross_value": ordered_counts(a["gross"], VALUE_CODES), "income": ordered_counts(a["income"], INCOME_CODES),
                            "transactions": a["transactions"], "transaction_value": ordered_counts(a["tx_value"], VALUE_CODES),
                            "inferred_names": a["inferred"]},
            "debts": {"value": ordered_counts(a["debt_value"], VALUE_CODES)},
        }

    for pid in sorted(by_person):
        reps = by_person[pid]
        p = people.get(pid)
        name = " ".join(x for x in (cm.blank(p.get(k)) for k in ("name_first", "name_middle", "name_last")) if x) if p else None
        name = name or "Name not recorded"
        years = sorted({r["year"] for r in reps if r["year"] is not None})
        yv = []
        tot = Counter()
        inc_types, tx_types = Counter(), Counter()
        for y in years + ([None] if any(r["year"] is None for r in reps) else []):
            reps_y = [r for r in reps if r["year"] == y]
            a = agg[(pid, y)]
            tot.update(a["sections"])
            inc_types.update(a["income_type"])
            tx_types.update(a["tx_type"])
            yv.append({"year": y, **year_view(a, reps_y)})
        a_ = attr[pid]
        conflict = a_["status"] == "conflict"
        listed = {}
        listed_total = {}
        for key in ("outside_positions", "non_investment_income", "spousal_income", "debts"):
            its = sorted(items[pid][key], key=lambda r: (-(r["year"] or 0), r["report_id"]))
            listed_total[key] = len(its)
            listed[key] = its[:LIST_CAP]
        profile = {
            "person_id": pid, "name": name, "reports": len(reps), "first_year": years[0] if years else None, "last_year": years[-1] if years else None,
            "years": yv, "items_total": {k: tot.get(k, 0) for k in SECTION_KEYS},
            "income_types_as_printed": top_text(inc_types, 8), "transaction_types_as_printed": top_text(tx_types, 8),
            "listed": listed, "listed_total": listed_total, "list_cap": LIST_CAP,
            "attribution": {"status": a_["status"], "circuits": a_["circuits"], "reports_matching_surname": a_["match"], "reports_other_surname": a_["mismatch"], "reports_unchecked": a_["unchecked"]},
            "report_ids": sorted(r["id"] for r in reps),
        }
        latest = next((y for y in reversed(yv) if y["year"] is not None), None)
        span = f"{years[0]}–{years[-1]}" if years else "years not recorded"
        fact_pairs = [("Judge (CourtListener person id)", f"{name} ({pid})"), ("Reports", f"{len(reps):,} ({span})")]
        if latest:
            gv = "; ".join(f"{c} ({val_legend.get(c, 'blank' if c == NOT_RECORDED else c)}): {n:,}" for c, n in latest["investments"]["gross_value"])
            fact_pairs += [(f"Report types, {latest['year']}", "; ".join(f"{lbl}: {n}" for _, lbl, n in latest["report_types"])),
                           (f"Investments by printed value code, {latest['year']}", gv or None),
                           (f"Investment transactions listed, {latest['year']}", f"{latest['investments']['transactions']:,}")]
        fact_pairs += [(f"{lbl} (all reports)", f"{tot.get(k, 0):,}") for k, _, lbl in SECTIONS]
        fact_pairs += [("Items listed here", "none: the reports carry more than one circuit code" if conflict else
                        "; ".join(f"{k.replace('_', ' ')} {listed_total[k]:,}" for k in listed_total if listed_total[k]) or "none"),
                       ("Reading", "Codes are the printed form codes; each stands for a range (for example J = 1 - 15,000 dollars). Nothing is summed, averaged or converted.")]
        rows.append(writer.record(
            DATASET, str(pid), f"{name}: financial disclosure contents by year and section (CourtListener)", source_url=src,
            subtitle=f"{len(reps):,} report{'s' if len(reps) != 1 else ''} · {span} · {tot.get('investments', 0):,} investment lines · {tot.get('debts', 0):,} debts · {tot.get('outside_positions', 0):,} outside positions",
            cells={"judge": name, "reports": len(reps), "first_year": profile["first_year"], "last_year": profile["last_year"], **{k: tot.get(k, 0) for k in SECTION_KEYS}},
            badges=["CourtListener bulk data", "As filed, not verified", "Printed value codes"] + (["Attribution conflict: items withheld"] if conflict else []),
            facts=cm.facts(fact_pairs),
            text=f"financial disclosure {name} {pid} investments debts outside positions non-investment income spousal income",
            filters={"kind": ["person"]},
            links=[{"label": "CourtListener person page", "url": f"https://www.courtlistener.com/person/{pid}/"},
                   {"label": "Reports and gifts record", "url": f"/records/clb_judge_disclosures/{pid}"}],
            extra={"profile": cm.compact(profile)}))
    # national per-year records
    # every report year gets a record, also a year whose reports carry no line item (its counts are zero, not missing)
    for y in sorted({r["year"] for r in reports.values() if r["year"] is not None}):
        n = nat[y]
        reps_y = [r for r in reports.values() if r["year"] == y]
        types = Counter(r["type_code"] for r in reps_y)
        prof = {"year": y, "reports": len(reps_y), "people": len({r["person_id"] for r in reps_y if r["person_id"] is not None}),
                "report_types": [[c, rt_legend.get(c, "Code not in CourtListener's legend"), k] for c, k in sorted(types.items(), key=lambda kv: (-kv[1], str(kv[0])))],
                "items": {k: n["sections"].get(k, 0) for k in SECTION_KEYS}, "redacted": {k: n["redacted"][k] for k in SECTION_KEYS if n["redacted"].get(k)},
                "investments": {"gross_value": ordered_counts(n["gross"], VALUE_CODES), "income": ordered_counts(n["income"], INCOME_CODES),
                                "transactions": n["transactions"], "transaction_value": ordered_counts(n["tx_value"], VALUE_CODES)},
                "debts": {"value": ordered_counts(n["debt_value"], VALUE_CODES)}}
        rows.append(writer.record(
            DATASET, f"year:{y}", f"Financial disclosure contents in CourtListener, report year {y}", source_url=src,
            subtitle=f"{prof['reports']:,} reports · {prof['people']:,} people · {prof['items']['investments']:,} investment lines",
            cells={"judge": f"All reports, {y}", "reports": prof["reports"], "first_year": y, "last_year": y, **prof["items"]},
            badges=["CourtListener bulk data", "Counts by printed code"],
            facts=cm.facts([("Report year", y), ("Reports", f"{prof['reports']:,}"), ("People", f"{prof['people']:,}"),
                            ("Report types", "; ".join(f"{lbl}: {k:,}" for _, lbl, k in prof["report_types"])),
                            ("Investments by printed value code", "; ".join(f"{c}: {k:,}" for c, k in prof["investments"]["gross_value"]) or None),
                            ("Debts by printed value code", "; ".join(f"{c}: {k:,}" for c, k in prof["debts"]["value"]) or None),
                            *[(lbl, f"{prof['items'][k]:,}") for k, _, lbl in SECTIONS]]),
            text=f"financial disclosure report year {y} investments value codes", filters={"kind": ["year"]},
            links=[{"label": "CourtListener financial disclosures", "url": "https://www.courtlistener.com/financial-disclosures/"}], extra={"profile": cm.compact(prof)}))
    rows.sort(key=lambda r: (0 if r["id"].startswith("year:") else 1, r["id"] if r["id"].startswith("year:") else "", -r["item"]["cells"]["reports"], r["id"]))
    inputs = [cm.bulk_input(REPORTS)] + [cm.bulk_input(f) for _, f, _ in SECTIONS] + [cm.bulk_input(PEOPLE)]
    for ep in ("financial-disclosures", "investments", "debts"):
        s = leg[ep]["_source"]
        inputs.append({"url": s["url"], "path": "OPTIONS legend", "sha256": s["sha256"], "retrieved_at": s["retrieved_at"]})
    summary = {
        "source": "CourtListener bulk data: financial-disclosures and its eight line-item files, people (Free Law Project), Sept 30, 2026; code legends from the REST API's OPTIONS responses",
        "snapshot": cm.SNAPSHOT, "terms": cm.TERMS,
        "legends": {"report_type": rt_legend, "value_code": val_legend, "income_code": inc_legend, "gross_value_method": leg["investments"].get("gross_value_method")},
        "totals": {"people": len(by_person), "reports": len(reports), "rows_read": dict(rows_read), "line_items_without_report_or_person": dict(orphan),
                   "people_with_attribution_conflict": sum(1 for v in attr.values() if v["status"] == "conflict"),
                   "reports_passing_attribution": len(shown)},
        "definitions": {
            "value code": "the code printed on the report for a value range; the range shown beside it is the form's (CourtListener's legend, in dollars). 'none' = the line carries no code; 'other' = a code outside the legend; -1 = CourtListener could not extract it",
            "income type / transaction type": "the text printed on the report, whitespace collapsed; the most frequent eight per person (all report years together) are kept",
            "listed items": "outside positions, non-investment income, spousal income and debts, item by item as CourtListener extracted them, from reports that pass the file-name attribution check",
            "counts": "every line item linked to the person's reports by id, including reports whose items are not listed",
            "report year": "the year field of the report",
        },
        "caveats": ["Extraction from scanned forms can misread text and codes; check the report before relying on an item.",
                    "Report years run 1987-2022 in this snapshot; later reports are not in the collection.",
                    "A code is a range, not an amount; ranges are never summed or averaged here.",
                    f"Up to {LIST_CAP} items per section are listed per person (most recent years first); all are counted."],
        "grain": "one record per CourtListener person with a disclosure report, plus one record per report year",
    }
    return {
        "dataset": DATASET,
        "label": "Judges' financial disclosure contents in CourtListener by year: investments and debts by printed value code, outside positions and income as filed (Sept 30, 2026)",
        "listing_block": writer.listing([("judge", "Judge"), ("reports", "Reports"), ("first_year", "First year"), ("last_year", "Last year"), ("investments", "Investment lines"),
                                         ("debts", "Debts"), ("outside_positions", "Outside positions"), ("non_investment_income", "Non-investment income"),
                                         ("spousal_income", "Spousal income")],
                                        [("kind", "Type", {"person": "Judge", "year": "Report year"})]),
        "summary": summary, "rows": rows, "built_at": built_at, "inputs": inputs,
    }


if __name__ == "__main__":
    cm.write_build(build())
