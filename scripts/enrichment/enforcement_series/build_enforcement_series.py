"""Build the Antitrust Division enforcement-series datasets (build files only; nothing is published from here).

Datasets (written to private/build/enforcement_series/<dataset>.json in the shape corpus_writer.publish receives):
  doj_atr_workload_series   one record per fiscal year FY1970-FY2025 + summary:series (chart-ready series, definitions, formulas, checks)
  doj_atr_sherman_fines     one record per Sherman Act criminal fine of $10 million or more on the Division's list + summary:fines
  doj_atr_appropriations    one record per fiscal year FY1903-FY2028 of the Division's appropriation figures + summary:appropriations

Sources: only files under private/acq/enforcement_series/ (U.S. Department of Justice, Antitrust Division, public-domain pages and reports).
Securities Class Action Clearinghouse (Stanford) and Cornerstone Research pages are NOT used: their terms forbid automated access/storage
and reuse (see REPORT.md).

Usage: python3 -I -B build_enforcement_series.py [--dry-run]
"""
import json
import re
import sys
import time
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE.parent))
import appropriations as ap  # noqa: E402
import corpus_writer as cw  # noqa: E402
import criminal_charts as cc  # noqa: E402
import extract_workload as ew  # noqa: E402
import harmonize as hz  # noqa: E402
import metrics as mx  # noqa: E402
import sherman_fines as sf  # noqa: E402

ROOT = HERE.parents[2]
ACQ = ROOT / "private" / "acq" / "enforcement_series"
OUT = ROOT / "private" / "build" / "enforcement_series"
LOOKUPS = OUT / "lookups"

WORKLOAD_DS, FINES_DS, APPROP_DS = "doj_atr_workload_series", "doj_atr_sherman_fines", "doj_atr_appropriations"
OPERATIONS_URL = "https://www.justice.gov/atr/division-operations"
CATALOG_LINK = {"label": "Antitrust Division in the enforcement data sources catalog", "url": "/records/enforcement_data_sources_catalog/src:us:justice-department-antitrust-division"}
TERMS = ("U.S. Department of Justice website content; https://www.justice.gov/legalpolicies states: \"Unless otherwise indicated, information on Department of Justice websites is in the public domain "
         "and may be copied and distributed without permission.\" Citation of the Department as the source is appreciated.")
NR = "Not recorded"
FIRST_FY, LAST_WORKLOAD_FY, LAST_FY = 1970, 2024, 2025
CHART_PAGES = {
    "cases": "doj/criminal_total_cases_filed.html",
    "charged": "doj/criminal_corporations_individuals_charged.html",
    "fines": "doj/criminal_total_fines.html",
    "prison": "doj/criminal_avg_prison_sentence_months.html",
    "jail": "doj/criminal_avg_jail_days.html",
}
CHART_TITLES = {"cases": "Total Criminal Cases Filed", "charged": "Corporations & Individuals Charged", "fines": "Total Criminal Fines & Penalties", "jail": "Average Number of Jail Days",
                "prison": "Average Prison Sentence in Months"}


# ----------------------------------------------------------------------------------------------- formatting
def fmt_int(v):
    if v is None:
        return NR
    if isinstance(v, float) and v != int(v):
        return f"{v:,.1f}"
    return f"{int(v):,}"


def fmt_usd000(v):
    if v is None:
        return NR
    return f"${fmt_int(v)} thousand"


def fmt_pct(v, digits=1):
    return NR if v is None else f"{v:.{digits}f}%"


def decade(fy):
    return f"{fy // 10 * 10}s"


def slug(text, limit=48):
    s = re.sub(r"[^a-z0-9]+", "-", text.lower()).strip("-")
    return s[:limit].strip("-") or "x"


def cellv(v):
    return NR if v is None else v


# ----------------------------------------------------------------------------------------------- loading
def load(acq=ACQ):
    manifest = ew.manifest_entries(str(acq))

    def entry(rel):
        return manifest["private/acq/enforcement_series/" + rel]

    editions = {k: ew.read_edition(k, str(acq)) for k in ew.EDITIONS}
    appr_html, appr_meta = ap.read_html((acq / "doj/appropriation_figures.html").read_bytes())
    appr_xls = ap.read_csv((acq / "derived/appropriation_figures.xls.sheet1.csv").read_text(encoding="utf-8"))
    fines_html = sf.read_html(str(acq / "doj/sherman_act_fines_10m.html"))
    fines_xlsx, fines_xlsx_notes = sf.read_xlsx(str(acq / "doj/sherman_act_fines_10m.xlsx"))
    fines_pdf = sf.read_pdf(str(acq / "doj/sherman_act_fines_10m.pdf"))
    fines_page = (acq / "doj/sherman_act_fines_10m.html").read_text(encoding="utf-8", errors="replace")
    charts = {}
    for key, rel in CHART_PAGES.items():
        markup = (acq / rel).read_bytes()
        charts[key] = {"updated": cc.updated(markup), "url": entry(rel)["url"], "path": "private/acq/enforcement_series/" + rel}
        if key == "prison":
            charts[key]["decades"] = cc.read_decade_averages(markup)
        else:
            charts[key]["header"], charts[key]["rows"] = cc.read_table(markup)
    ops_text = (acq / "doj/division-operations.html").read_text(encoding="utf-8", errors="replace")
    return {"manifest": manifest, "entry": entry, "editions": editions, "appr_html": appr_html, "appr_meta": appr_meta, "appr_xls": appr_xls, "fines_html": fines_html, "fines_xlsx": fines_xlsx,
            "fines_xlsx_notes": fines_xlsx_notes, "fines_pdf": fines_pdf, "fines_page": fines_page, "charts": charts, "ops_text": ops_text}


def input_of(entry):
    return {"url": entry.get("url") or entry.get("source_url"), "path": entry["path"], "sha256": entry["sha256"]}


# ----------------------------------------------------------------------------------------------- chart cells
def chart_cells(charts):
    """Cells for the criminal-charts data pages in the same shape as workload cells (edition 'criminal_charts')."""
    def cell(page, position, text, heading, label):
        return {"as_published": text, "value": cc.parse_number(text), "dash": False, "marks": [], "page": None, "url": charts[page]["url"], "row": position, "edition": hz.CHART, "heading": heading,
                "label": label, "table_id": f"criminal_charts:{page}", "heading_marks": [], "label_marks": [], "notes": [], "kind": "chart"}

    extra = {"crim_filed": {hz.CHART: {}}, "crim_corporations_charged": {hz.CHART: {}}, "crim_individuals_charged": {hz.CHART: {}}, "incarceration_days_avg_published": {hz.CHART: {}}}
    for r in charts["cases"]["rows"]:
        extra["crim_filed"][hz.CHART][r["fy"]] = cell("cases", r["position"], r["values"][0], CHART_TITLES["cases"], "Total Cases")
    for r in charts["charged"]["rows"]:
        extra["crim_corporations_charged"][hz.CHART][r["fy"]] = cell("charged", r["position"], r["values"][0], CHART_TITLES["charged"], "Corporations")
        extra["crim_individuals_charged"][hz.CHART][r["fy"]] = cell("charged", r["position"], r["values"][1], CHART_TITLES["charged"], "Individuals")
    for r in charts["jail"]["rows"]:
        extra["incarceration_days_avg_published"][hz.CHART][r["fy"]] = cell("jail", r["position"], r["values"][0], CHART_TITLES["jail"], "Average Number of Jail Days")
    return extra


