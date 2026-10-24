"""Table specifications and fact extraction for the class action research reports.

Each spec names a printed table by its caption and says how its rows and columns map to series. Columns either come
from an explicit variant (chosen by the number of value cells and words in the printed header) or are derived from the
periods printed in the header; either way the count must match every row exactly, and a table with a "Total" row must
add up to it (within the rounding the printed precision allows) or the whole table is held. A fact keeps the value and
the text exactly as printed, the unit and dollar basis the table states, the caption, row and column labels, and the
PDF page and printed page it comes from.
"""
from __future__ import annotations

import re
from dataclasses import asdict, dataclass, field

import cra_tables as T

# ------------------------------------------------------------------------------------------------ series registry

SERIES: dict[str, tuple[str, str]] = {}  # key -> (label, unit)


def series(key: str, label: str, unit: str) -> str:
    SERIES.setdefault(key, (label, unit))
    return key


@dataclass
class Fact:
    report_id: str
    series: str
    series_label: str
    period: str
    period_type: str  # year | half | quarter | range
    aggregate: str  # "" for a single period; otherwise e.g. "annual average", "all settlements in the period"
    value: float
    value_text: str
    unit: str
    basis: str
    dimension: str  # "" or e.g. "Circuit: 9th"
    scope: str  # population as the caption states it, e.g. "Core Federal Filings"
    table: str  # caption as printed
    row_label: str
    column_label: str
    pdf_page: int
    printed_page: str
    method: str = "table"
    partial: bool = False
    note: str = ""

    def key(self) -> str:
        return "|".join([self.report_id, self.series, self.dimension, self.period, self.aggregate])

    def to_dict(self) -> dict:
        return asdict(self)


@dataclass
class Issue:
    report_id: str
    table: str
    page: int
    reason: str


@dataclass
class Result:
    facts: list[Fact] = field(default_factory=list)
    issues: list[Issue] = field(default_factory=list)
    tables: list[dict] = field(default_factory=list)


# ------------------------------------------------------------------------------------------------ periods

RANGE = re.compile(r"(\d{4})(?:\s*(H[12]))?\s*[–-]\s*(\d{4})(?:\s*(H[12]))?")
SINGLE = re.compile(r"(?<![\d–-])(\d{4})(?:\s*(H[12]|Q[1-4]))?(?![\d–-])")


def norm_period(y1: str, h1: str | None, y2: str | None = None, h2: str | None = None) -> tuple[str, str]:
    if y2:
        a = f"{y1} {h1}" if h1 else y1
        b = f"{y2} {h2}" if h2 else y2
        return f"{a}–{b}", "range"
    if h1:
        return f"{y1} {h1}", "half" if h1.startswith("H") else "quarter"
    return y1, "year"


def header_periods(header: str) -> list[tuple[str, str]]:
    """Periods printed in a header, in order: ranges ("1997–2024", "1997 H1–2024 H2") and single periods. The dollar
    basis year ("Dollars in 2025 billions", "2025 dollar equivalent") is not a period."""
    header = re.sub(r"[Dd]ollars in \d{4}|\d{4} dollar|in \d{4} dollars", " ", header)
    out: list[tuple[int, str, str]] = []
    taken: list[tuple[int, int]] = []
    for m in RANGE.finditer(header):
        out.append((m.start(), *norm_period(m.group(1), m.group(2), m.group(3), m.group(4))))
        taken.append((m.start(), m.end()))
    for m in re.finditer(r"[Tt]hrough (\d{4})", header):
        out.append((m.start(), f"through {m.group(1)}", "range"))
        taken.append((m.start(), m.end()))
    for m in SINGLE.finditer(header):
        if any(a <= m.start() < b for a, b in taken):
            continue
        out.append((m.start(), *norm_period(m.group(1), m.group(2))))
    return [(p, t) for _, p, t in sorted(out)]


def row_period(label: str) -> tuple[str, str, str] | None:
    """(period, period type, aggregate) for a year-table row label: "2025", "2025 H1", "Average 1997–2024"."""
    s = " ".join(label.split())
    m = T.YEAR_LABEL.match(s)
    if m:
        p, t = norm_period(m.group(1), m.group(2))
        return p, t, ""
    sq = re.sub(r"\s+", "", s)
    if "verage" in sq:
        r = re.search(r"(\d{4})(H[12])?[–-](\d{4})(H[12])?", sq)
        if not r:
            return None  # an average whose period is not printed with it is left out
        p, _ = norm_period(r.group(1), r.group(2), r.group(3), r.group(4))
        agg = "semiannual average" if ("semiannual" in sq.lower() or r.group(2)) else "annual average"
        return p, "range", agg
    return None


# ------------------------------------------------------------------------------------------------ helpers

