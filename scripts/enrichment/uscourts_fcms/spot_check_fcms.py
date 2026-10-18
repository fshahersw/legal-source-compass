"""Independent spot checks of displayed figures in the built FCMS records (reads private/build/uscourts_fcms/*.json, no network).

Each check takes a figure exactly as displayed in a built record and recomputes it from raw material with readers other than the
extractor (layout.py / profiles.py are not used):

  pdf     `pdftotext -layout` of the cited PDF page: the record's whole printed series must appear as one run of numbers on a line
          (a dash for an unprinted value), the column of the displayed figure must hold the displayed number, and a label word of the
          measure must be on that line or the two lines above it.
  derived percentage changes recomputed from the numbers `pdftotext` prints (base and current columns).
  xlsx    the publisher's Excel edition of the same period (cells are unrounded numbers): ranks among the 94 districts or 12 circuits,
          roll-up sums over the circuit's districts, and the top entries of the analytics rankings.

Every check prints displayed value, recomputed value, source location and match. Output: private/build/uscourts_fcms/spot_checks.json
Run: python3 -I -B scripts/enrichment/uscourts_fcms/spot_check_fcms.py   (after build_uscourts_fcms.py)
"""
import json
import re
import sys
import warnings
from pathlib import Path

import openpyxl

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import courts  # noqa: E402
import crosscheck_excel as cx  # noqa: E402
import jsonio  # noqa: E402

ROOT = HERE.parents[2]
ACQ = ROOT / "private" / "acq" / "uscourts_fcms"
BUILD = ROOT / "private" / "build" / "uscourts_fcms"
TOKEN = re.compile(r"(?<![\w.,/])(?:-?\d[\d,]*\.?\d*|-?\.\d+)%?(?![\w/])|(?<![\w.,])[\-‐‑–−](?![\w.,])")
LABELS = {
    "filings": r"filings|total|appeals", "terminations": r"terminations|total", "pending": r"pending", "judgeships": r"judgeships|panels", "panels": r"panels",
    "vacant_judgeship_months": r"vacant", "pj_weighted_filings": r"weighted", "median_months_civil": r"civil|median", "median_months_civil_to_trial": r"trial",
    "civil_over_3y_pct": r"years old|over 3|over years|%|number", "civil_over_3y_count": r"civil cases|number", "jurors_pct_not_selected": r"selected|challenged|percent",
    "pj_trials": r"trials", "pj_filings_total": r"total", "pj_pending": r"pending", "pp_filings": r"total|per panel", "pp_pending": r"pending", "paj_merits_terminations": r"merits|meri",
    "median_months_notice_to_disposition": r"median|notice", "merits_terminations": r"total|merits", "terminations_procedural": r"procedural",
}
RESULTS = []


# ------------------------------------------------------------------ helpers
def load_rows(dataset):
    return {r["id"]: r for r in json.loads((BUILD / f"{dataset}.json").read_text())["rows"]}


def displayed_number(text):
    """Leading number of a displayed string ('1,020 (standing ...)', '+25.2%', '7.9') -> float; None for 'Not recorded'."""
    m = re.match(r"^\s*([+-]?\d[\d,]*\.?\d*|[+-]?\.\d+)", text or "")
    return float(m.group(1).replace(",", "")) if m else None


def line_numbers(line):
    out = []
    for t in TOKEN.findall(line):
        if re.fullmatch(r"[\-‐‑–−]", t):
            out.append(None)
        else:
            out.append(float(t.rstrip("%").replace(",", "").replace("−", "-")))
    return out


def find_series(pdf, pages, values, label_rx):
    """-> (page, line index, line text, column offset) of the first page line whose numbers contain `values` as one contiguous run."""
    for page in pages:
        lines = cx.page_lines(pdf, page)
        for i, line in enumerate(lines):
            nums = line_numbers(line)
            for s in range(0, len(nums) - len(values) + 1):
                if all((a == b) or (a is not None and b is not None and abs(a - b) < 1e-9) for a, b in zip(nums[s:s + len(values)], values)):
                    context = " ".join(lines[max(0, i - 2):i + 1]).lower()
                    if re.search(label_rx, context):
                        return page, i, line, s
    return None