def chart_fines(charts):
    return {r["fy"]: {"text": r["values"][0], "value": cc.parse_number(r["values"][0]), "position": r["position"]} for r in charts["fines"]["rows"]}


def millions_match(workload_000, chart_text):
    """Does the chart's printed $ millions equal the workload figure ($ thousands) rounded or truncated at the chart's printed precision?"""
    if workload_000 is None:
        return None
    chart = float(chart_text)
    digits = len(chart_text.split(".")[1]) if "." in chart_text else 0
    exact = workload_000 / 1000
    import math

    scale = 10 ** digits
    return chart in (round(exact, digits), math.floor(exact * scale) / scale)


# ----------------------------------------------------------------------------------------------- locators and footnotes
def locator(cell):
    if cell["kind"] == "pdf":
        return {"kind": "pdf", "page": cell.get("page"), "table": cell["heading"], "row": cell["label"]}
    if cell["kind"] == "html":
        return {"kind": "web page table", "table_index": cell.get("table"), "row_index": cell.get("row"), "table": cell["heading"], "row": cell["label"]}
    return {"kind": "criminal charts data page", "url": cell.get("url"), "row_position": cell.get("row"), "table": cell["heading"], "row": cell["label"]}


def footnote_texts(editions, cell):
    """Verbatim footnote/table-note text for every mark on a value, its row label and its table heading."""
    if cell["edition"] not in editions:
        return []
    ed = editions[cell["edition"]]
    out, seen = [], set()
    for mark in list(cell["marks"]) + list(cell["label_marks"]) + list(cell["heading_marks"]):
        mark = mark.strip("()")
        if (cell["edition"], mark) in seen:
            continue
        seen.add((cell["edition"], mark))
        if mark.isdigit() and mark in ed["footnotes"]:
            text, repaired = hz.clean_footnote(cell["edition"], mark, ed["footnotes"][mark]["text"])
            out.append({"edition": cell["edition"], "mark": mark, "page": ed["footnotes"][mark]["page"], "text": text, "repaired": repaired})
        elif mark == "*":
            notes = [n for n in cell["notes"] if n.startswith("*")]
            out.append({"edition": cell["edition"], "mark": "*", "page": cell.get("page"), "text": " ".join(notes) if notes else None, "repaired": False})
        else:
            out.append({"edition": cell["edition"], "mark": mark, "page": None, "text": None, "repaired": False})
    return out


def edition_label(editions, key):
    if key == hz.CHART:
        return "Criminal Enforcement Trends Charts data pages (through FY2025)"
    return "Antitrust Division Workload Statistics " + editions[key]["label"]


def metric_entry(editions, entry):
    cell = entry["cell"]
    out = {"value": cell["value"], "as_published": cell["as_published"], "dash": cell["dash"], "edition": cell["edition"], "locator": locator(cell), "marks": cell["marks"] + cell["label_marks"] + cell["heading_marks"]}
    notes = footnote_texts(editions, cell)
    if notes:
        out["footnotes"] = notes
    diffs = [{"edition": a["edition"], "as_published": a["as_published"], "value": a["value"], "locator": locator(a), "same": a["as_published"] == cell["as_published"]} for a in entry["alts"]]
    if diffs:
        out["also_printed_in"] = diffs
    return out


# ----------------------------------------------------------------------------------------------- checks
def cross_checks(ctx):
    """Consistency checks over the extracted data; each is {id, description, compared, agree, differ:[...]}."""
    checks = []
    editions, series, chart = ctx["editions"], ctx["series"], ctx["chart_fines"]
    # 1 two readings of every edition
    for k, ed in editions.items():
        c = ed["comparison"]
        if c is None:
            checks.append({"id": f"readings:{k}", "description": f"{ed['label']}: single reading (Poppler word boxes; pdfplumber places glyphs wrongly in this file, checked against a rendered page) - verified by the independent script instead", "compared": 0, "agree": 0, "differ": []})
            continue
        checks.append({"id": f"readings:{k}", "description": f"{ed['label']}: {ed['comparison_label']}, rows compared by label start and all ten printed year cells", "compared": c["rows_first"], "agree": c["rows_first"] - len(c["only_first"]),
                       "differ": [{"only_in_first_reading": r} for r in c["only_first"]] + [{"only_in_second_reading": r} for r in c["only_second"]]})
    # 2 printed arithmetic inside the tables
    for k, ed in editions.items():
        n, failed = hz.identity_checks(ed)
        checks.append({"id": f"identity:{k}", "description": f"{ed['label']}: Terminated (or Total Resolutions) equals the sum of the won/lost/dismissed/settlement rows beneath it, per fiscal year; a printed dash counts as 0 in this check only", "compared": n, "agree": n - len(failed), "differ": failed})
    # 3 total fines equals individual plus corporate
    bad, n = [], 0
    for fy in range(1990, LAST_WORKLOAD_FY + 1):
        t, i, c = hz.value(series, "fine_total_000", fy), hz.value(series, "fine_individual_000", fy), hz.value(series, "fine_corporate_000", fy)
        if None in (t, i, c):
            continue
        n += 1
        if abs(t - (i + c)) > 2:
            bad.append({"fy": fy, "total": t, "individual_plus_corporate": i + c})
    checks.append({"id": "fines_total_identity", "description": "FY1990-FY2024: total fines (and penalties) imposed equals individual plus corporate within 2 ($ thousands)", "compared": n, "agree": n - len(bad), "differ": bad})
    # 4 cross-table equalities inside an edition
    pairs = [("crim_filed", {"fy1990_1999": mx.R(r"^Criminal Cases Filed$", r"^Total Number$"), "fy2000_2009": mx.R(r"^Criminal Cases Filed$", r"^Total Cases Filed$"), "fy2010_2019": mx.R(r"^Criminal Cases Filed$", r"^Total Cases Filed$"),
                          "fy2015_2024": mx.R(r"^CRIMINAL INVESTIGATIONS$", r"^Total Cases Filed$")}),
             ("merger_complaints_filed", {"fy1990_1999": mx.R(r"^CIVIL INVESTIGATION RESULTS$", r"^Actions Filed in District Court$"), "fy2000_2009": mx.R(r"^Civil Investigation Results$", r"^Actions Filed in District Court$"),
                                          "fy2010_2019": mx.R(r"^Civil Investigation Results$", r"^Complaints Filed in District Court$")})]
    for key, rules in pairs:
        n, bad = 0, []
        for ek, rule in rules.items():
            ed = editions[ek]
            _, row = mx.select_row(ed["tables"], rule)
            base = ctx["resolved"][key][ek]
            for fy in ed["years"]:
                a, b = row["values"].get(fy), base.get(fy)
                if a is None or b is None or a["value"] is None or b["value"] is None:
                    continue
                n += 1
                if a["value"] != b["value"]:
                    bad.append({"edition": ek, "fy": fy, "other_table": a["as_published"], "metric_table": b["as_published"]})
        checks.append({"id": f"cross_table:{key}", "description": f"{key}: the figure printed in the investigation/results table equals the one in the district court cases table (the report footnotes say they are the same statistic)", "compared": n, "agree": n - len(bad), "differ": bad})
    # 5 overlap between editions
    n, bad = 0, []
    for key, per in series.items():
        for fy, e in per.items():
            for alt in e["alts"]:
                if alt["edition"] == hz.CHART:
                    continue
                n += 1
                if alt["as_published"] != e["cell"]["as_published"]:
                    bad.append({"metric": key, "fy": fy, "later_edition": e["cell"]["edition"], "later_printed": e["cell"]["as_published"], "earlier_edition": alt["edition"], "earlier_printed": alt["as_published"]})
    checks.append({"id": "edition_overlap", "description": "FY2015-FY2019 are printed in both the FY2010-2019 and FY2015-2024 editions: every harmonised metric printed in both is compared; the later edition is used and the earlier value is kept beside it", "compared": n, "agree": n - len(bad), "differ": bad})
    # 6 criminal charts pages vs workload
    n, bad = 0, []
    for key in ("crim_filed", "crim_corporations_charged", "crim_individuals_charged", "incarceration_days_avg_published"):
        for fy, e in series[key].items():
            for alt in e["alts"]:
                if alt["edition"] == hz.CHART:
                    n += 1
                    if alt["as_published"] != e["cell"]["as_published"].replace("$", ""):
                        bad.append({"metric": key, "fy": fy, "workload_printed": e["cell"]["as_published"], "chart_printed": alt["as_published"]})
    for fy, c in sorted(chart.items()):
        total = hz.value(series, "fine_total_000", fy)
        ok = millions_match(total, c["text"])
        if ok is None:
            continue
        n += 1
        if not ok:
            bad.append({"metric": "fine_total_000", "fy": fy, "workload_printed_000": total, "chart_printed_millions": c["text"]})
    checks.append({"id": "criminal_charts_vs_workload", "description": "FY2016-FY2024: the criminal-charts data pages equal the FY2015-2024 workload report (fines compared at the chart's printed precision, rounded or truncated)", "compared": n, "agree": n - len(bad), "differ": bad})
    # 7 civil complaints identity used to extend civil_filed
    n, bad = 0, []
    for fy in range(2015, 2020):
        a, b, c = hz.value(series, "civil_filed", fy), hz.value(series, "merger_complaints_filed", fy), hz.value(series, "conduct_complaints_filed", fy)
        if None in (a, b, c):
            continue
        n += 1
        if a != b + c:
            bad.append({"fy": fy, "civil_filed": a, "merger_plus_conduct": b + c})
    # civil_filed is picked from the FY2010-2019 edition for these years; the identity justifies the FY2020+ computed figure
    checks.append({"id": "civil_filed_identity", "description": "FY2015-FY2019: Total Civil Cases Filed (FY2010-2019 edition) equals merger complaints + conduct complaints (FY2015-2024 edition); the sum is used for FY2020-FY2024 only because it holds in these five years", "compared": n, "agree": n - len(bad), "differ": bad})
    return checks