def scope_of(caption: str) -> str:
    c = " ".join(caption.split())
    c = re.sub(r"^(Figure|FIGURE|Appendix|APPENDIX)\s+\d+[A-Z]?\s*[:.]\s*", "", c)
    m = re.search(r"[—–-]\s*([A-Za-z&’' ]*(Filings|Cases|Claims))\s*$", c, re.I)
    if m:
        return m.group(1).strip()
    if re.search(r"federal and state", c, re.I):
        return "Federal and State"
    if re.search(r"\bfederal\b", c, re.I):
        return "Federal"
    return ""


def unit_for(base_unit: str, cell: str, header_scale: str) -> str:
    if not base_unit.startswith("usd"):
        return base_unit
    suffix = T.scale_suffix(cell)
    if suffix:
        return {"B": "usd_billions", "M": "usd_millions", "K": "usd_thousands"}[suffix]
    return base_unit if base_unit != "usd" else (header_scale or "usd")


def header_scale(text: str) -> str:
    t = text.lower()
    if re.search(r"(dollars in|\$)\s*(\d{4}\s*)?billions", t) or "($ billions)" in t:
        return "usd_billions"
    if re.search(r"(dollars in|\$)\s*(\d{4}\s*)?millions", t) or "($ millions)" in t or "in millions" in t:
        return "usd_millions"
    return ""


def emit(res: Result, ctx: dict, region: T.Region, *, series_key: str, label: str, unit: str, period: str, ptype: str,
         aggregate: str, cell: str, dimension: str, row_label: str, column_label: str, basis_text: str,
         partial: bool = False, note: str = "") -> None:
    v, text = T.value_of(cell)
    if v is None:
        return  # a dash or N/A: the table does not report this value
    u = unit if not unit.startswith("usd") else unit_for(unit, cell, header_scale(region.header + " " + region.caption))
    if u == "usd" and not re.fullmatch(r"\$\d{1,3}(,\d{3})+", text):
        res.issues.append(Issue(ctx["id"], region.caption, region.page, f"dollar scale not stated for {row_label}/{column_label}"))
        return
    series(series_key, label, u)
    res.facts.append(Fact(
        report_id=ctx["id"], series=series_key, series_label=label, period=period, period_type=ptype, aggregate=aggregate,
        value=v, value_text=text, unit=u, basis=T.basis_of(basis_text, u), dimension=dimension, scope=scope_of(region.caption),
        table=region.caption, row_label=row_label, column_label=column_label, pdf_page=region.page,
        printed_page=ctx["printed"][region.page - 1] or "", method="table", partial=partial, note=note))


def held(res: Result, ctx: dict, region: T.Region, reason: str) -> None:
    res.issues.append(Issue(ctx["id"], region.caption, region.page, reason))
    res.tables.append({"report": ctx["id"], "table": region.caption, "page": region.page, "status": "held", "reason": reason})


def accepted(res: Result, ctx: dict, region: T.Region, n: int) -> None:
    res.tables.append({"report": ctx["id"], "table": region.caption, "page": region.page, "status": "extracted", "facts": n})


def _dec(cell: str) -> int:
    m = re.search(r"\.(\d+)", cell)
    return len(m.group(1)) if m else 0


def sums_ok(rows: list[list[str]], total: list[str], exact: list[bool]) -> list[str]:
    """Columns whose category rows do not add up to the printed Total. Exact columns (whole counts) must match exactly;
    others may differ by the rounding of each printed value (half a unit of its last printed digit, per cell)."""
    bad = []
    for c in range(len(total)):
        t, tt = T.value_of(total[c])
        cells = [r[c] for r in rows if T.value_of(r[c])[0] is not None]
        if t is None or not cells:
            continue
        s = sum(T.value_of(x)[0] for x in cells)
        if exact[c] and all(_dec(x) == 0 for x in cells + [total[c]]):
            tol = 0.0
        else:
            tol = sum(0.5 * 10 ** -_dec(x) for x in cells) + 0.5 * 10 ** -_dec(total[c]) + 1e-9
        if abs(s - t) > tol:
            bad.append(f"col {c + 1}: rows add to {s:g}, Total printed {tt}")
    return bad


def decimals_of(cells: list[str]) -> int:
    d = 0
    for c in cells:
        m = re.search(r"\.(\d+)", c)
        if m:
            d = max(d, len(m.group(1)))
    return d


# ------------------------------------------------------------------------------------------------ filings: summary

FILINGS_SUMMARY_ROWS = [
    (r"^Class Action Filings", "filings.class_action_filings", "Class action filings", "filings"),
    (r"^Core Filings", "filings.core_filings", "Core filings", "filings"),
    (r"^Disclosure Dollar Loss", "filings.ddl_total", "Disclosure Dollar Loss (total)", "usd_billions"),
    (r"^Maximum Dollar Loss", "filings.mdl_total", "Maximum Dollar Loss (total)", "usd_billions"),
]