def locate(pdf, pages, values, label_rx):
    """find_series for the printed order: editions up to 2009 print the newest period first (2008 2007 ... 2003), later ones oldest first.
    Returns (page, line, text, start, reversed) or None."""
    hit = find_series(pdf, pages, values, label_rx)
    if hit:
        return (*hit, False)
    hit = find_series(pdf, pages, values[::-1], label_rx)
    return (*hit, True) if hit else None


def pdf_path_for(record, index):
    url = record["item"]["fcms"]["source"]["url"]
    for meta in index.values():
        if meta.get("url") == url:
            return ROOT / meta["file"]
    raise KeyError(url)


def add(**kw):
    RESULTS.append(kw)
    flag = "OK " if kw["match"] else "MISMATCH"
    print(f"{flag} #{len(RESULTS):02d} {kw['kind']:9s} {kw['record']:28s} {kw['figure'][:46]:46s} shown={kw['displayed']!s:>14} recomputed={kw['recomputed']!s:>14}  {kw['where'][:70]}", flush=True)


def fact(row, label):
    return dict(map(tuple, row["detail"]["facts"]))[label]


# ------------------------------------------------------------------ pdf checks
def check_pdf(profiles, index, rid, measure, source, label=None, expect_not_recorded=False, period=None):
    row = profiles[rid]
    f = row["item"]["fcms"]
    periods = f["periods"]
    cur = period or f["period_end"]
    c = periods.index(cur)
    series = f["series"][measure]
    shown = row["item"]["cells"][source[1]] if source[0] == "cell" else fact(row, source[1])
    pdf = pdf_path_for(row, index)
    pages = f["source"]["pages"]
    label_rx = LABELS.get(measure, measure)
    if expect_not_recorded:
        # the page must print a dash in the displayed column (None in the series stands for a dash token) and the record must say Not recorded
        located = locate(pdf, pages, list(series), label_rx)
        ok = shown.startswith("Not recorded") and located is not None and series[c] is None
        add(kind="pdf", record=rid, figure=f"{label or measure}: Not recorded", displayed=shown[:40], recomputed="dash printed" if located else "series not found",
            where=(f"{pdf.name} p.{located[0]}: {located[2].strip()[:90]}" if located else pdf.name), match=bool(ok))
        return
    values = list(series)
    located = locate(pdf, pages, values, label_rx)
    if located is None:
        add(kind="pdf", record=rid, figure=label or measure, displayed=shown[:30], recomputed="series not found on page", where=pdf.name, match=False)
        return
    page, _, line, start, backwards = located
    col = (len(values) - 1 - c) if backwards else c
    printed = line_numbers(line)[start + col]
    d = displayed_number(shown)
    ok = d is not None and printed is not None and abs(d - printed) < 1e-9
    add(kind="pdf", record=rid, figure=label or measure, displayed=shown.split(" (")[0], recomputed=printed,
        where=f"{pdf.name} p.{page} col {col + 1}/{len(values)}{' (newest first)' if backwards else ''}: {line.strip()[:60]}", match=ok)


def check_change(profiles, index, rid, measure, fact_label):
    row = profiles[rid]
    f = row["item"]["fcms"]
    periods = f["periods"]
    cur = f["period_end"]
    base_period = f["change"][measure]["yoy"][0]
    shown = fact(row, fact_label)
    pdf = pdf_path_for(row, index)
    located = locate(pdf, f["source"]["pages"], f["series"][measure], LABELS.get(measure, measure))
    if located is None:
        add(kind="derived", record=rid, figure=fact_label, displayed=shown[:30], recomputed="series not found", where=pdf.name, match=False)
        return
    page, _, line, start, backwards = located
    nums = line_numbers(line)
    n = len(periods)
    col = (lambda k: n - 1 - k) if backwards else (lambda k: k)
    now, before = nums[start + col(periods.index(cur))], nums[start + col(periods.index(base_period))]
    pct = round((now - before) / abs(before) * 100, 1)
    m = re.search(r"\(([+-][\d.,]+)%\)", shown)
    shown_pct = float(m.group(1).replace(",", "")) if m else None
    add(kind="derived", record=rid, figure=fact_label, displayed=f"{shown_pct:+.1f}%" if shown_pct is not None else shown[:20], recomputed=f"{pct:+.1f}% ({before:g}->{now:g})",
        where=f"{pdf.name} p.{page}", match=shown_pct is not None and abs(shown_pct - pct) < 1e-9)