# ----------------------------------------------------------------------------------------------- build: workload
def build_workload(ctx):
    editions, series, derived = ctx["editions"], ctx["series"], ctx["derived"]
    years = list(range(FIRST_FY, LAST_FY + 1))
    appr = ctx["appr_html"]
    chart_f = ctx["chart_fines"]
    fines_by_fy = ctx["fines_by_fy"]
    rows = []

    def derived_entry(key, fy):
        e = derived[key].get(fy)
        return e

    def yoy_for(key, fy):
        pct, cross = hz.yoy(series, derived, key, fy)
        return pct, cross

    summary_series = {}
    for key in [m["key"] for m in mx.METRICS]:
        summary_series[key] = [hz.value(series, key, fy) for fy in years]
    for key in derived:
        summary_series[key] = [None if derived[key].get(fy) is None else derived[key][fy]["value"] for fy in years]
    yoy_series = {k: [] for k in hz.YOY_KEYS}
    for fy in years:
        for k in hz.YOY_KEYS:
            yoy_series[k].append(yoy_for(k, fy)[0])

    for fy in years:
        v = lambda k: hz.value(series, k, fy)  # noqa: E731
        has_workload = fy <= LAST_WORKLOAD_FY
        edition_keys = [ek for ek in ew.EDITIONS if fy in editions[ek]["years"]] if has_workload else []
        primary_ed = edition_keys[-1] if edition_keys else None
        metrics_out = {}
        for m in mx.METRICS:
            if fy in series[m["key"]]:
                metrics_out[m["key"]] = metric_entry(editions, series[m["key"]][fy])
        derived_out = {}
        for key, per in derived.items():
            if fy in per:
                derived_out[key] = {**per[fy], "formula": hz.FORMULAS.get(key)}
        yoy_out = {}
        for k in hz.YOY_KEYS:
            pct, cross = yoy_for(k, fy)
            if pct is not None:
                yoy_out[k] = {"pct": pct, "cross_edition": cross}
        trail = {k: hz.trailing_mean(series, derived, k, fy) for k in hz.TRAIL_KEYS}
        trail = {k: x for k, x in trail.items() if x is not None}
        a = appr.get(fy)
        approp = None
        if a is not None:
            approp = {"general_fund_000": a["gf"]["value"], "filing_fee_revenue_000": a["fee"]["value"], "total_000": a["total"]["value"], "printed": {"general_fund": a["gf"]["as_published"], "filing_fee_revenue": a["fee"]["as_published"], "total": a["total"]["as_published"]},
                      "note": a["note"] or None, "conflict": ctx["appr_conflicts"].get(fy)}
        chart_out = None
        if fy in chart_f:
            c = chart_f[fy]
            chart_out = {"fines_millions_printed": c["text"], "fines_millions": c["value"], "agrees_with_workload": millions_match(v("fine_total_000"), c["text"]), "source": ctx["charts"]["fines"]["url"]}
        listed = fines_by_fy.get(fy, [])
        tables_out = []
        footnotes_out = {}
        for ek in edition_keys:
            ed = editions[ek]
            for t in ed["tables"]:
                trows = []
                for r in t["rows"]:
                    c = r["values"].get(fy)
                    if c is None:
                        continue
                    trows.append({"label": r["label"], "group": r["group"], "sub": r["sub"], "as_published": c["as_published"], "marks": c["marks"] + r["marks"]})
                    for mark in c["marks"] + r["marks"]:
                        if mark.isdigit() and mark in ed["footnotes"]:
                            text, repaired = hz.clean_footnote(ek, mark, ed["footnotes"][mark]["text"])
                            footnotes_out[f"{ek}:{mark}"] = {"edition": ek, "mark": mark, "page": ed["footnotes"][mark]["page"], "text": text, "repaired": repaired}
                if trows:
                    tables_out.append({"edition": ek, "heading": t["heading"], "section": t["section"], "locator": ({"kind": "pdf", "page": t["page"]} if t["kind"] == "pdf" else {"kind": "web page table", "table_index": t["table"]}),
                                       "notes": t["notes"], "rows": trows})
        for key, e in metrics_out.items():
            for f in e.get("footnotes", []):
                if f["text"]:
                    footnotes_out[f"{f['edition']}:{f['mark']}"] = {"edition": f["edition"], "mark": f["mark"], "page": f["page"], "text": f["text"], "repaired": f["repaired"]}
        src_edition = primary_ed
        if src_edition:
            source_url = editions[src_edition]["sources"][editions[src_edition]["primary"]]["url"]
        else:
            source_url = ctx["charts"]["cases"]["url"]
        src_urls = []
        for ek in edition_keys:
            u = editions[ek]["sources"][editions[ek]["primary"]]["url"]
            if u not in src_urls:
                src_urls.append(u)
        if fy in chart_f or fy == LAST_FY:
            src_urls.append(ctx["charts"]["cases"]["url"])
        start, end = ("%d-07-01" % (fy - 1), "%d-06-30" % fy) if fy <= 1976 else ("%d-10-01" % (fy - 1), "%d-09-30" % fy)
        crim, fines_best, hsr = v("crim_filed"), derived["fine_total_000_best"].get(fy), v("hsr_received")
        civil_best = derived["civil_filed_best"].get(fy)
        cells = {"fy": f"FY{fy}", "crim_filed": cellv(crim), "fines_000": cellv(v("fine_total_000")), "hsr_received": cellv(hsr), "merger_investigations": cellv(v("merger_investigations")),
                 "civil_filed": cellv(civil_best["value"] if civil_best else None), "appropriation_000": cellv(approp["total_000"] if approp else None)}
        if has_workload:
            subtitle = f"{fmt_int(crim)} criminal cases filed · fines and penalties imposed {fmt_usd000(v('fine_total_000')) if v('fine_total_000') is not None else NR} · {fmt_int(hsr)} HSR filings"
        else:
            subtitle = f"{fmt_int(crim)} criminal cases filed · workload report not published for FY{fy}; criminal-charts data pages only"
        facts = [["Source", ("; ".join(edition_label(editions, ek) for ek in edition_keys) if edition_keys else edition_label(editions, hz.CHART))],
                 ["Publisher", "U.S. Department of Justice, Antitrust Division (division operations page: " + OPERATIONS_URL + ")"], ["Terms", TERMS],
                 ["Fiscal year", f"FY{fy}: {start} to {end}" + (" (July-June year through FY1976; the workload reports do not state their year basis, the appropriation page states this one)" if fy <= 1976 else "")],
                 ["Units", "Counts of matters, cases, investigations and filings as printed; dollar rows are thousands of nominal dollars as printed; nothing is inflation-adjusted"]]
        if not has_workload:
            facts.append(["Coverage", "The Division's last workload report is FY2024 (division operations page: \"Final workload statistics were published in 2024\"). FY2025 figures come only from the Criminal Enforcement Trends Charts data pages (updated December 2025); every other workload measure is Not recorded."])
        for m in mx.METRICS:
            e = metrics_out.get(m["key"])
            if e is None:
                continue
            txt = e["as_published"] if not e["dash"] else "- (printed dash: no figure recorded)"
            extra = []
            if m["key"] in yoy_out:
                extra.append(f"YoY {yoy_out[m['key']]['pct']:+.1f}%" + (" (editions differ)" if yoy_out[m["key"]]["cross_edition"] else ""))
            loc = e["locator"]
            if e["edition"] in ew.EDITIONS:
                where = f"p.{loc['page']}" if loc.get("page") else f"web table {loc['table_index']}"
                extra.append(f"{ew.EDITIONS[e['edition']]['label']} {where}")
            else:
                extra.append("criminal charts data page")
            if e.get("also_printed_in") and any(not d["same"] for d in e["also_printed_in"]):
                extra.append("printed differently in " + ", ".join(f"{ew.EDITIONS[d['edition']]['label'] if d['edition'] in ew.EDITIONS else d['edition']}: {d['as_published']}" for d in e["also_printed_in"] if not d["same"]))
            facts.append([m["label"] + (f" ({m['unit']})" if m["unit"] not in ("cases",) else ""), txt + " · " + " · ".join(extra)])
        for key, label in (("crim_win_rate_pct", "Criminal win rate (computed)"), ("fine_total_000_computed", "Individual + corporate fines ($ thousands, computed; no total row printed)"), ("fine_corporate_avg_000", "Average corporate fine ($ thousands, computed)"),
                           ("second_request_rate_pct", "Second requests per 100 HSR filings (computed)"), ("incarceration_days_avg", "Average days of incarceration"), ("incarceration_share_pct", "Share of individuals sentenced who received incarceration (computed)"),
                           ("civil_filed_best", "Civil cases filed (published, or computed from merger + conduct complaints from FY2020)"), ("fines_to_appropriation_ratio", "Fines & penalties imposed per $1 of Division appropriation (computed)")):
            if key in derived_out:
                val = derived_out[key]["value"]
                shown = fmt_pct(val) if key.endswith("pct") else (f"{val:.3f}" if "ratio" in key else fmt_int(val))
                facts.append([label, shown + f" · {derived_out[key].get('basis', 'computed')} · formula: {hz.FORMULAS.get(key)}"])
        if approp:
            facts.append(["Total funding appropriated ($ thousands)", f"{approp['printed']['total']} (appropriation page; general fund {approp['printed']['general_fund']}, filing fees {approp['printed']['filing_fee_revenue']})" + (" · the Division's XLS prints a different general fund/fee split for this year" if approp["conflict"] else "")])
        if chart_out:
            facts.append(["Total criminal fines & penalties ($ millions, criminal charts data page)", chart_out["fines_millions_printed"] + (" · differs from the workload report" if chart_out["agrees_with_workload"] is False else "")])
        if listed:
            facts.append(["Listed Sherman Act fines of $10 million or more", f"{len(listed)} on the Division's list totalling ${sum(x['fine_millions'] for x in listed):,.1f} million"])
        links = [dict(CATALOG_LINK)]
        if fy in appr:
            links.append({"label": f"Appropriation figures, FY{fy}", "url": f"/records/{APPROP_DS}/fy{fy}"})
        for x in listed:
            links.append({"label": f"{x['defendant']} (${x['fine_millions']:g} million)", "url": f"/records/{FINES_DS}/{x['id']}"})
        for u in src_urls:
            links.append({"label": "Official source: " + u, "url": u})
        links.append({"label": "Antitrust Division operations page", "url": OPERATIONS_URL})
        coverage = "workload" if has_workload else "criminal_charts_only"
        text = f"Antitrust Division workload statistics FY{fy} criminal cases filed civil cases HSR premerger notifications merger investigations criminal fines penalties grand jury {decade(fy)}"
        row = cw.record(
            WORKLOAD_DS, f"fy{fy}", f"Antitrust Division workload statistics, FY{fy}", source_url=source_url, subtitle=subtitle, cells=cells, facts=facts, text=text,
            filters={"kind": ["year"], "decade": [decade(fy)], "coverage": [coverage], "year": [str(fy)]},
            badges=["National", f"FY{fy}", "Criminal charts only" if not has_workload else editions[primary_ed]["label"]], links=links, state="",
            extra={"kind": "year", "year": fy, "series": {"fy": fy, "fy_start": start, "fy_end": end, "coverage": coverage, "editions": edition_keys, "metrics": metrics_out, "derived": derived_out, "yoy_pct": yoy_out, "trailing5_mean": trail,
                                                           "appropriation": approp, "criminal_chart": chart_out, "listed_fines": [{"id": x["id"], "defendant": x["defendant"], "fine_millions": x["fine_millions"]} for x in listed]}},
        )
        # the full as-published tables and footnote texts are bulky: kept in detail so listing queries on item stay small
        row["detail"]["tables"] = tables_out
        row["detail"]["footnotes"] = list(footnotes_out.values())
        rows.append(row)
    # ---------------------------------------------------------------- summary record
    catalog = []
    for m in mx.METRICS:
        cov = {}
        for ek in mx.ORDER:
            rule = m["rules"].get(ek)
            if rule is None:
                continue
            cells = ctx["resolved"][m["key"]][ek]
            first = next(iter(cells.values()), None)
            cov[ek] = {"heading": first["heading"] if first else None, "label": first["label"] if first else None, "fiscal_years": [min(cells), max(cells)] if cells else None, "numeric_years": sum(1 for c in cells.values() if c["value"] is not None),
                       "dash_years": sorted(fy for fy, c in cells.items() if c["dash"])}
        have = sorted(fy for fy in years if fy in series[m["key"]] and series[m["key"]][fy]["cell"]["value"] is not None)
        catalog.append({"key": m["key"], "label": m["label"], "unit": m["unit"], "group": m["group"], "definition": m["definition"], "editions": cov, "first_numeric_fy": have[0] if have else None, "last_numeric_fy": have[-1] if have else None,
                        "numeric_years": len(have)})
    ranks = {}
    for key, label in (("fine_total_000_best", "Total criminal fines and penalties imposed ($ thousands)"), ("crim_filed", "Criminal cases filed"), ("hsr_received", "HSR premerger notifications received")):
        vals = [(fy, hz.metric_value(series, derived, key, fy)) for fy in years]
        vals = [(fy, x) for fy, x in vals if x is not None]
        ranks[key] = {"label": label, "top": [{"fy": fy, "value": x} for fy, x in sorted(vals, key=lambda t: (-t[1], t[0]))[:10]]}
    summary = {
        "years": years, "latest_workload_fy": LAST_WORKLOAD_FY, "series": summary_series, "yoy_pct": yoy_series, "catalog": catalog, "formulas": hz.FORMULAS, "rankings": ranks,
        "editions": [{"key": ek, "label": editions[ek]["label"], "years": [editions[ek]["years"][0], editions[ek]["years"][-1]], "url": editions[ek]["sources"][editions[ek]["primary"]]["url"], "sha256": editions[ek]["sources"][editions[ek]["primary"]]["sha256"],
                      "second_reading_url": editions[ek]["sources"]["pdf"]["url"] if editions[ek]["primary"] == "html" else None, "reading": editions[ek]["comparison_label"] or "single reading", "retrieved_at": editions[ek]["sources"][editions[ek]["primary"]]["retrieved_at"]} for ek in mx.ORDER],
        "checks": [{k: v for k, v in c.items() if k != "differ"} | {"differ_count": len(c["differ"]), "differ": c["differ"][:40]} for c in ctx["checks"]],
        "decade_average_prison_months": ctx["charts"]["prison"]["decades"], "decade_average_prison_months_source": ctx["charts"]["prison"]["url"],
        "criminal_chart_fines_millions": {str(fy): c["text"] for fy, c in sorted(chart_f.items())},
        "fiscal_year_note": "Fiscal years through FY1976 ran July 1-June 30 and from FY1977 October 1-September 30 (stated on the Division's appropriation page; the workload reports do not state their year basis).",
        "dash_note": "A printed dash is stored as null with dash=true and shown as printed; it is never read as zero or imputed. Only the printed-arithmetic checks treat a dash as 0.",
        "definition_note": "Definitions changed between editions and within them (see each value's footnotes and the checks). Harmonised series are for charts; every value keeps its edition, locator and printed text. A later edition supersedes an earlier one for a shared fiscal year and the earlier value stays beside it.",
        "terms": TERMS, "source": OPERATIONS_URL,
        "latest_report_note": "Division operations page: \"Final workload statistics were published in 2024.\" FY2025 has criminal data only.",
        "excluded": ctx["excluded"],
    }
    rows.append(cw.record(
        WORKLOAD_DS, "summary:series", "Antitrust Division workload statistics - chart-ready series, definitions and checks", source_url=OPERATIONS_URL, subtitle=f"FY{FIRST_FY}-FY{LAST_FY} · {len(mx.METRICS)} harmonised metrics",
        cells={"fy": f"FY{FIRST_FY}-FY{LAST_FY}", "crim_filed": NR, "fines_000": NR, "hsr_received": NR, "merger_investigations": NR, "civil_filed": NR, "appropriation_000": NR},
        facts=[["Fiscal years", f"FY{FIRST_FY}-FY{LAST_FY}"], ["Editions", "; ".join(e["label"] for e in summary["editions"])], ["Checks", f"{sum(c['agree'] for c in ctx['checks']):,} of {sum(c['compared'] for c in ctx['checks']):,} comparisons agree; {sum(len(c['differ']) for c in ctx['checks']):,} differences listed in summary.checks"], ["Terms", TERMS]],
        links=[dict(CATALOG_LINK), {"label": "Antitrust Division operations page", "url": OPERATIONS_URL}], text="antitrust division workload series summary", filters={"_listing": ["no"], "kind": ["summary"]}, extra={"kind": "summary", "summary": summary},
    ))
    return rows, summary