def summary_columns(header: str, ncols: int) -> list[tuple[str, str, str, str]] | None:
    """(period, type, aggregate, column label) for a filings summary header: range statistics, then single periods."""
    periods = header_periods(header)
    ranges = [p for p in periods if p[1] == "range"]
    singles = [p for p in periods if p[1] != "range"]
    if len(ranges) != 1:
        return None
    rng = ranges[0][0]
    semi = "H1" in rng or re.search(r"semiannual|six-month", header, re.I)
    stats = re.findall(r"\b(Average|Maximum|Max|Minimum|Min)\b", header)
    names = {"Average": "average", "Max": "maximum", "Maximum": "maximum", "Min": "minimum", "Minimum": "minimum"}
    stats = [names[s] for s in stats] or ["average"]
    cols = [(rng, "range", f"{'semiannual' if semi else 'annual'} {s}", f"{rng} {s}") for s in stats]
    cols += [(p, t, "", p) for p, t in singles]
    return cols if len(cols) == ncols else None


def extract_filings_summary(res: Result, ctx: dict) -> None:
    cap = re.compile(r"(Figure|FIGURE)\s+1A?\s*[:.]?\s*.*(Summary|SUMMARY)|^\s*(CLASS ACTION FILINGS SUMMARY|Class Action Filings Summary)")
    for region in T.regions(ctx["pages"], cap):
        rows = [r for r, _ in _metric_rows(region, [(rx + ".*$", k, lab, u) for rx, k, lab, u in FILINGS_SUMMARY_ROWS])]
        if not rows:
            continue
        n = {len(r.cells) for r in rows}
        if len(n) != 1:
            held(res, ctx, region, f"rows have different numbers of values {sorted(n)}")
            continue
        cols = summary_columns(region.header, n.pop())
        if cols is None:
            held(res, ctx, region, "header periods do not match the number of values")
            continue
        before = len(res.facts)
        for r in rows:
            rx, key, label, unit = next(x for x in FILINGS_SUMMARY_ROWS if re.search(x[0], r.label))
            for (period, ptype, agg, clabel), cell in zip(cols, r.cells):
                emit(res, ctx, region, series_key=key, label=label, unit=unit, period=period, ptype=ptype, aggregate=agg, cell=cell,
                     dimension="", row_label=r.label, column_label=clabel, basis_text=region.header + " " + region.notes)
        accepted(res, ctx, region, len(res.facts) - before)
        return


# ------------------------------------------------------------------------------------------------ filings: year tables

C = tuple  # (key, label, unit)
DDL3 = [("filings.ddl_total", "Disclosure Dollar Loss (total)", "usd_billions"),
        ("filings.ddl_average", "Disclosure Dollar Loss (average per filing)", "usd_millions"),
        ("filings.ddl_median", "Disclosure Dollar Loss (median per filing)", "usd_millions")]
MDL3 = [("filings.mdl_total", "Maximum Dollar Loss (total)", "usd_billions"),
        ("filings.mdl_average", "Maximum Dollar Loss (average per filing)", "usd_millions"),
        ("filings.mdl_median", "Maximum Dollar Loss (median per filing)", "usd_millions")]
FIL = ("filings.class_action_filings", "Class action filings", "filings")
CORE = ("filings.core_filings", "Core filings", "filings")

BASIC_VARIANTS = [
    # (cells, must-have header words, must-not words, columns)
    (11, [r"Core", r"Number"], [], [FIL, CORE, *DDL3, *MDL3, ("filings.listed_firms", "U.S. exchange-listed firms", "firms"),
                                   ("filings.listed_firms_sued_core", "U.S. exchange-listed firms sued (core filings)", "firms"),
                                   ("filings.listed_firms_sued_core_pct", "Share of U.S. exchange-listed firms sued (core filings)", "percent")]),
    (9, [r"Number"], [r"Core", r"Excluding"], [FIL, *DDL3, *MDL3, ("filings.listed_firms", "U.S. exchange-listed firms", "firms"),
                                             ("filings.listed_firms_sued_pct", "Share of U.S. exchange-listed firms sued", "percent")]),
    (9, [r"Excluding"], [r"Core"], [FIL, *DDL3, *MDL3, ("filings.listed_firms_sued_pct", "Share of U.S. exchange-listed firms sued", "percent"),
                                    ("filings.listed_firms_sued_pct_ex_ma_crm",
                                     "Share of U.S. exchange-listed firms sued, excluding M&A and Chinese reverse merger filings", "percent")]),
    (8, [r"Core"], [r"Number"], [FIL, CORE, *DDL3, *MDL3]),
    (7, [], [r"Core", r"Number"], [FIL, *DDL3, *MDL3]),
]

MA_COLS_ALL = {
    "Dismissed": ("dismissed", "dismissed"), "Settled": ("settled", "settled"), "Remanded": ("remanded", "remanded"),
    "Continuing": ("continuing", "continuing"), "Trial": ("trial", "at trial"),
}


