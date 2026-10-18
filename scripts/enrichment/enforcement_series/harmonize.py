"""Turn the six workload editions into one national series per metric, plus derived analytics and consistency checks.

Rules (all deterministic; nothing is imputed):
* a value keeps its printed text, edition, locator (PDF page or web-page table/row) and footnote marks;
* where two editions print the same fiscal year, the later edition supersedes and the earlier value stays as an `alt` entry;
* a printed dash is value None (never 0); a derived figure needs every input numeric, otherwise it is None (Not recorded);
* derived figures state their formula in FORMULAS; YoY compares consecutive fiscal years only.
"""
import re

import metrics as mx

# --- footnote repairs: two footnotes lose their first words in the PDF word-box reading (checked against pdftotext -layout)
FOOTNOTE_OVERRIDES = {
    ("fy2000_2009", "10"): "This represents the number of Cases pending identifiable as a case with a Sherman Act – Restraint of Trade violation. This updated information is as of FY 2009, and replaces the method previously used. A pending case is defined as a case whereby no defendant in a case has entered a plea of guilty or has been found guilty at trial.",
    ("fy1990_1999", "6"): "This statistic includes only first CID issued in an investigation.",
}
FOOTER_RE = re.compile(r"\s*Antitrust Division,? Workload Statistics\s*\d*\s*$")

FORMULAS = {
    "crim_win_rate_pct": "crim_won / (crim_won + crim_lost) x 100; None when either input is a printed dash or missing",
    "fine_corporate_avg_000": "fine_corporate_000 / fine_corporations_n ($ thousands per corporation fined); None when the count is 0, a dash or missing",
    "fine_individual_avg_000": "fine_individual_000 / fine_individuals_n ($ thousands per individual fined); None when the count is 0, a dash or missing",
    "fine_total_000_computed": "fine_individual_000 + fine_corporate_000, only for FY1970-FY1989 where no total row is printed; None when either is a printed dash or missing",
    "fine_total_000_best": "published fine_total_000 when printed (FY1990 onward); otherwise fine_total_000_computed",
    "fines_to_appropriation_ratio": "fine_total_000_best / total funding appropriated for the same fiscal year ($ thousands over $ thousands, both nominal); compares two published amounts and does not imply the Division receives the fines",
    "second_request_rate_pct": "second_requests / hsr_received x 100",
    "hsr_investigation_rate_pct": "hsr_investigations / hsr_received x 100",
    "incarceration_share_pct": "indiv_incarcerated / indiv_sentenced x 100",
    "incarceration_days_avg": "incarceration_days_avg_published when printed (FY2010 onward, and FY2016-FY2025 on the criminal charts data pages); otherwise incarceration_days_total / indiv_incarcerated (FY1990-FY2009)",
    "civil_filed_best": "civil_filed when printed (through FY2019); from FY2020, total merger complaints filed + total conduct complaints filed (both printed in the FY2015-2024 edition; the identity is checked for FY2015-FY2019)",
    "yoy_pct": "(value in FY - value in FY-1) / value in FY-1 x 100, rounded to 0.1; None when FY-1 is absent, a dash, zero or not numeric; flagged cross_edition when the two values come from different editions",
    "trailing5_mean": "mean of the value for FY-4 through FY when all five are numeric; None otherwise",
}
YOY_KEYS = ["crim_filed", "fine_total_000_best", "hsr_received", "merger_investigations", "civil_filed_best", "second_requests", "gj_initiated", "indiv_incarcerated", "appropriation_total_000", "crim_individuals_charged", "crim_corporations_charged"]
TRAIL_KEYS = ["crim_filed", "fine_total_000_best", "hsr_received", "merger_investigations"]


def num(x):
    return x if isinstance(x, (int, float)) and not isinstance(x, bool) else None


def clean_footnote(edition, mark, text):
    if (edition, mark) in FOOTNOTE_OVERRIDES:
        return FOOTNOTE_OVERRIDES[(edition, mark)], True
    return FOOTER_RE.sub("", text).strip(), False


def resolve(editions):
    """metric key -> edition -> {fy: cell with table/row/heading/locator} using the explicit rules; raises on any ambiguity."""
    out = {}
    for m in mx.METRICS:
        out[m["key"]] = {}
        for ek, rule in m["rules"].items():
            ed = editions[ek]
            table, row = mx.select_row(ed["tables"], rule)
            cells = {}
            for fy in ed["years"]:
                c = row["values"].get(fy)
                if c is None:
                    continue
                cells[fy] = {**c, "edition": ek, "heading": table["heading"], "label": row["label"], "table_id": table["id"], "heading_marks": table["heading_marks"],
                             "label_marks": row["marks"], "notes": table["notes"], "kind": table["kind"]}
            out[m["key"]][ek] = cells
    return out


