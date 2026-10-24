"""Build cra_reports (one row per class action research report) and cra_facts (one row per fact) for the corpus.

Inputs: the fetched report PDFs and their text layers under private/acq/cra/ (manifest with sha256 of the original bytes).
Facts come from printed tables (cra_specs) and from report prose (cra_textfacts); nothing is read off a chart. Every fact
names the publisher, report, page, table or text, row and column labels as printed, unit and dollar basis.

Outputs (private/build/cra/): cra_reports.json and cra_facts.json in the build-file format of publish_build.py,
verification/evidence.json.gz (the sentences text facts come from; private, never published), checks.json (cross-checks:
within-report agreement, restatements across vintages, cross-publisher comparison), tables.json (every table extracted
or held, with the reason), and a summary printed to stdout.

    python3 -I -B scripts/enrichment/cra/build_cra.py
"""
from __future__ import annotations

import collections
import gzip
import hashlib
import json
import os
import re
import sys
import time

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = "/home/user/legal-source-compass"
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(ROOT, "scripts", "enrichment"))

import corpus_writer as writer  # noqa: E402
import cra_extract  # noqa: E402
import cra_inventory  # noqa: E402
import cra_specs as S  # noqa: E402
import cra_tables as T  # noqa: E402
import cra_text  # noqa: E402
import cra_textfacts as X  # noqa: E402

OUT = os.path.join(ROOT, "private", "build", "cra")
OWNER = "Owner decision 2026-10-24: the owner states written permission was obtained from the publishers for this use."
TERMS = {
    "Cornerstone Research": "https://www.cornerstone.com/conditions-terms-of-use/",
    "Cornerstone Research and the Stanford Law School Securities Class Action Clearinghouse":
        "https://www.cornerstone.com/conditions-terms-of-use/ ; https://securities.stanford.edu/about-the-scac.html (Terms of Service)",
    "NERA Economic Consulting": "https://www.nera.com/terms-of-use.html",
}
UNIT_LABEL = {"filings": "filings", "firms": "companies", "settlements": "settlements", "cases": "cases", "percent": "percent",
              "usd_billions": "US$ billions", "usd_millions": "US$ millions", "usd_thousands": "US$ thousands", "usd": "US$",
              "docket entries": "docket entries"}


def slug(s: str, n: int = 60) -> str:
    return re.sub(r"[^a-z0-9]+", "-", s.lower()).strip("-")[:n]


def fact_id(f: S.Fact) -> str:
    base = "|".join([f.table, f.series, f.dimension, f.period, f.aggregate, f.row_label, f.column_label, str(f.pdf_page)])
    return f"{f.report_id}:{hashlib.sha256(base.encode()).hexdigest()[:16]}"


def collect():
    res, reps = cra_extract.run()
    evidence = []
    for rep in reps:
        if rep["family"] in ("nera_us", "cr_filings"):
            pages = cra_text.pages_of(rep["sha256"])
            facts, ev = X.apply(rep, cra_text.plain_pages(rep["sha256"]), T.printed_pages(pages))
            res.facts.extend(facts)
            evidence.extend(ev)
    return res, reps, evidence