def ma_columns(header: str, ncols: int) -> list[tuple[str, str, str]] | None:
    words = re.findall(r"\b(Dismissed|Settled|Remanded|Continuing|Trial)\b", header)
    if len(words) % 2 or len(words) + 1 != ncols:
        return None
    half = len(words) // 2
    if words[:half] != words[half:]:
        return None
    other = re.search(r"Case Status of ([A-Za-z ]+?Filings)", header)
    other_label = other.group(1) if other else "All Other Filings"
    cols = [("filings.ma_filings", "M&A filings", "filings")]
    for w in words[:half]:
        k, lab = MA_COLS_ALL[w]
        cols.append((f"filings.ma_status.{k}", f"M&A filings {lab} (by filing year)", "filings"))
    for w in words[half:]:
        k, lab = MA_COLS_ALL[w]
        cols.append((f"filings.other_status.{k}", f"Other federal filings {lab} (by filing year; {other_label} as printed)", "filings"))
    return cols


def status_columns(header: str, ncols: int) -> list[tuple[str, str, str]] | None:
    """Case status by filing year: for each of the first three years, settled, dismissed, [trial|other], total resolved."""
    ordinals = ["first", "second", "third"]
    parts = re.findall(r"\b(Settled|Dismissed|Trial|Other)\b", header)
    if ncols == 12 and len(parts) == 9:
        third = parts[2]
        per = ["Settled", "Dismissed", third, "Total"]
    elif ncols == 9 and len(parts) == 6:
        per = ["Settled", "Dismissed", "Total"]
    else:
        return None
    if parts != [p for _ in ordinals for p in per if p != "Total"]:
        return None
    cols = []
    for i, o in enumerate(ordinals, 1):
        for p in per:
            k = {"Settled": "settled", "Dismissed": "dismissed", "Trial": "trial", "Other": "other", "Total": "resolved"}[p]
            lab = {"Total": f"resolved within {i} year{'s' if i > 1 else ''} (cumulative)"}.get(p, f"{k} in the {o} year")
            cols.append((f"filings.cohort_status.y{i}_{k}", f"Share of a filing cohort {lab}", "percent"))
    return cols


def caption_base(caption: str) -> str:
    return re.sub(r",?\s*\(?continued\)?\s*$", "", " ".join(caption.split()), flags=re.I)


def group_text(regions: list[T.Region]) -> dict[str, str]:
    """Header and note text of every page of a table, by caption (a table continued on the next page shares its note)."""
    out: dict[str, str] = {}
    for r in regions:
        k = caption_base(r.caption)
        out[k] = out.get(k, "") + " " + r.header + " " + r.notes
    return out


def cohort_partial(period: str, key: str, ctx: dict) -> bool:
    """A filing-cohort figure for 'within k years' is incomplete when cohort year + k runs past the report's data year."""
    m = re.search(r"\.y(\d)_", key)
    data_year = re.match(r"(\d{4})", ctx["report"]["period"])
    if not m or not data_year or not period.isdigit():
        return False
    return int(period) + int(m.group(1)) > int(data_year.group(1))


def extract_year_table(res: Result, ctx: dict, cap: re.Pattern, columns_for, label_for_scope: bool = False) -> None:
    regions = [r for r in T.regions(ctx["pages"], cap, year_rows=True) if r.rows]
    texts = group_text(regions)
    for region in regions:
        data = [r for r in region.rows if row_period(r.label)]
        if not data:
            continue
        counts = {len(r.cells) for r in data}
        if len(counts) != 1:
            held(res, ctx, region, f"rows have different numbers of values {sorted(counts)}")
            continue
        ncols = counts.pop()
        cols = columns_for(region.header, ncols)
        if cols is None:
            held(res, ctx, region, f"no column layout fits {ncols} values for this header")
            continue
        scope = scope_of(region.caption)
        halves = any(row_period(r.label)[1] == "half" for r in data)
        before = len(res.facts)
        for r in data:
            period, ptype, agg = row_period(r.label)
            if agg and halves:
                agg = "semiannual average"
            for (key, label, unit), cell in zip(cols, r.cells):
                k = f"{key}.{_scope_key(scope)}" if label_for_scope else key
                part = label_for_scope and cohort_partial(period, key, ctx)
                emit(res, ctx, region, series_key=k, label=label, unit=unit,
                     period=period, ptype=ptype, aggregate=agg, cell=cell, dimension="", row_label=r.label,
                     column_label=label, basis_text=texts[caption_base(region.caption)], partial=part,
                     note="The cohort's window runs past the report's data date; the report marks such figures as incomplete."
                     if part else "")
        accepted(res, ctx, region, len(res.facts) - before)


def _scope_key(scope: str) -> str:
    s = scope.lower()
    if "excluding m&a and crm" in s:
        return "excl_ma_crm"
    if "core" in s:
        return "core"
    return re.sub(r"[^a-z0-9]+", "_", s).strip("_") or "all"


def basic_columns(header: str, ncols: int):
    for n, must, mustnot, cols in BASIC_VARIANTS:
        if n == ncols and all(re.search(w, header) for w in must) and not any(re.search(w, header) for w in mustnot):
            return cols
    return None


# ------------------------------------------------------------------------------------------------ filings: categories