def pick(per_edition, fy):
    """(primary cell, [alt cells]) for one fiscal year: the latest edition that prints the year wins."""
    have = [(ek, per_edition[ek][fy]) for ek in PRIORITY if ek in per_edition and fy in per_edition[ek]]
    if not have:
        return None, []
    primary = have[-1][1]
    alts = [c for _, c in have[:-1]]
    return primary, alts


CHART = "criminal_charts"
PRIORITY = [CHART] + mx.ORDER  # the criminal-charts data pages only fill years (FY2025) that no workload edition prints


def build_series(editions, years, extra=None):
    """{metric: {fy: {"cell", "alts"}}}. `extra` = {metric: {edition-like source key: {fy: cell}}} adds sources such as the charts pages."""
    resolved = resolve(editions)
    for key, sources in (extra or {}).items():
        for source, cells in sources.items():
            resolved[key][source] = cells
    series = {}
    for key, per_ed in resolved.items():
        series[key] = {}
        for fy in years:
            primary, alts = pick(per_ed, fy)
            if primary is not None:
                series[key][fy] = {"cell": primary, "alts": alts}
    return series


def value(series, key, fy):
    entry = series.get(key, {}).get(fy)
    return None if entry is None else entry["cell"]["value"]


def ratio(a, b, scale=1.0, digits=4):
    a, b = num(a), num(b)
    if a is None or b is None or b == 0:
        return None
    return round(a / b * scale, digits)


def derive(series, years, appropriation, chart):
    """Derived per-FY figures: {key: {fy: {"value", "basis", "inputs"}}}. `appropriation` {fy: total_000}, `chart` {key: {fy: value}}."""
    d = {k: {} for k in ("crim_win_rate_pct", "fine_corporate_avg_000", "fine_individual_avg_000", "fine_total_000_computed", "fine_total_000_best", "fines_to_appropriation_ratio",
                         "second_request_rate_pct", "hsr_investigation_rate_pct", "incarceration_share_pct", "incarceration_days_avg", "civil_filed_best", "appropriation_total_000")}
    for fy in years:
        v = lambda k: value(series, k, fy)  # noqa: E731
        won, lost = num(v("crim_won")), num(v("crim_lost"))
        if won is not None and lost is not None and won + lost > 0:
            d["crim_win_rate_pct"][fy] = {"value": round(won / (won + lost) * 100, 1), "inputs": ["crim_won", "crim_lost"]}
        a = ratio(v("fine_corporate_000"), v("fine_corporations_n"), 1.0, 1)
        if a is not None:
            d["fine_corporate_avg_000"][fy] = {"value": a, "inputs": ["fine_corporate_000", "fine_corporations_n"]}
        a = ratio(v("fine_individual_000"), v("fine_individuals_n"), 1.0, 1)
        if a is not None:
            d["fine_individual_avg_000"][fy] = {"value": a, "inputs": ["fine_individual_000", "fine_individuals_n"]}
        if num(v("fine_total_000")) is None and num(v("fine_individual_000")) is not None and num(v("fine_corporate_000")) is not None and fy <= 1989:
            d["fine_total_000_computed"][fy] = {"value": v("fine_individual_000") + v("fine_corporate_000"), "inputs": ["fine_individual_000", "fine_corporate_000"]}
        if num(v("fine_total_000")) is not None:
            d["fine_total_000_best"][fy] = {"value": v("fine_total_000"), "basis": "published", "inputs": ["fine_total_000"]}
        elif fy in d["fine_total_000_computed"]:
            d["fine_total_000_best"][fy] = {"value": d["fine_total_000_computed"][fy]["value"], "basis": "computed", "inputs": ["fine_individual_000", "fine_corporate_000"]}
        if fy in appropriation:
            d["appropriation_total_000"][fy] = {"value": appropriation[fy], "basis": "published", "inputs": []}
        best = d["fine_total_000_best"].get(fy)
        if best and fy in appropriation and appropriation[fy]:
            d["fines_to_appropriation_ratio"][fy] = {"value": round(best["value"] / appropriation[fy], 3), "inputs": ["fine_total_000_best", "appropriation_total_000"]}
        a = ratio(v("second_requests"), v("hsr_received"), 100.0, 2)
        if a is not None:
            d["second_request_rate_pct"][fy] = {"value": a, "inputs": ["second_requests", "hsr_received"]}
        a = ratio(v("hsr_investigations"), v("hsr_received"), 100.0, 2)
        if a is not None:
            d["hsr_investigation_rate_pct"][fy] = {"value": a, "inputs": ["hsr_investigations", "hsr_received"]}
        a = ratio(v("indiv_incarcerated"), v("indiv_sentenced"), 100.0, 1)
        if a is not None:
            d["incarceration_share_pct"][fy] = {"value": a, "inputs": ["indiv_incarcerated", "indiv_sentenced"]}
        pub = num(v("incarceration_days_avg_published"))
        if pub is not None:
            d["incarceration_days_avg"][fy] = {"value": pub, "basis": "published", "inputs": ["incarceration_days_avg_published"]}
        elif fy in chart.get("incarceration_days_avg", {}):
            d["incarceration_days_avg"][fy] = {"value": chart["incarceration_days_avg"][fy], "basis": "published (criminal charts data page)", "inputs": []}
        else:
            a = ratio(v("incarceration_days_total"), v("indiv_incarcerated"), 1.0, 1)
            if a is not None:
                d["incarceration_days_avg"][fy] = {"value": a, "basis": "computed", "inputs": ["incarceration_days_total", "indiv_incarcerated"]}
        if num(v("civil_filed")) is not None:
            d["civil_filed_best"][fy] = {"value": v("civil_filed"), "basis": "published", "inputs": ["civil_filed"]}
        elif fy >= 2020 and num(v("merger_complaints_filed")) is not None and num(v("conduct_complaints_filed")) is not None:
            d["civil_filed_best"][fy] = {"value": v("merger_complaints_filed") + v("conduct_complaints_filed"), "basis": "computed", "inputs": ["merger_complaints_filed", "conduct_complaints_filed"]}
    return d