def checks(facts: list[S.Fact], reps: dict) -> dict:
    """Cross-checks. (1) Within a report, the same measure printed twice must agree. (2) Across vintages of one publisher,
    the same measure for the same period (same unit and dollar basis) restated with a different value. (3) Filings per
    year from the two publishers side by side (different definitions: listed, not reconciled)."""
    out = {"within_report": [], "restated": [], "cross_publisher_filings": []}
    by = collections.defaultdict(list)
    for f in facts:
        by[(f.report_id, f.series, f.dimension, f.period, f.aggregate, f.unit, f.basis)].append(f)
    for k, fs in by.items():
        vals = {f.value for f in fs}
        if len(vals) > 1:
            out["within_report"].append({"report": k[0], "series": k[1], "dimension": k[2], "period": k[3], "aggregate": k[4],
                                         "values": [{"value": f.value_text, "table": f.table, "page": f.pdf_page} for f in fs]})
    pub = {r: v["publisher"] for r, v in reps.items()}
    date = {r: v["date"] for r, v in reps.items()}
    vint = collections.defaultdict(list)
    for f in facts:
        if f.partial:
            continue
        fam = reps[f.report_id]["family"]
        vint[(fam, f.series, f.dimension, f.period, f.aggregate, f.unit, f.basis, f.scope)].append(f)
    for k, fs in vint.items():
        per_report = {}
        for f in fs:
            per_report.setdefault(f.report_id, f)
        if len({f.value for f in per_report.values()}) > 1:
            out["restated"].append({"family": k[0], "series": k[1], "dimension": k[2], "period": k[3], "aggregate": k[4],
                                    "unit": k[5], "basis": k[6], "scope": k[7],
                                    "vintages": sorted(({"report": r, "date": date[r], "value": f.value_text, "page": f.pdf_page}
                                                        for r, f in per_report.items()), key=lambda x: x["report"])})
    # cross-publisher filings per calendar year: latest vintage of each
    latest = {}
    for f in facts:
        if f.series in ("filings.class_action_filings", "nera.filings") and f.period_type == "year" and not f.aggregate and not f.partial:
            k = (f.series, f.period)
            if k not in latest or reps[f.report_id]["id"] > reps[latest[k].report_id]["id"]:
                latest[k] = f
    years = sorted({p for (_, p) in latest})
    for y in years:
        a, b = latest.get(("filings.class_action_filings", y)), latest.get(("nera.filings", y))
        if a and b:
            out["cross_publisher_filings"].append({"year": y, "cornerstone": a.value_text, "cornerstone_report": a.report_id,
                                                   "cornerstone_scope": a.scope, "nera": b.value_text, "nera_report": b.report_id})
    return out


def fact_row(f: S.Fact, rep: dict) -> dict:
    unit = UNIT_LABEL.get(f.unit, f.unit)
    when = f"{f.period}{' (' + f.aggregate + ')' if f.aggregate else ''}"
    title = f"{f.series_label}{', ' + f.dimension.split(': ', 1)[1] if f.dimension else ''}, {when}: {f.value_text}"
    page = f.printed_page or str(f.pdf_page)
    src = f"{rep['pdf_url']}#page={f.pdf_page}"
    facts = [
        ["Value as printed", f.value_text], ["Unit", unit], ["Dollar basis", f.basis or "Not applicable"],
        ["Period", f.period], ["Aggregate", f.aggregate or "Single period"],
        ["Breakdown", f.dimension or "None"], ["Population as printed", f.scope or "Not stated"],
        ["Printed in", f.table if f.method == "table" else "Report text"], ["Row as printed", f.row_label],
        ["Column as printed", f.column_label], ["Report", rep["title"]], ["Publisher", rep["publisher"]],
        ["Report date", f"{rep['date']} ({rep['date_basis']})" if rep["date_basis"] else rep["date"]],
        ["PDF page", str(f.pdf_page)], ["Printed page", f.printed_page or "Not recorded"],
    ]
    if f.partial or f.note:
        facts.append(["Note", f.note or "Partial period"])
    facts.append(["Source", f"{rep['publisher']}, {rep['title']}, {rep['date']}, page {page}"])
    d = f.to_dict()
    profile = {k: d[k] for k in ("report_id", "series", "period", "period_type", "aggregate", "value", "value_text", "unit", "basis",
                                 "dimension", "scope", "table", "row_label", "column_label", "pdf_page", "printed_page", "method")}
    if f.partial:
        profile["partial"] = True
    if f.note:
        profile["note"] = f.note
    return writer.record(
        "cra_facts", fact_id(f), title, source_url=src,
        subtitle=f"{rep['publisher']} · {rep['title']} · p. {page}",
        cells={"series": f.series_label, "period": when, "value": f.value_text, "unit": unit, "report": rep["title"], "page": page},
        facts=facts, text=f"{f.series_label} {f.dimension} {f.period} {rep['publisher']} {rep['title']}",
        filters={"series": [f.series], "report": [f.report_id], "publisher": [rep["publisher"]], "family": [rep["family"]],
                 "method": [f.method], "period_type": [f.period_type]},
        links=[{"label": "Report", "href": f"/records/cra_reports/{rep['id']}"}],
        extra={"profile": profile})