CATEGORY_GROUPS = [("filings", "Class Action Filings", "filings"), ("ddl_total", "Disclosure Dollar Loss", "usd_billions"),
                   ("mdl_total", "Maximum Dollar Loss", "usd_billions")]


def extract_category_table(res: Result, ctx: dict, cap: re.Pattern, dim: str, key_prefix: str) -> None:
    for region in [r for r in T.regions(ctx["pages"], cap) if r.rows]:
        rows = [r for r in region.rows if r.label]
        counts = {len(r.cells) for r in rows}
        if len(counts) != 1:
            held(res, ctx, region, f"rows have different numbers of values {sorted(counts)}")
            continue
        ncols = counts.pop()
        def shape_ok(ps):
            st = [i for i, p in enumerate(ps) if p[1] == "range"]
            return len(st) == 3 and st[0] == 0

        periods, heads = None, [""] * ncols
        for cand in (T.stacked_headers(region, ncols), T.column_headers(region, ncols)):
            if cand:
                pp = [header_periods(h) for h in cand]
                if all(len(x) == 1 for x in pp) and shape_ok([x[0] for x in pp]):
                    periods, heads = [x[0] for x in pp], cand
                    break
        if periods is None:
            lin = header_periods(region.header)
            periods = lin if len(lin) == ncols and shape_ok(lin) else None
        groups = [g for g in CATEGORY_GROUPS if re.search(g[1], region.header)]
        starts = [i for i, p in enumerate(periods or []) if p[1] == "range"]
        if periods is None or len(groups) != 3 or len(starts) != 3 or starts[0] != 0:
            held(res, ctx, region, f"column periods or groups not recognised for {ncols} values")
            continue
        bounds = starts + [ncols]
        group_of = [next(g for g in range(3) if bounds[g] <= i < bounds[g + 1]) for i in range(ncols)]
        total = next((r for r in rows if r.label.lower() == "total"), None)
        body = [r for r in rows if r is not total]
        if total:
            exact = [group_of[i] == 0 and periods[i][1] != "range" for i in range(ncols)]
            bad = sums_ok([r.cells for r in body], total.cells, exact)
            if bad:
                held(res, ctx, region, "Total row does not match: " + "; ".join(bad[:4]))
                continue
        before = len(res.facts)
        for r in rows:
            for i, cell in enumerate(r.cells):
                gk, glabel, unit = groups[group_of[i]]
                period, ptype = periods[i]
                semi = "semiannual" in heads[i].lower() or "H" in period or any(p[1] == "half" for p in periods)
                agg = ("semiannual average" if semi else "annual average") if ptype == "range" else ""
                label = {"filings": "Core filings", "ddl_total": "Disclosure Dollar Loss (total)",
                         "mdl_total": "Maximum Dollar Loss (total)"}[gk] + f" by {dim.lower()}"
                emit(res, ctx, region, series_key=f"{key_prefix}.{gk}", label=label, unit=unit, period=period, ptype=ptype,
                     aggregate=agg, cell=cell, dimension=f"{dim}: {r.label}", row_label=r.label,
                     column_label=f"{glabel}, {period}{' average' if ptype == 'range' else ''}",
                     basis_text=region.header + " " + region.notes)
        accepted(res, ctx, region, len(res.facts) - before)


SP_SECTORS = ["Consumer Discretionary", "Consumer Staples", "Energy/Materials", "Financials/Real Estate", "Health Care",
              "Industrials", "Telecomm./Comm./IT", "Utilities", "All S&P 500 Companies"]


SP_KEYS = [("Discretionary", "Consumer Discretionary"), ("Staples", "Consumer Staples"), ("Materials", "Energy/Materials"),
           ("Real Estate", "Financials/Real Estate"), ("Care", "Health Care"), ("Industrials", "Industrials"),
           ("IT", "Telecomm./Comm./IT"), ("Utilities", "Utilities"), ("Companies", "All S&P 500 Companies")]


def sp_columns(region: T.Region) -> list[str]:
    """Sector of each of the nine value columns, read from the header text above it; [] unless one-to-one."""
    for heads in (T.column_headers(region, 9), T.stacked_headers(region, 9)):
        if not heads:
            continue
        names = []
        for h in heads:
            hit = [name for k, name in SP_KEYS if re.search(rf"\b{re.escape(k)}\b", h)]
            names.append(hit[0] if len(hit) == 1 else "")
        if all(names) and len(set(names)) == 9:
            return names
    return []