# ------------------------------------------------------------------ xlsx checks
def xlsx_for(edition_suffix, kind):
    slug = [p.name for p in (ACQ / "files").iterdir() if p.name.endswith(edition_suffix)][0]
    book_path = [p for p in (ACQ / "files" / slug).iterdir() if p.suffix.lower() == ".xlsx" and (("dis" in p.name.lower()) == (kind == "district"))][0]
    with warnings.catch_warnings():
        warnings.simplefilter("ignore")
        book = openpyxl.load_workbook(book_path, data_only=True)
    parsed = jsonio.load(ACQ / "parsed" / f"{slug}__{kind}.json.gz")
    name_to_id = {cx.norm_text(p["name"]): p["court_id"] for p in parsed["pages"] if p.get("court_id")}
    blocks = {}
    for ws in book.worksheets:
        for name, panels in cx.blocks_of(ws):
            blocks.setdefault(name, []).extend(panels)
    return book_path, name_to_id, blocks


def excel_value(panels, label_rx, column=5, panel=0, nth=0):
    hits = []
    for rownum, label, series in panels[panel]:
        if re.search(label_rx, label):
            for s in series:
                hits.append((rownum, s))
    rownum, s = hits[nth]
    return rownum, s[column]


def district_table(edition_suffix, label_rx, column=5, nth=0):
    path, name_to_id, blocks = xlsx_for(edition_suffix, "district")
    table = {}
    for name, panels in blocks.items():
        if not name or name not in name_to_id or name_to_id[name] == "national":
            continue
        rownum, v = excel_value(panels, label_rx, column, 0, nth)
        table[name_to_id[name]] = (v, rownum, name)
    return path, table


def ranks_desc(values):
    return {k: 1 + sum(1 for o in values.values() if o is not None and o > v) for k, v in values.items() if v is not None}


def check_rank(profiles, rid, measure, edition_suffix, label_rx, kind="district", nth=0):
    row = profiles[rid]
    f = row["item"]["fcms"]
    cid = f["court_id"]
    if kind == "district":
        path, table = district_table(edition_suffix, label_rx, nth=nth)
        values = {k: v[0] for k, v in table.items()}
        where_row = table[cid][1]
    else:
        path, name_to_id, blocks = xlsx_for(edition_suffix, "circuit")
        values, where_row = {}, None
        for name, panels in blocks.items():
            if name and name in name_to_id and name_to_id[name] != "national":
                rn, v = excel_value(panels, label_rx, 5, 0, nth)
                values[name_to_id[name]] = v
                if name_to_id[name] == cid:
                    where_row = rn
    ranks = ranks_desc(values)
    shown = f["rank"][measure]
    ok = shown[0] == ranks[cid] and shown[1] == len(ranks)
    add(kind="xlsx rank", record=rid, figure=f"rank of {measure} (desc.)", displayed=f"{shown[0]} of {shown[1]}", recomputed=f"{ranks[cid]} of {len(ranks)}", where=f"{path.name} row {where_row}", match=ok)


def check_rollup(rollups, rid, measure, edition_suffix, label_rx, fact_label, nth=0):
    row = rollups[rid]
    f = row["item"]["fcms"]
    path, table = district_table(edition_suffix, label_rx, nth=nth)
    members = f["districts"]
    total = sum(table[m][0] for m in members)
    shown = fact(row, fact_label)
    d = displayed_number(shown)
    add(kind="xlsx sum", record=rid, figure=fact_label, displayed=shown.split(" (")[0], recomputed=f"{total:,.0f}", where=f"{path.name}: {len(members)} district rows", match=d is not None and abs(d - total) < 0.5)


def check_national_recon(rollups, rid, edition_suffix):
    row = rollups[rid]
    path, table = district_table(edition_suffix, r"^Overall Caseload Statistics Filings")
    total = sum(v[0] for v in table.values())
    _, _, blocks = xlsx_for(edition_suffix, "district")
    nat = excel_value(blocks[""], r"^Overall Caseload Statistics Filings", 5, 0, 0)[1]
    shown = fact(row, "Sum of district filings minus the national page's printed filings")
    diff = int(round(total - nat))
    ok = shown.replace(",", "").replace("+", "") == str(diff) or shown == f"{diff:+,}"
    add(kind="xlsx recon", record=rid, figure="sum of districts minus national", displayed=shown, recomputed=f"{diff:+,} ({total:,.0f} - {nat:,.0f})", where=path.name, match=ok)