# ----------------------------------------------------------------------------------------------- build: fines
def assign_fine_ids(html_rows):
    seen, out = {}, []
    for r in html_rows:
        base = f"fine:{r['fy']}:{slug(r['defendant'])}"
        n = seen.get(base, 0) + 1
        seen[base] = n
        out.append(base if n == 1 else f"{base}-{n}")
    return out


def name_key(name):
    """Documented normalisation for exact name matching: lower case, punctuation removed, whitespace collapsed. Legal suffixes (Inc, Ltd, LLC...) are kept."""
    return re.sub(r"\s+", " ", re.sub(r"[^a-z0-9 ]+", "", name.lower().replace("&", " and "))).strip()


def exact_company_matches(fines, profiles):
    """Defendant id -> CIK only on a unique exact match (by name_key) of the whole defendant name to a company_sec_profiles title; (matches, ambiguous ids)."""
    index = {}
    for p in profiles:
        index.setdefault(name_key(p["name"]), []).append(p["cik"])
    out, ambiguous = {}, []
    for r in fines:
        hits = index.get(name_key(r["defendant"]), [])
        out[r["id"]] = hits[0] if len(hits) == 1 else None
        if len(hits) > 1:
            ambiguous.append(r["id"])
    return out, ambiguous


def company_near_misses(fines, profiles, matched):
    """Reported, never linked: same first word and second words sharing a 6-letter prefix (for example 'Teva Pharmaceuticals USA' / 'TEVA PHARMACEUTICAL INDUSTRIES')."""
    out = []
    for r in fines:
        if matched.get(r["id"]):
            continue
        a = name_key(r["defendant"]).split()
        for p in profiles:
            b = name_key(p["name"]).split()
            if len(a) > 1 and len(b) > 1 and a[0] == b[0] and a[1][:6] == b[1][:6] and len(a[1]) >= 6:
                out.append({"defendant": r["defendant"], "profile_title": p["name"], "cik": p["cik"], "reason": "first two words overlap but the whole name differs; not linked (no fuzzy merge)"})
    return out