def extract_sp500(res: Result, ctx: dict) -> None:
    caps = [(re.compile(r"Appendix \d+A: (S&P 500 Securities Litigation—)?Percentage of S&P 500 Companies"), "filings.sp500_companies_sued_pct",
             "Share of S&P 500 companies subject to core federal filings"),
            (re.compile(r"Appendix \d+B: (S&P 500 Securities Litigation—)?Percentage of Market Capitalization"), "filings.sp500_mktcap_sued_pct",
             "Share of S&P 500 market capitalization subject to core federal filings")]
    for cap, key, label in caps:
        for region in [r for r in T.regions(ctx["pages"], cap, year_rows=True) if len(r.rows) > 5]:
            data = [r for r in region.rows if row_period(r.label)]
            counts = {len(r.cells) for r in data}
            names = sp_columns(region) if counts == {9} else []
            if counts != {9} or len(names) != 9:
                held(res, ctx, region, f"sector columns not recognised (values {sorted(counts)}, sectors {len(names)})")
                continue
            before = len(res.facts)
            for r in data:
                period, ptype, agg = row_period(r.label)
                for name, cell in zip(names, r.cells):
                    emit(res, ctx, region, series_key=key, label=label, unit="percent", period=period, ptype=ptype, aggregate=agg,
                         cell=cell, dimension=f"Sector: {name}", row_label=r.label, column_label=name, basis_text="")
            accepted(res, ctx, region, len(res.facts) - before)


def extract_filings(res: Result, ctx: dict) -> None:
    extract_filings_summary(res, ctx)
    extract_year_table(res, ctx, re.compile(r"(Appendix|APPENDIX) 1: (Basic Filings|Filings Basic|BASIC FILINGS|FILINGS BASIC) (Metrics|METRICS)"),
                       basic_columns)
    extract_year_table(res, ctx, re.compile(r"(Appendix|APPENDIX) \d+: M&A (Federal )?(Filings|FILINGS) (Overview|OVERVIEW)"), ma_columns)
    extract_year_table(res, ctx, re.compile(r"(Appendix|APPENDIX) \d+: (Case )?(Status|STATUS) (by|BY) (Year|YEAR)|CASE STATUS BY YEAR—"),
                       status_columns, label_for_scope=True)
    extract_category_table(res, ctx, re.compile(r"(Appendix|APPENDIX) \d+: (Filings by Industry|FILINGS BY INDUSTRY)"), "Industry",
                           "filings.by_industry")
    extract_category_table(res, ctx, re.compile(r"(Appendix|APPENDIX) \d+: (Filings by Circuit|FILINGS BY CIRCUIT)"), "Circuit",
                           "filings.by_circuit")
    extract_sp500(res, ctx)


# ------------------------------------------------------------------------------------------------ settlements

SETTLEMENT_ROWS = [
    (r"^Number of Settlements", "settlements.count", "Number of settlements", "settlements"),
    (r"^Total( Amount)?$", "settlements.total", "Total settlement dollars", "usd"),
    (r"^Minimum$", "settlements.minimum", "Smallest settlement", "usd"),
    (r"^Median$", "settlements.median", "Median settlement", "usd"),
    (r"^Average$", "settlements.average", "Average settlement", "usd"),
    (r"^Maximum$", "settlements.maximum", "Largest settlement", "usd"),
]


def tail_match(label: str, rowmap):
    """The row spec whose name the label ends with (text from a neighbouring column can precede a row label in the text
    layer: "Even excluding the  Median"); returns (spec, the matched printed label) or None. Ambiguity is None."""
    words = label.split()
    for k in range(len(words)):
        tail = " ".join(words[k:])
        hit = [m for m in rowmap if re.search(m[0], tail)]
        if len(hit) == 1:
            return hit[0], tail
        if len(hit) > 1:
            return None
    return None


def _metric_rows(region: T.Region, rowmap) -> list[tuple[T.Row, tuple]]:
    out = []
    for r in region.rows:
        tm = tail_match(r.label, rowmap)
        if tm:
            r.label = tm[1]
            out.append((r, tm[0]))
    return out


def _flag_rejected(res: Result, ctx: dict, region: T.Region, rowmap) -> None:
    for line in region.rejected:
        if any(re.search(m[0].replace("$", ""), line) for m in rowmap) and "$" in line:
            res.issues.append(Issue(ctx["id"], region.caption, region.page, f"row not readable as printed, left out: {line[:120]}"))


def extract_settlement_summary(res: Result, ctx: dict) -> None:
    cap = re.compile(r"Settlement Statistics|SETTLEMENT STATISTICS|SETTLEMENT SUMMARY STATISTICS|Settlement Summary Statistics")
    for region in T.regions(ctx["pages"], cap):
        rows = _metric_rows(region, SETTLEMENT_ROWS)
        _flag_rejected(res, ctx, region, SETTLEMENT_ROWS)
        if not rows:
            continue
        counts = {len(r.cells) for r, _ in rows}
        if len(counts) != 1:
            held(res, ctx, region, f"rows have different numbers of values {sorted(counts)}")
            continue
        n = counts.pop()
        periods = header_periods(region.header)
        for cand in (T.stacked_headers(region, n), T.column_headers(region, n)):
            if cand:
                pp = [header_periods(h) for h in cand]
                if all(len(x) == 1 for x in pp):
                    periods = [x[0] for x in pp]
                    break
        if len(periods) != n:
            held(res, ctx, region, f"header prints {len(periods)} periods for {n} values")
            continue
        excl = bool(re.search(r"[Ss]tatistics exclude", region.notes))
        before = len(res.facts)
        for r, (_, key, label, unit) in rows:
            for (period, ptype), cell in zip(periods, r.cells):
                agg = ("all settlements through the period, as printed" if period.startswith("through")
                       else "all settlements in the period") if ptype == "range" else ""
                emit(res, ctx, region, series_key=key, label=label, unit=unit, period=period, ptype=ptype, aggregate=agg, cell=cell,
                     dimension="", row_label=r.label, column_label=period, basis_text=region.header + " " + region.notes,
                     note="The table's note says some settlements are excluded from these statistics; see the report." if excl else "")
        accepted(res, ctx, region, len(res.facts) - before)
        return