def check_top_ranked(analytics, rid, measure, edition_suffix, label_rx, which="high"):
    row = analytics[rid]
    lst = next(x for x in row["item"]["fcms"]["lists"] if x["measure"] == measure)
    path, table = district_table(edition_suffix, label_rx)
    items = [(k, v[0]) for k, v in table.items() if v[0] is not None]
    items.sort(key=lambda kv: ((-kv[1] if which == "high" else kv[1]), kv[0]))
    top = items[0]
    shown = lst[which][0]
    ok = shown["court_id"] == top[0] and abs(shown["value"] - top[1]) < 0.05 + 1e-9
    add(kind="xlsx top", record=rid, figure=f"{lst['high_label'] if which == 'high' else lst['low_label']}", displayed=f"{shown['court_id']} {shown['value']}", recomputed=f"{top[0]} {round(top[1], 2)}",
        where=f"{path.name} ({len(items)} districts)", match=ok)


def check_top_increase(analytics, rid, measure, edition_suffix, label_rx, min_base):
    row = analytics[rid]
    ch = next(x for x in row["item"]["fcms"]["changes"] if x["measure"] == measure)
    path, now = district_table(edition_suffix, label_rx, column=5)
    _, before = district_table(edition_suffix, label_rx, column=4)
    pct = {k: round((now[k][0] - before[k][0]) / abs(before[k][0]) * 100, 1) for k in now if now[k][0] is not None and before[k][0] is not None and abs(before[k][0]) >= min_base}
    top = sorted(pct.items(), key=lambda kv: (-kv[1], kv[0]))[0]
    shown = ch["increases"][0]
    ok = shown["court_id"] == top[0] and abs(shown["pct"] - top[1]) < 1e-9 and ch["n"] == len(pct)
    add(kind="xlsx top", record=rid, figure=f"largest increase in {measure} (base >= {min_base})", displayed=f"{shown['court_id']} {shown['pct']:+.1f}% (n={ch['n']})", recomputed=f"{top[0]} {top[1]:+.1f}% (n={len(pct)})",
        where=f"{path.name} columns 5 and 6", match=ok)