def report_row(rep: dict, n_facts: int, tables: list[dict], text_layer: bool) -> dict:
    ext = [t for t in tables if t["status"] == "extracted"]
    hel = [t for t in tables if t["status"] == "held"]
    status = ("facts extracted" if n_facts else
              "no text layer (image pages); not extracted" if not text_layer else
              "inventoried; no printed table or stated fact in this build's scope")
    facts = [
        ["Publisher", rep["publisher"]], ["Series", rep["family_label"]], ["Edition", rep["edition"]], ["Period covered", rep["period"]],
        ["Date", f"{rep['date']} ({rep['date_basis']})" if rep["date_basis"] else rep["date"]], ["Pages", str(rep["pages"])],
        ["Report PDF", rep["pdf_url"]], ["File sha256", rep["sha256"]], ["Retrieved", rep["retrieved_at"]],
        ["Facts extracted", str(n_facts)], ["Tables extracted", str(len(ext))], ["Tables held", str(len(hel))],
        ["Status", status], ["Terms", TERMS.get(rep["publisher"], "")], ["Permission", OWNER],
    ]
    if rep["landing_url"]:
        facts.append(["Publisher page", rep["landing_url"]])
    if rep["alt_urls"]:
        facts.append(["Other copies", "; ".join(rep["alt_urls"])])
    profile = {**{k: v for k, v in rep.items()}, "facts": n_facts, "status": status, "tables": tables}
    return writer.record(
        "cra_reports", rep["id"], rep["title"], source_url=rep["pdf_url"],
        subtitle=f"{rep['publisher']} · {rep['edition']} · {rep['date']}",
        cells={"title": rep["title"], "publisher": rep["publisher"], "edition": rep["edition"], "date": rep["date"],
               "pages": rep["pages"], "facts": n_facts},
        facts=facts, text=f"{rep['title']} {rep['publisher']} {rep['edition']} class action research report",
        filters={"publisher": [rep["publisher"]], "family": [rep["family"]], "status": [status.split(";")[0].split(" (")[0]]},
        links=[], extra={"profile": profile})