PCT_COLS = [("settlements.percentile.average", "Average settlement"), ("settlements.percentile.p10", "10th percentile settlement"),
            ("settlements.percentile.p25", "25th percentile settlement"), ("settlements.percentile.median", "Median settlement"),
            ("settlements.percentile.p75", "75th percentile settlement"), ("settlements.percentile.p90", "90th percentile settlement")]


def extract_settlement_percentiles(res: Result, ctx: dict) -> None:
    cap = re.compile(r"Appendix \d+: Settlement Percentiles")
    for region in [r for r in T.regions(ctx["pages"], cap, year_rows=True) if r.rows]:
        words = re.findall(r"\b(Average|10th|25th|Median|75th|90th)\b", region.header)
        if words != ["Average", "10th", "25th", "Median", "75th", "90th"]:
            held(res, ctx, region, "percentile columns not as expected")
            continue
        before = len(res.facts)
        for r in region.rows:
            rp = row_period(r.label)
            m = RANGE.fullmatch(r.label.strip())
            if rp is None and m:
                rp = (norm_period(m.group(1), m.group(2), m.group(3), m.group(4))[0], "range", "all settlements in the period")
            if rp is None or len(r.cells) != 6:
                if len(r.cells) != 6:
                    held(res, ctx, region, f"row {r.label!r} has {len(r.cells)} values")
                continue
            for (key, label), cell in zip(PCT_COLS, r.cells):
                emit(res, ctx, region, series_key=key, label=label, unit="usd_millions", period=rp[0], ptype=rp[1], aggregate=rp[2],
                     cell=cell, dimension="", row_label=r.label, column_label=label, basis_text=region.header + " " + region.notes)
        accepted(res, ctx, region, len(res.facts) - before)


def _measure(text: str) -> tuple[str, str] | None:
    t = text.replace("“", '"').replace("”", '"')
    for rx, key, label in ((r"Plaintiff-Style", "plaintiff_style", "plaintiff-style damages"),
                           (r"Simplified Tiered", "simplified_tiered", '"simplified tiered damages"'),
                           (r"Simplified Statutory|Statutory", "statutory", "statutory damages"),
                           (r"Estimated Damages", "estimated", '"estimated damages"')):
        if re.search(rx, t):
            return key, label
    return None


def extract_settlement_categories(res: Result, ctx: dict) -> None:
    specs = [(re.compile(r"Appendix \d+: (Settlements by (Select )?Industry Sectors)"), "Industry", "settlements.by_industry"),
             (re.compile(r"Appendix \d+: (Settlements by Federal Circuit Court|Settlement Statistics by Federal Circuit Court)"), "Circuit",
              "settlements.by_circuit"),
             (re.compile(r"Appendix \d+: Settlements by Nature of Claim"), "Claims", "settlements.by_claim")]
    for cap, dim, prefix in specs:
        for region in [r for r in T.regions(ctx["pages"], cap) if r.rows]:
            ranges = [p for p, t in header_periods(region.header) if t == "range"]
            if len(ranges) != 1:
                held(res, ctx, region, "the table's period is not printed once in its header")
                continue
            period = ranges[0]
            page_lines = ctx["pages"][region.page - 1].splitlines()
            before = len(res.facts)
            for r in region.rows:
                # the header that applies to a row is the nearest header text above it (a table may restate its header)
                above = " ".join(ln for ln in page_lines[: r.line] if re.search(r"Median|Number of|Settlements|Damages", ln))
                ms = _measure(above[-400:])
                n = len(r.cells)
                hdr = above[-400:]
                if n == 3 and ms:
                    cols = [("count", "Number of settlements", "settlements"), ("median", "Median settlement", "usd_millions"),
                            (f"median_pct_damages.{ms[0]}", f"Median settlement as a percentage of {ms[1]}", "percent")]
                elif n == 4 and ms and "Docket" in hdr:
                    cols = [("count", "Number of settlements", "settlements"), ("median", "Median settlement", "usd_millions"),
                            ("median_docket_entries", "Median docket entries", "docket entries"),
                            (f"median_pct_damages.{ms[0]}", f"Median settlement as a percentage of {ms[1]}", "percent")]
                elif n == 4 and ms:
                    cols = [("count", "Number of settlements", "settlements"), ("median", "Median settlement", "usd_millions"),
                            (f"median_damages.{ms[0]}", f"Median {ms[1]}", "usd_millions"),
                            (f"median_pct_damages.{ms[0]}", f"Median settlement as a percentage of {ms[1]}", "percent")]
                else:
                    held(res, ctx, region, f"row {r.label!r}: {n} values and no recognised column layout")
                    continue
                for (k, label, unit), cell in zip(cols, r.cells):
                    emit(res, ctx, region, series_key=f"{prefix}.{k}", label=f"{label} by {dim.lower()}", unit=unit, period=period,
                         ptype="range", aggregate="all settlements in the period", cell=cell, dimension=f"{dim}: {r.label}",
                         row_label=r.label, column_label=label, basis_text=region.header + " " + region.notes)
            accepted(res, ctx, region, len(res.facts) - before)