# ------------------------------------------------------------------ the checks
def main():
    index = jsonio.load(ACQ / "parsed" / "_index.json")
    profiles, rollups, analytics = load_rows("fcms_court_profiles"), load_rows("fcms_circuit_rollups"), load_rows("fcms_analytics")
    P = lambda *a, **k: check_pdf(profiles, index, *a, **k)  # noqa: E731

    # --- displayed figures against the PDF text
    P("cand:2026-06-30", "filings", ("cell", "filings"))
    P("cand:2026-06-30", "pending", ("fact", "Pending cases (count)"))
    P("nysd:2019-09-30", "pj_weighted_filings", ("fact", "Weighted filings per judgeship (per judgeship)"))
    P("txsd:2024-03-31", "median_months_civil", ("fact", "Median months, civil filing to disposition (months)"))
    P("flsd:2012-12-31", "terminations", ("cell", "terminations"))
    P("ilnd:2008-09-30", "filings", ("cell", "filings"))
    P("azd:2005-06-30", "pj_filings_total", ("fact", "Filings per judgeship (per judgeship)"))
    P("cacd:2010-09-30", "pending", ("cell", "pending"))
    P("prd:2026-06-30", "judgeships", ("cell", "judgeships"))
    P("akd:2016-12-31", "civil_over_3y_pct", ("fact", "Civil cases over 3 years old, share of pending civil caseload (percent)"))
    P("nmid:2024-12-31", "filings", ("cell", "filings"))                       # the publisher's Excel differs here; the PDF is the source
    P("vid:2021-03-31", "median_months_civil_to_trial", ("fact", "Median months, civil filing to trial (months)"), expect_not_recorded=True)
    P("ca9:2026-06-30", "filings", ("cell", "filings"))
    P("ca5:2026-03-31", "pp_filings", ("fact", "Appeals filed per panel, total (per panel)"))
    P("cadc:2026-03-31", "judgeships", ("cell", "judgeships"))                  # two-line "11 /" over "3.7" cell
    P("cadc:2026-03-31", "panels", ("fact", "Authorized three-judge panels (count)"))
    P("ca3:2017-03-31", "filings", ("cell", "filings"))                        # the publisher's Excel is defective for this table
    P("ca8:2024-12-31", "pp_pending", ("fact", "Pending appeals per panel (per panel)"))   # likewise
    P("ca1:2009-06-30", "filings", ("cell", "filings"))
    P("national-district:2026-06-30", "filings", ("cell", "filings"))
    P("national-district:2023-12-31", "vacant_judgeship_months", ("fact", "Vacant judgeship months (months)"))
    P("ca6:2026-03-31", "paj_merits_terminations", ("fact", "Terminations on the merits per active judge (per active judge)"))
    P("wiwd:2014-06-30", "jurors_pct_not_selected", ("fact", "Jurors not selected or challenged (percent)"))
    P("lawd:2018-12-31", "pj_trials", ("fact", "Trials completed per judgeship (per judgeship)"))

    # --- derived year-over-year changes recomputed from the numbers the PDF text prints
    check_change(profiles, index, "cand:2026-06-30", "filings", "Filings: change from 2025 (derived)")
    check_change(profiles, index, "txnd:2020-09-30", "pending", "Pending cases: change from 2019 (derived)")
    check_change(profiles, index, "ca9:2022-06-30", "filings", "Appeals filed, total: change from 2021 (derived)")
    check_change(profiles, index, "national-district:2019-03-31", "pending", "Pending cases: change from 2018 (derived)")
    check_change(profiles, index, "nysd:2013-09-30", "median_months_civil", "Median months, civil filing to disposition: change from 2012 (derived)")
    check_change(profiles, index, "vtd:2015-03-31", "civil_over_3y_count", "Civil cases over 3 years old: change from 2014 (derived)")

    # --- ranks recomputed from the publisher's Excel
    check_rank(profiles, "cand:2026-06-30", "filings", "june-2026", r"^Overall Caseload Statistics Filings")
    check_rank(profiles, "txed:2022-06-30", "pj_weighted_filings", "june-2022", r"^Weighted Filings")
    check_rank(profiles, "nysd:2019-09-30", "pending", "september-2019", r"^Pending$")
    check_rank(profiles, "flmd:2024-09-30", "filings", "september-2024", r"^Overall Caseload Statistics Filings")
    check_rank(profiles, "ca5:2023-06-30", "filings", "june-2023", r"Total$", kind="circuit")
    check_rank(profiles, "ca9:2021-12-31", "pending", "december-2021", r"Pending Appeals", kind="circuit")

    # --- roll-up sums recomputed from the Excel district rows
    check_rollup(rollups, "ca9:2026-06-30", "filings", "june-2026", r"^Overall Caseload Statistics Filings", "District filings (sum of district profiles, derived)")
    check_rollup(rollups, "ca5:2022-09-30", "terminations", "september-2022", r"^Terminations$", "District terminations (sum, derived)")
    check_rollup(rollups, "ca2:2019-12-31", "pending", "december-2019", r"^Pending$", "District pending cases (sum, derived)")
    check_rollup(rollups, "ca11:2025-03-31", "judgeships", "march-2025", r"^Number of Judgeships", "Authorized district judgeships (sum, derived)")
    check_national_recon(rollups, "national:2026-06-30", "june-2026")

    # --- analytics lists recomputed from the Excel
    check_top_ranked(analytics, "rankings:district:2026-06-30", "median_months_civil", "june-2026", r"^Civil ²", which="high")
    check_top_ranked(analytics, "rankings:district:2024-06-30", "pj_weighted_filings", "june-2024", r"^Weighted Filings", which="low")
    check_top_increase(analytics, "rankings:district:2026-06-30", "filings", "june-2026", r"^Overall Caseload Statistics Filings", 100)

    bad = [r for r in RESULTS if not r["match"]]
    out = {"checks": RESULTS, "total": len(RESULTS), "matches": len(RESULTS) - len(bad), "mismatches": len(bad)}
    (BUILD / "spot_checks.json").write_text(json.dumps(out, indent=1, ensure_ascii=False))
    print(f"SPOT CHECKS: {out['total']} checks, {out['matches']} match, {out['mismatches']} mismatch")


if __name__ == "__main__":
    main()
