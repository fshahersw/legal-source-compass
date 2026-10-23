"""Build `doj_oig_reports`: every report on the DOJ Office of the Inspector General's own reports page.

  python3 -I -B scripts/enrichment/oversight/build_doj_oig.py

Adds what Oversight.gov's listing lacks: the DOJ component(s), the external entity audited, a place, the PDF link and
any money fields the OIG states on the report page ("Questioned Costs", "Funds for Better Use"), each exactly as
printed with the machine value the page carries. Linked to the Oversight.gov record only on an equal, unique
(report number, date) pair.
"""
import os
import sys
from collections import Counter

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import build_oversight as bo  # noqa: E402
import common as cm  # noqa: E402
import doj_oig as dj  # noqa: E402
import rows as rw  # noqa: E402

DATASET = "doj_oig_reports"
SOURCE_PAGE = "https://oig.justice.gov/reports"


def money_cell(m):
    return rw.money_label(m["value"]) if m and m.get("value") is not None else rw.NOT_RECORDED


def build_record(r, oversight_path=None, oversight_ids=None):
    rid = "dojoig:" + dj.slug_of(r["path"])
    year = bo.year_of(r["date"])
    qc, fb = r["questioned_costs"], r["funds_better_use"]
    links = [{"url": r["url"], "label": "DOJ OIG report page"}]
    if r["pdf"]:
        links.append({"url": r["pdf"], "label": "Report file (as the OIG links it)"})
    ov_id = (oversight_ids or {}).get(oversight_path) if oversight_path else None
    if ov_id:
        links.append({"url": f"/records/oversight_reports/{ov_id}", "label": "Oversight.gov record"})
    desc, clipped = rw.clip(r["description"], 800)
    body = {
        "description": desc, "description_clipped": clipped, "participants": r["participants"], "projects": r["projects"],
        "date": r["date"], "year": year, "number": r["number"], "type": r["type"], "components": r["components"],
        "entity": r["entity"], "location": r["location"], "recommendations": r["recommendations"],
        "questioned_costs": qc, "funds_better_use": fb, "dollar_findings": r["dollar_findings"],
        "pdf_url": r["pdf"], "url": r["url"], "oversight_id": ov_id,
    }
    facts = [
        ("Report date", r["date"]), ("Report number", r["number"]), ("Report type", r["type"]),
        ("Component(s)", r["components"] or None), ("External entity", r["entity"]), ("Location", r["location"]),
        ("Number of recommendations", r["recommendations"]), ("Report file", r["pdf"]),
        ("Participating OIG(s)", r["participants"]), ("Special projects", r["projects"]),
        ("Questioned costs (as the OIG states them)", qc["text"] if qc else None),
        ("Funds for better use (as the OIG states them)", fb["text"] if fb else None),
        ("Source", "DOJ Office of the Inspector General, oig.justice.gov/reports"),
    ]
    return rw.record(
        DATASET, rid, r["title"], source_url=r["url"],
        subtitle=" · ".join(x for x in [", ".join(r["components"]) if r["components"] else None, r["type"], r["date"]] if x),
        cells={"date": r["date"] or rw.NOT_RECORDED, "type": r["type"] or rw.NOT_RECORDED, "number": r["number"] or rw.NOT_RECORDED,
               "component": "; ".join(r["components"]) if r["components"] else rw.NOT_RECORDED,
               "questioned": money_cell(qc), "better_use": money_cell(fb)},
        facts=facts, links=links,
        filters={"type": [r["type"]] if r["type"] else [], "component": list(r["components"]), "year": [str(year)] if year else [],
                 "has_amount": ["yes" if (qc and qc.get("value")) or (fb and fb.get("value")) else "no"]},
        extra={"dojoig": body},
        text=" ".join(x for x in [r["number"], r["type"], " ".join(r["components"]), r["entity"], r["location"], desc] if x))


def main():
    doj_rows, stats = dj.collect()
    if not doj_rows:
        raise SystemExit("no DOJ OIG pages found; run fetch_doj_oig.py first")
    items, _ = bo.collect("federal")
    links = dj.crosslink(doj_rows, items) if items else {}
    oversight_ids = {r["path"]: rw.stable_id("ovr", r["path"]) for r in items}
    records = [build_record(r, links.get(r["path"]), oversight_ids) for r in doj_rows]
    records.sort(key=lambda row: (row["item"]["dojoig"]["date"] or "", row["id"]), reverse=True)
    comps = Counter(c for r in doj_rows for c in r["components"])
    types = Counter(r["type"] for r in doj_rows if r["type"])
    years = sorted({str(bo.year_of(r["date"])) for r in doj_rows if r["date"]}, reverse=True)
    inputs = rw.manifest_inputs([cm.rel(os.path.join(cm.ACQ, "doj_oig"))])
    mismatches = sum(1 for r in doj_rows if r["posted"] and r["date"] and r["posted"] != r["date"])
    summary = {
        "source": "U.S. Department of Justice Office of the Inspector General, report listing and report pages", "source_page": SOURCE_PAGE,
        "terms": "oig.justice.gov robots.txt allows /reports and sets no crawl delay; read at one request per 1.1 s. Reports are works of the U.S. Government; only the page's own fields are kept.",
        "coverage": f"{len(records):,} reports; report dates {min(r['date'] for r in doj_rows if r['date'])} to {max(r['date'] for r in doj_rows if r['date'])}",
        "fields": "Everything is as the report page prints it. Money fields are stored with the printed text and the page's machine value; a report that does not print a field has none (Not recorded). Semiannual reports state sums for their period, so they are excluded from the yearly money totals in oversight_trends.",
        "matching": "Linked to an oversight_reports record only on equal, unique (report number, report date).",
        "stats": {**stats, "oversight_crosslinks": len(links), "listing_vs_page_date_mismatches": mismatches,
                  "with_questioned_costs": sum(1 for r in doj_rows if r["questioned_costs"]),
                  "with_funds_better_use": sum(1 for r in doj_rows if r["funds_better_use"]),
                  "with_pdf": sum(1 for r in doj_rows if r["pdf"]), "unknown_labels": sorted({k for r in doj_rows for k in r["other_labels"]})},
    }
    lb = rw.listing(
        [("date", "Report date"), ("number", "Report no."), ("type", "Type"), ("component", "Component"), ("questioned", "Questioned costs"), ("better_use", "Funds for better use")],
        [("type", "Report type", {t: t for t in sorted(types)}), ("component", "DOJ component", {c: c for c in sorted(comps) if len(c) <= 80}), ("year", "Report year", {y: y for y in years}),
         ("has_amount", "States a dollar amount", {"yes": "Yes, above $0", "no": "No amount above $0 stated"})])
    rw.write_build(DATASET, "DOJ Office of the Inspector General reports (oig.justice.gov)", records, lb, summary, inputs)


if __name__ == "__main__":
    main()