def extract_settlements(res: Result, ctx: dict) -> None:
    extract_settlement_summary(res, ctx)
    extract_settlement_percentiles(res, ctx)
    extract_settlement_categories(res, ctx)


# ------------------------------------------------------------------------------------------------ accounting

ACCOUNTING_ROWS = [
    (r"^(Total )?Number of Filings", "accounting.filings", "Accounting case filings", "filings"),
    (r"^Total Number of Traditional Filings", "accounting.traditional_filings", "Traditional filings", "filings"),
    (r"^Total Number of Core Filings", "accounting.core_filings", "Core filings", "filings"),
    (r"^Total Disclosure (Dollar Loss|Dollar Losses)", "accounting.ddl_total", "Disclosure Dollar Loss (total)", "usd"),
    (r"^Number of Settlements", "accounting.settlements", "Number of settlements", "settlements"),
    (r"^Median Settlement", "accounting.settlement_median", "Median settlement", "usd"),
    (r"^Average Settlement", "accounting.settlement_average", "Average settlement", "usd"),
    (r"^Total Settlement Value", "accounting.settlement_total", "Total settlement dollars", "usd"),
]


def extract_accounting_summary(res: Result, ctx: dict) -> None:
    cap = re.compile(r"(FIGURE|Figure) 1: (SUMMARY STATISTICS|FILINGS AND SETTLEMENTS SUMMARY STATISTICS|Filings and Settlements Summary Statistics|"
                     r"Accounting Filings and Settlements Summary Statistics)")
    for region in T.regions(ctx["pages"], cap):
        rows = _metric_rows(region, ACCOUNTING_ROWS)
        if not rows:
            continue
        counts = {len(r.cells) for r, _ in rows}
        if len(counts) != 1:
            held(res, ctx, region, f"rows have different numbers of values {sorted(counts)}")
            continue
        n = counts.pop()
        hdr = region.header
        if "Non-Accounting" in hdr:
            singles = [p for p, t in header_periods(hdr) if t == "year"]
            if n == 2 and len(singles) == 1:
                singles = singles * 2
            if n == 2 and not singles:
                yr = re.search(r"(\d{4}) Filings Summary", " ".join(ctx["pages"][region.page - 1].splitlines()))
                singles = [yr.group(1)] * 2 if yr else []
            if len(singles) != n or n % 2:
                held(res, ctx, region, f"{len(singles)} periods printed for {n} values")
                continue
            half = n // 2
            cols = [("Case type: Accounting cases", singles[i], "year", "") for i in range(half)] + \
                   [("Case type: Non-accounting cases", singles[i], "year", "") for i in range(half, n)]
        else:
            periods = header_periods(hdr)
            ranges = [p for p, t in periods if t == "range"]
            singles = [p for p, t in periods if t != "range"]
            stats = []
            if re.search(r"Minimum\s.*by Year|Minimum by Year|Minimum", hdr):
                stats.append("minimum by year")
            if re.search(r"Maximum", hdr):
                stats.append("maximum by year")
            if re.search(r"Average", hdr):
                stats.append("annual average")
            if len(ranges) != 1 or len(stats) + len(singles) != n:
                held(res, ctx, region, "header columns not recognised")
                continue
            cols = [("Case type: Accounting cases", ranges[0], "range", s) for s in stats] + \
                   [("Case type: Accounting cases", p, "year", "") for p in singles]
        before = len(res.facts)
        for r, (_, key, label, unit) in rows:
            for (dim, period, ptype, agg), cell in zip(cols, r.cells):
                if re.search(r"\(\d\)$", cell):
                    res.issues.append(Issue(ctx["id"], region.caption, region.page,
                                            f"{r.label} {period} {agg}: value carries a footnote that redefines the column; left out"))
                    continue
                emit(res, ctx, region, series_key=key, label=label, unit=unit, period=period, ptype=ptype, aggregate=agg, cell=cell,
                     dimension=dim, row_label=r.label, column_label=f"{dim.split(': ')[1]}, {period}{' ' + agg if agg else ''}",
                     basis_text=region.header + " " + region.notes)
        accepted(res, ctx, region, len(res.facts) - before)
        return


def extract_accounting(res: Result, ctx: dict) -> None:
    extract_accounting_summary(res, ctx)