def build_fines(ctx):
    html_rows, xlsx_rows = ctx["fines_html"], ctx["fines_xlsx"]
    ids = ctx["fine_ids"]
    series = ctx["series"]
    derived = ctx["derived"]
    rows = []
    ranked = sorted(range(len(html_rows)), key=lambda i: (-html_rows[i]["fine_millions"], i))
    rank = {}
    for pos, i in enumerate(ranked):
        rank[i] = pos + 1 if pos == 0 or html_rows[ranked[pos - 1]]["fine_millions"] != html_rows[i]["fine_millions"] else rank[ranked[pos - 1]]
    fy_totals = {}
    for r, rid in zip(html_rows, ids):
        fy_totals.setdefault(r["fy"], []).append(r)
    page_url = ctx["fines_url"]
    for i, (r, rid) in enumerate(zip(html_rows, ids)):
        x = xlsx_rows[i]
        if x["fy"] != r["fy"] or abs(x["fine_millions"] - r["fine_millions"]) >= 1 or x["position"] != r["position"]:
            raise ValueError(f"web page and workbook rows {r['position']} do not describe the same fine: {r['defendant']!r} vs {x['defendant']!r}")
        total_000 = derived["fine_total_000_best"].get(r["fy"])
        share = None
        if total_000 and r["fy"] <= LAST_WORKLOAD_FY:
            share = round(r["fine_millions"] * 1000 / total_000["value"] * 100, 1)
        fy_sum = sum(q["fine_millions"] for q in fy_totals[r["fy"]])
        diffs = [f for f in ("defendant", "product", "fine_millions", "scope", "country") if sf.squash(str(r[f])).lower() != sf.squash(str(x[f])).lower()]
        links = [dict(CATALOG_LINK)]
        if FIRST_FY <= r["fy"] <= LAST_FY:
            links.append({"label": f"Antitrust Division workload statistics, FY{r['fy']}", "url": f"/records/{WORKLOAD_DS}/fy{r['fy']}"})
        cik = ctx["company_ciks"].get(rid)
        if cik:
            links.append({"label": "SEC company profile", "url": f"/companies/{cik}"})
        links.append({"label": "Official list (web page)", "url": page_url})
        facts = [["Source", "Antitrust Division, \"Sherman Act Violations Resulting in Criminal Fines & Penalties of $10 Million or More\" (web page; workbook and PDF renderings compared)"], ["Terms", TERMS],
                 ["List currency", "Web page updated January 25, 2024; list \"as of 9/13/23\" per the workbook footer (\"159 (fines & penalties) as of 9/13/23\"). Fines after that date are not on the list."],
                 ["Defendant", r["defendant"]], ["Fiscal year (as printed)", f"FY{r['fy']}"], ["Product", r["product"]], ["Fine ($ millions, as printed)", r["fine_text"] + (f" · workbook value {x['fine_millions']:g}" if "fine_millions" in diffs else "")],
                 ["Geographic scope", r["scope"]], ["Country (as printed)", r["country"]], ["Rank by fine on this list", f"{rank[i]} of {len(html_rows)}"],
                 ["Fines listed for this fiscal year", f"{len(fy_totals[r['fy']])} on the list, ${fy_sum:,.1f} million in total"],
                 ["Share of the fiscal year's total criminal fines & penalties imposed", (fmt_pct(share) + f" ({r['fine_millions']:g} million / ${total_000['value'] / 1000:,.1f} million, {total_000.get('basis', '')} total; workload report FY{r['fy']})") if share is not None else NR],
                 ["Differences between the page and the workbook", ", ".join(diffs) if diffs else "none"]]
        rows.append(cw.record(
            FINES_DS, rid, f"{r['defendant']} - Sherman Act criminal fine, FY{r['fy']}", source_url=page_url, subtitle=f"${r['fine_millions']:g} million · {r['product']} · {r['scope']} ({r['country']})",
            cells={"defendant": r["defendant"], "fy": r["fy"], "product": r["product"], "fine_millions": r["fine_millions"], "scope": r["scope"], "country": r["country"], "share_of_fy_total_pct": cellv(share), "rank": rank[i]},
            facts=facts, text=f"{r['defendant']} {r['product']} {r['country']} Sherman Act criminal fine antitrust division FY{r['fy']}",
            filters={"kind": ["fine"], "fy": [str(r["fy"])], "scope": [r["scope"]], "decade": [decade(r["fy"])]}, badges=["Sherman Act", f"FY{r['fy']}", r["scope"]], links=links, state="",
            extra={"kind": "fine", "fine": {"defendant": r["defendant"], "fy": r["fy"], "product": r["product"], "fine_millions": r["fine_millions"], "fine_printed": r["fine_text"], "fine_millions_workbook": x["fine_millions"], "scope": r["scope"], "country": r["country"],
                                              "rank": rank[i], "position_on_page": r["position"], "share_of_fy_total_pct": share, "fy_total_000": total_000["value"] if total_000 else None, "differences_vs_workbook": diffs,
                                              "company_cik": cik, "readings": {"web_page_row": r["position"], "workbook_row": x["position"]}}},
        ))
    by_fy = {fy: {"n": len(v), "sum_millions": round(sum(q["fine_millions"] for q in v), 3)} for fy, v in sorted(fy_totals.items())}
    by_country, by_product = {}, {}
    for r in html_rows:
        c = by_country.setdefault(sf.squash(r["country"]), {"n": 0, "sum_millions": 0.0})
        c["n"] += 1
        c["sum_millions"] = round(c["sum_millions"] + r["fine_millions"], 3)
        p = by_product.setdefault(sf.squash(r["product"]), {"n": 0, "sum_millions": 0.0})
        p["n"] += 1
        p["sum_millions"] = round(p["sum_millions"] + r["fine_millions"], 3)
    summary = {
        "rows": len(html_rows), "fy_min": min(r["fy"] for r in html_rows), "fy_max": max(r["fy"] for r in html_rows), "sum_millions": round(sum(r["fine_millions"] for r in html_rows), 3), "by_fy": {str(k): v for k, v in by_fy.items()},
        "by_country_as_printed": dict(sorted(by_country.items(), key=lambda kv: (-kv[1]["sum_millions"], kv[0]))), "by_product_as_printed": dict(sorted(by_product.items(), key=lambda kv: (-kv[1]["sum_millions"], kv[0]))),
        "note_grouping": "Countries and products are grouped by their exact printed text (case/whitespace only); variant spellings (for example 'U.S.' and 'U.S', or 'Generic Drugs' and 'Generics') stay separate and nothing is merged.",
        "comparison": ctx["fines_comparison"], "workbook_notes": ctx["fines_xlsx_notes"], "page_updated": "January 25, 2024", "list_as_of": "9/13/23 (workbook footer)",
        "vs_workload": ctx["fines_vs_workload"], "company_matches": {"method": "whole defendant name equals a company_sec_profiles title after lower-casing, removing punctuation and collapsing whitespace (legal suffixes kept); linked only when exactly one profile matches; lookup saved in private/build/enforcement_series/lookups/company_sec_profiles.json (137 profiles, read-only SELECT, 2026-10-18)",
                                                    "linked": [{"id": r["id"], "defendant": r["defendant"], "cik": ctx["company_ciks"][r["id"]]} for r in html_rows if ctx["company_ciks"].get(r["id"])],
                                                    "defendants": len(html_rows), "unmatched": sum(1 for r in html_rows if not ctx["company_ciks"].get(r["id"])), "ambiguous": ctx["ambiguous_company"], "near_misses_not_linked": ctx["company_near_misses"]},
        "terms": TERMS, "source": page_url,
    }
    rows.append(cw.record(
        FINES_DS, "summary:fines", "Sherman Act criminal fines of $10 million or more - totals by fiscal year, country and product", source_url=page_url, subtitle=f"{len(html_rows)} fines · FY{summary['fy_min']}-FY{summary['fy_max']} · ${summary['sum_millions']:,.0f} million",
        cells={"defendant": "All defendants", "fy": f"FY{summary['fy_min']}-FY{summary['fy_max']}", "product": "", "fine_millions": summary["sum_millions"], "scope": "", "country": "", "share_of_fy_total_pct": NR, "rank": ""},
        facts=[["Rows", str(len(html_rows))], ["List currency", "page updated January 25, 2024; list as of 9/13/23"], ["Terms", TERMS]], links=[dict(CATALOG_LINK), {"label": "Official list (web page)", "url": page_url}], text="sherman act fines summary",
        filters={"_listing": ["no"], "kind": ["summary"]}, extra={"kind": "summary", "summary": summary}))
    return rows, summary