def metric_value(series, derived, key, fy):
    if key in derived:
        e = derived[key].get(fy)
        return None if e is None else e["value"]
    return value(series, key, fy)


def add_chart_to_series(series_values, chart, fy):
    return series_values


def yoy(series, derived, key, fy, chart_values=None):
    """(pct, cross_edition) for FY vs FY-1."""
    cur = metric_value(series, derived, key, fy)
    prev = metric_value(series, derived, key, fy - 1)
    if chart_values is not None:
        cur = cur if cur is not None else chart_values.get(fy)
        prev = prev if prev is not None else chart_values.get(fy - 1)
    cur, prev = num(cur), num(prev)
    if cur is None or prev is None or prev == 0:
        return None, False
    cross = False
    e1 = series.get(key, {}).get(fy)
    e0 = series.get(key, {}).get(fy - 1)
    if e1 and e0:
        cross = e1["cell"]["edition"] != e0["cell"]["edition"]
    return round((cur - prev) / prev * 100, 1), cross


def trailing_mean(series, derived, key, fy):
    vals = [num(metric_value(series, derived, key, y)) for y in range(fy - 4, fy + 1)]
    if any(x is None for x in vals):
        return None
    return round(sum(vals) / 5, 1)


# ---------------------------------------------------------------------------------------------- checks
PART_LABELS = {"won", "lost", "dismissed", "settlement entered", "government initiated dismissal"}


def identity_checks(edition):
    """Terminated (or Total Resolutions) = sum of the won/lost/dismissed-type rows that follow it, per table and fiscal year.

    A printed dash counts as zero ONLY here, to test the printed arithmetic; it is never carried into any series.
    """
    checked, failed = 0, []
    for t in edition["tables"]:
        rows = t["rows"]
        for i, r in enumerate(rows):
            if r["label"].lower() not in ("terminated", "total resolutions", "resolution"):
                continue
            parts = []
            for q in rows[i + 1:]:
                if q["label"].lower() in PART_LABELS:
                    parts.append(q)
                else:
                    break
            if not parts:
                continue
            for fy in edition["years"]:
                tot = r["values"].get(fy)
                if tot is None or tot["dash"] or tot["value"] is None:
                    continue
                vals = []
                for q in parts:
                    c = q["values"].get(fy)
                    vals.append(0 if c is not None and c["dash"] else (c["value"] if c is not None else None))
                if any(x is None for x in vals):
                    continue
                checked += 1
                if sum(vals) != tot["value"]:
                    failed.append({"edition": edition["key"], "table": t["heading"], "page": t.get("page"), "row": r["label"], "fy": fy, "published_total": tot["value"], "sum_of_parts": sum(vals), "parts": [q["label"] for q in parts]})
    return checked, failed