def main() -> None:
    t0 = time.time()
    built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    res, reps, evidence = collect()
    rep_by = {r["id"]: r for r in reps}
    # one fact per printed place: drop exact duplicates of the same table cell
    seen, facts = set(), []
    for f in res.facts:
        fid = fact_id(f)
        if fid in seen:
            continue
        seen.add(fid)
        facts.append(f)
    facts.sort(key=lambda f: (f.report_id, f.series, f.dimension, f.period, f.aggregate))
    ck = checks(facts, rep_by)
    n_by = collections.Counter(f.report_id for f in facts)
    tab_by = collections.defaultdict(list)
    for t in res.tables:
        tab_by[t["report"]].append(t)
    rows_r = [report_row(r, n_by.get(r["id"], 0), tab_by.get(r["id"], []), r["text_chars"] >= 2000) for r in reps]
    rows_f = [fact_row(f, rep_by[f.report_id]) for f in facts]
    inputs = [{"url": r["pdf_url"], "path": f"private/acq/cra/raw (sha256 {r['sha256']})", "sha256": r["sha256"]} for r in reps]
    series_list = sorted({(f.series, f.series_label, f.unit) for f in facts})
    summary = {
        "source": "Research reports by Cornerstone Research (some with the Stanford Law School Securities Class Action Clearinghouse) "
                  "and NERA Economic Consulting; each fact names its report, page and table or text.",
        "permission": OWNER, "terms": TERMS,
        "method": "Facts are read from the PDF text layer: printed tables (every row must fit the table's columns; a table with a "
                  "Total row must add up to it or is held) and strict sentence patterns in the prose. Values printed only inside "
                  "charts are not used. Dollar values keep the basis the report states (e.g. inflation-adjusted to 2025 dollars); "
                  "'not stated' where the report states none. Values restated in later reports are kept per report vintage.",
        "counts": {"reports": len(rows_r), "facts": len(rows_f), "facts_by_method": dict(collections.Counter(f.method for f in facts)),
                   "facts_by_publisher": dict(collections.Counter(rep_by[f.report_id]["publisher"] for f in facts)),
                   "tables_extracted": sum(t["status"] == "extracted" for t in res.tables),
                   "tables_held": sum(t["status"] == "held" for t in res.tables), "issues": len(res.issues),
                   "within_report_disagreements": len(ck["within_report"]), "restated_across_vintages": len(ck["restated"])},
        "series": [{"key": k, "label": l, "unit": u} for k, l, u in series_list],
    }
    os.makedirs(os.path.join(OUT, "verification"), exist_ok=True)
    specs = {
        "cra_reports": ("Class action research reports: securities and accounting class action filings and settlements "
                        "(Cornerstone Research, Stanford Clearinghouse, NERA)", rows_r,
                        writer.listing([("title", "Report"), ("publisher", "Publisher"), ("edition", "Edition"), ("date", "Date"),
                                        ("pages", "Pages"), ("facts", "Facts")],
                                       [("publisher", "Publisher", {p: p for p in sorted({r["publisher"] for r in reps})}),
                                        ("family", "Series", {k: v for k, v in cra_inventory.FAMILIES.items()})])),
        "cra_facts": ("Facts from class action research reports: filings, Disclosure and Maximum Dollar Loss, settlements, "
                      "dismissal rates and accounting cases, with report and page", rows_f,
                      writer.listing([("series", "Measure"), ("period", "Period"), ("value", "Value"), ("unit", "Unit"),
                                      ("report", "Report"), ("page", "Page")],
                                     [("publisher", "Publisher", {p: p for p in sorted({r["publisher"] for r in reps})}),
                                      ("family", "Series", {k: v for k, v in cra_inventory.FAMILIES.items()}),
                                      ("method", "Printed in", {"table": "Table", "text": "Report text"})])),
    }
    for ds, (label, rows, listing) in specs.items():
        spec = {"dataset": ds, "label": label, "listing_block": listing, "summary": {**summary, "totals": {"records": len(rows)}},
                "rows": rows, "built_at": built_at, "inputs": inputs}
        path = os.path.join(OUT, ds + ".json.gz")
        with gzip.open(path + ".tmp", "wt", encoding="utf-8", compresslevel=9) as h:
            json.dump(spec, h, ensure_ascii=False, sort_keys=True)
        os.replace(path + ".tmp", path)
        stale = os.path.join(OUT, ds + ".json")
        if os.path.exists(stale):
            os.unlink(stale)  # only the gzip is kept (publish: gunzip -k first)
        print(ds, len(rows), "rows", os.path.getsize(path) // 1024, "KB gzip")
    with gzip.open(os.path.join(OUT, "verification", "evidence.json.gz"), "wt", encoding="utf-8") as h:
        json.dump(evidence, h, ensure_ascii=False)
    json.dump(ck, open(os.path.join(OUT, "checks.json"), "w"), ensure_ascii=False, indent=1)
    json.dump({"tables": res.tables, "issues": [i.__dict__ for i in res.issues]}, open(os.path.join(OUT, "tables.json"), "w"),
              ensure_ascii=False, indent=1)
    print(json.dumps(summary["counts"]))
    print(f"{time.time() - t0:.1f}s")


if __name__ == "__main__":
    main()