# ----------------------------------------------------------------------------------------------- build: appropriations
def build_appropriations(ctx):
    appr = ctx["appr_html"]
    conflicts = ctx["appr_conflicts"]
    url = ctx["appr_url"]
    meta = ctx["appr_meta"]
    years = sorted(appr)
    rows = []
    totals = {fy: appr[fy]["total"]["value"] for fy in years}
    for fy in years:
        a = appr[fy]
        prev = totals.get(fy - 1)
        yoy = None if prev in (None, 0) or totals[fy] is None else round((totals[fy] - prev) / prev * 100, 1)
        estimate = a["note"].strip().lower() == "estimate"
        conflict = conflicts.get(fy)
        gf = NR if conflict else (a["gf"]["as_published"] if a["gf"]["dash"] else cellv(a["gf"]["value"]))
        fee = NR if conflict else (a["fee"]["as_published"] if a["fee"]["dash"] else cellv(a["fee"]["value"]))
        facts = [["Source", "Antitrust Division, \"Appropriation Figures for the Antitrust Division, Fiscal Years 1903-2028\" (web page; XLS compared)"], ["Terms", TERMS], ["Page updated", meta["updated"] or NR],
                 ["Fiscal year basis", meta["basis"] or NR], ["Units", "Thousands of nominal dollars as printed; not inflation-adjusted"], ["Total funding appropriated ($ thousands)", a["total"]["as_published"]],
                 ["General fund amount included in appropriations bill ($ thousands)", a["gf"]["as_published"] if not conflict else f"{NR}: the web page prints {a['gf']['as_published']} and the XLS prints {conflict['xls_gf']}"],
                 ["Filing fee revenue amount included in appropriations bill ($ thousands)", a["fee"]["as_published"] if not conflict else f"{NR}: the web page prints {a['fee']['as_published']} and the XLS prints {conflict['xls_fee']}"],
                 ["Change from prior fiscal year", fmt_pct(yoy) if yoy is not None else NR], ["Status", "Estimate (as printed in Notes)" if estimate else "As printed"], ["Notes (as printed)", a["note"] or "none"]]
        links = [dict(CATALOG_LINK)]
        if FIRST_FY <= fy <= LAST_FY:
            links.append({"label": f"Antitrust Division workload statistics, FY{fy}", "url": f"/records/{WORKLOAD_DS}/fy{fy}"})
        links.append({"label": "Official appropriation figures (web page)", "url": url})
        rows.append(cw.record(
            APPROP_DS, f"fy{fy}", f"Antitrust Division appropriation, FY{fy}", source_url=url, subtitle=f"${fmt_int(totals[fy])} thousand total funding appropriated" + (" · estimate" if estimate else ""),
            cells={"fy": f"FY{fy}", "general_fund_000": gf, "filing_fee_000": fee, "total_000": cellv(totals[fy]), "yoy_pct": cellv(yoy), "status": "Estimate" if estimate else "As printed"},
            facts=facts, text=f"Antitrust Division appropriation FY{fy} funding filing fee revenue general fund", filters={"kind": ["year"], "decade": [decade(fy)], "status": ["estimate" if estimate else "published"], "year": [str(fy)]},
            badges=["National", f"FY{fy}"] + (["Estimate"] if estimate else []), links=links, state="",
            extra={"kind": "year", "year": fy, "appropriation": {"fy": fy, "general_fund_000": a["gf"]["value"], "general_fund_printed": a["gf"]["as_published"], "filing_fee_000": a["fee"]["value"], "filing_fee_printed": a["fee"]["as_published"], "total_000": totals[fy],
                                                               "total_printed": a["total"]["as_published"], "yoy_pct": yoy, "note": a["note"] or None, "note_spanned_from_previous_row": a.get("note_spanned", False), "estimate": estimate, "conflict_with_xls": conflict}}))
    summary = {"years": years, "total_000": [totals[fy] for fy in years], "yoy_pct": [None if totals.get(fy - 1) in (None, 0) else round((totals[fy] - totals[fy - 1]) / totals[fy - 1] * 100, 1) for fy in years], "page_updated": meta["updated"], "fiscal_year_basis": meta["basis"],
               "comparison_with_xls": ctx["appr_comparison"], "formula": "yoy_pct = (total in FY - total in FY-1) / total in FY-1 x 100, rounded to 0.1; None when FY-1 is absent or zero",
               "estimates": [fy for fy in years if appr[fy]["note"].strip().lower() == "estimate"], "terms": TERMS, "source": url}
    rows.append(cw.record(
        APPROP_DS, "summary:appropriations", "Antitrust Division appropriation figures - series", source_url=url, subtitle=f"FY{years[0]}-FY{years[-1]}", cells={"fy": f"FY{years[0]}-FY{years[-1]}", "general_fund_000": NR, "filing_fee_000": NR, "total_000": NR, "yoy_pct": NR, "status": ""},
        facts=[["Fiscal years", f"FY{years[0]}-FY{years[-1]}"], ["Page updated", meta["updated"] or NR], ["Terms", TERMS]], links=[dict(CATALOG_LINK), {"label": "Official appropriation figures (web page)", "url": url}], text="appropriation series summary",
        filters={"_listing": ["no"], "kind": ["summary"]}, extra={"kind": "summary", "summary": summary}))
    return rows, summary


# ----------------------------------------------------------------------------------------------- orchestration
def prepare(data):
    editions = data["editions"]
    years = list(range(FIRST_FY, LAST_FY + 1))
    extra = chart_cells(data["charts"])
    series = hz.build_series(editions, years, extra)
    resolved = hz.resolve(editions)
    appr_html, appr_xls = data["appr_html"], data["appr_xls"]
    appr_cmp = ap.compare(appr_html, appr_xls)
    appr_conflicts = {}
    for c in appr_cmp["conflicts"]:
        if c["field"] in ("gf", "fee"):
            d = appr_conflicts.setdefault(c["fy"], {})
            d["xls_" + c["field"]] = c["xls"]
            d["html_" + c["field"]] = c["html"]
    appr_total = {fy: a["total"]["value"] for fy, a in appr_html.items()}
    chart_vals = {"incarceration_days_avg": {}}
    derived = hz.derive(series, years, appr_total, chart_vals)
    chart_f = chart_fines(data["charts"])
    ids = assign_fine_ids(data["fines_html"])
    fines = [{**r, "id": rid} for r, rid in zip(data["fines_html"], ids)]
    fines_by_fy = {}
    for r in fines:
        fines_by_fy.setdefault(r["fy"], []).append(r)
    profiles = json.loads((LOOKUPS / "company_sec_profiles.json").read_text())["rows"]
    ciks, ambiguous = exact_company_matches(fines, profiles)
    near = company_near_misses(fines, profiles, ciks)
    fcmp = sf.compare(data["fines_html"], data["fines_xlsx"], data["fines_pdf"])
    vs_workload = []
    for fy, lst in sorted(fines_by_fy.items()):
        tot = derived["fine_total_000_best"].get(fy)
        s = round(sum(x["fine_millions"] for x in lst), 3)
        if tot:
            vs_workload.append({"fy": fy, "listed_millions": s, "workload_total_millions": round(tot["value"] / 1000, 3), "listed_exceeds_total": s > tot["value"] / 1000 + 0.5, "total_basis": tot["basis"]})
        else:
            vs_workload.append({"fy": fy, "listed_millions": s, "workload_total_millions": None, "listed_exceeds_total": None, "total_basis": None})
    ctx = {"editions": editions, "series": series, "resolved": resolved, "derived": derived, "appr_html": appr_html, "appr_meta": data["appr_meta"], "appr_conflicts": appr_conflicts, "appr_comparison": appr_cmp,
           "appr_url": data["entry"]("doj/appropriation_figures.html")["url"], "charts": data["charts"], "chart_fines": chart_f, "fines_by_fy": fines_by_fy, "fine_ids": ids, "fines_html": fines, "fines_xlsx": data["fines_xlsx"],
           "fines_xlsx_notes": data["fines_xlsx_notes"], "fines_comparison": fcmp, "fines_vs_workload": vs_workload, "fines_url": data["entry"]("doj/sherman_act_fines_10m.html")["url"], "company_ciks": ciks,
           "company_near_misses": near, "ambiguous_company": ambiguous,
           "excluded": [{"source": "https://securities.stanford.edu/clearinghouse-research.html", "reason": "Stanford Securities Class Action Clearinghouse Terms of Service forbid scraping and automated access, copying, indexing, processing and storing of SCAC content, and reproduction on another site or service without written consent; no SCAC figure is used or stored."},
                        {"source": "https://www.cornerstone.com/ (Securities Class Action Filings reports)", "reason": "Cornerstone Research terms forbid robots/scraping and compiling a database from site content and limit use to personal, non-commercial purposes; nothing from Cornerstone is used."},
                        {"source": "https://www.justice.gov/atr/media/1381041/dl?inline", "reason": "Antitrust Division Accomplishments (Dec 2021-Jan 2025) is a one-page list of named matters, not a statistical series; counting list items would create figures the Division does not publish."}]}
    ctx["checks"] = cross_checks(ctx)
    return ctx


def inputs_for(data, rels):
    return [input_of(data["entry"](r)) for r in rels]


def main(dry_run=False):
    data = load()
    ctx = prepare(data)
    w_rows, w_summary = build_workload(ctx)
    f_rows, f_summary = build_fines(ctx)
    a_rows, a_summary = build_appropriations(ctx)
    built_at = time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime())
    editions = data["editions"]
    w_inputs = [input_of(e) for e in [data["entry"](editions[k]["sources"][s]["path"].split("enforcement_series/")[1]) for k in editions for s in editions[k]["sources"]]]
    w_inputs += inputs_for(data, [CHART_PAGES[k] for k in CHART_PAGES] + ["derived/appropriation_figures.xls.sheet1.csv", "doj/appropriation_figures.html", "doj/division-operations.html", "doj/legalpolicies.html"])
    # the fines rows also carry each fiscal year's share of the workload report's total fines, so the workload editions are inputs too
    f_inputs = inputs_for(data, ["doj/sherman_act_fines_10m.html", "doj/sherman_act_fines_10m.xlsx", "doj/sherman_act_fines_10m.pdf"]) + [x for x in w_inputs if "/workload_fy" in x["path"]]
    a_inputs = inputs_for(data, ["doj/appropriation_figures.html", "derived/appropriation_figures.xls.sheet1.csv", "doj/appropriation_figures.xls"])
    fy_range = f"FY{f_summary['fy_min']}-FY{f_summary['fy_max']}"
    builds = [
        (WORKLOAD_DS, f"DOJ Antitrust Division workload statistics by fiscal year (FY{FIRST_FY}-FY{LAST_FY})", [("fy", "Fiscal year"), ("crim_filed", "Criminal cases filed"), ("fines_000", "Criminal fines and penalties imposed ($000)"), ("hsr_received", "HSR premerger notifications"),
                                                                                                    ("merger_investigations", "Merger investigations"), ("civil_filed", "Civil cases filed"), ("appropriation_000", "Appropriation ($000)")],
         [("decade", "Decade", {f"{d}0s": f"{d}0s" for d in range(197, 203)}), ("coverage", "Coverage", {"workload": "Workload report", "criminal_charts_only": "Criminal charts data pages only"})], w_rows, w_summary, w_inputs,
         {"source": OPERATIONS_URL, "terms": TERMS, "fiscal_years": f"FY{FIRST_FY}-FY{LAST_FY}", "grain": "one record per fiscal year plus summary:series", "excluded": ctx["excluded"]}),
        (FINES_DS, f"DOJ Antitrust Division: Sherman Act criminal fines of $10 million or more ({fy_range}, list as of 9/13/23)", [("defendant", "Defendant"), ("fy", "Fiscal year"), ("product", "Product"), ("fine_millions", "Fine ($ millions)"), ("scope", "Scope"), ("country", "Country"), ("share_of_fy_total_pct", "Share of FY total fines (%)")],
         [("scope", "Geographic scope", {"International": "International", "Domestic": "Domestic"}), ("decade", "Decade", {f"{d}0s": f"{d}0s" for d in range(199, 203)})], f_rows, f_summary, f_inputs,
         {"source": ctx["fines_url"], "terms": TERMS, "fiscal_years": fy_range, "grain": "one record per listed fine plus summary:fines"}),
        (APPROP_DS, f"DOJ Antitrust Division appropriation figures by fiscal year (FY{min(ctx['appr_html'])}-FY{max(ctx['appr_html'])})", [("fy", "Fiscal year"), ("total_000", "Total funding appropriated ($000)"), ("general_fund_000", "General fund ($000)"), ("filing_fee_000", "Filing fee revenue ($000)"), ("yoy_pct", "Change on prior year (%)"), ("status", "Status")],
         [("decade", "Decade", {f"{d}0s": f"{d}0s" for d in range(190, 203)}), ("status", "Status", {"estimate": "Estimate", "published": "As printed"})], a_rows, a_summary, a_inputs,
         {"source": ctx["appr_url"], "terms": TERMS, "fiscal_years": f"FY{min(ctx['appr_html'])}-FY{max(ctx['appr_html'])}", "grain": "one record per fiscal year plus summary:appropriations"}),
    ]
    report = {}
    for ds, label, columns, filters, rows, summ, inputs, extra in builds:
        build = {"dataset": ds, "label": label, "listing_block": cw.listing(columns, filters), "summary": extra, "rows": rows, "built_at": built_at, "inputs": inputs}
        text = json.dumps(build, ensure_ascii=False, indent=None)
        report[ds] = {"rows": len(rows), "bytes": len(text), "ids": len({r["id"] for r in rows})}
        if not dry_run:
            OUT.mkdir(parents=True, exist_ok=True)
            (OUT / f"{ds}.json").write_text(text, encoding="utf-8")
    report["checks"] = {c["id"]: [c["compared"], c["agree"], len(c["differ"])] for c in ctx["checks"]}
    print(json.dumps(report, indent=1))
    return report


if __name__ == "__main__":
    main(dry_run="--dry-run" in sys.argv)
