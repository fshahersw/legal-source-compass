"""ACS 2020-2024 5-year measures from the table-based summary file, with margins of error.

Each measure names its cells by the labels in the ACS table shells; the builder checks every label before using a cell, so
a changed table layout stops the build instead of producing a wrong number. Derived proportions use the Census Bureau's
approximation for the MOE of a proportion (ACS Handbook, "Calculating Measures of Error for Derived Estimates"):
MOE(p) = sqrt(MOE(num)^2 - p^2 * MOE(den)^2) / den, falling back to the ratio formula (with +) when the radicand is negative.
Sums of cells use MOE = sqrt(sum of squared MOEs).
"""
from __future__ import annotations

import math
import os

import sa_sources as S

ACS_DIR_URL = "https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/"
SHELLS_URL = "https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/documentation/ACS20245YR_Table_Shells.txt"
VINTAGE = "ACS 2020-2024 5-year"

UNDER18 = ["Under 5 years", "5 to 9 years", "10 to 14 years", "15 to 17 years"]
OVER65 = ["65 and 66 years", "67 to 69 years", "70 to 74 years", "75 to 79 years", "80 to 84 years", "85 years and over"]
BACHELORS = ["Bachelor's degree", "Master's degree", "Professional school degree", "Doctorate degree"]

# key -> (label, unit, format, kind, spec)
#   kind "value": spec = (table, cell label)        published estimate (median, total)
#   kind "share": spec = (table, [numerator labels], denominator label) percent of the universe
MEASURES: dict[str, tuple] = {
    "pop_acs": ("Population (ACS 5-year)", "people", "int", "value", ("B01003", "Total")),
    "median_age": ("Median age", "years", "dec1", "value", ("B01002", "Total:")),
    "pct_under18": ("Under 18", "% of residents", "pct", "share", ("B01001", UNDER18, "Total:")),
    "pct_65plus": ("Aged 65 and over", "% of residents", "pct", "share", ("B01001", OVER65, "Total:")),
    "pct_hispanic": ("Hispanic or Latino (any race)", "% of residents", "pct", "share", ("B03002", ["Hispanic or Latino:"], "Total:")),
    "pct_white_nh": ("White alone, not Hispanic", "% of residents", "pct", "share", ("B03002", ["White alone@1"], "Total:")),
    "pct_black_nh": ("Black alone, not Hispanic", "% of residents", "pct", "share", ("B03002", ["Black or African American alone@1"], "Total:")),
    "pct_asian_nh": ("Asian alone, not Hispanic", "% of residents", "pct", "share", ("B03002", ["Asian alone@1"], "Total:")),
    "pct_foreign_born": ("Foreign-born", "% of residents", "pct", "share", ("B05012", ["Foreign-born"], "Total:")),
    "median_hh_income": ("Median household income", "2024 dollars", "dollars", "value", ("B19013", "Median household income in the past 12 months (in 2024 inflation-adjusted dollars)")),
    "per_capita_income": ("Per capita income (ACS)", "2024 dollars", "dollars", "value", ("B19301", "Per capita income in the past 12 months (in 2024 inflation-adjusted dollars)")),
    "poverty_rate": ("Below the poverty level", "% of people for whom poverty status is determined", "pct", "share", ("C17002", ["Under .50", ".50 to .99"], "Total:")),
    "pct_bachelors": ("Bachelor's degree or higher", "% of residents 25 and over", "pct", "share", ("B15003", BACHELORS, "Total:")),
    "pct_uninsured": ("No health insurance", "% of civilian noninstitutionalized residents", "pct", "share", ("B27001", ["No health insurance coverage*"], "Total:")),
    "unemployment_acs": ("Unemployed (ACS)", "% of the civilian labor force", "pct", "share", ("B23025", ["Unemployed"], "Civilian labor force:")),
    "owner_occupied": ("Owner-occupied homes", "% of occupied housing units", "pct", "share", ("B25003", ["Owner occupied"], "Total:")),
    "median_home_value": ("Median home value", "2024 dollars", "dollars", "value", ("B25077", "Median value (dollars)")),
    "median_rent": ("Median gross rent", "2024 dollars a month", "dollars", "value", ("B25064", "Median gross rent")),
}
TABLES = sorted({spec[0] for _, _, _, _, spec in MEASURES.values()})


def resolve_cells(shells: dict[str, str]) -> dict[str, dict]:
    """Measure -> {'num': [cell ids], 'den': cell id} or {'value': cell id}, located by shell labels.

    A label ending in '@1' means the first matching cell in table order (B03002 repeats race labels under 'Not Hispanic' and
    'Hispanic'); a label ending in '*' means every cell with that label (B27001 repeats 'No health insurance coverage' by age
    and sex). Every other label must occur exactly once in the table.
    """
    out: dict[str, dict] = {}
    for key, (_, _, _, kind, spec) in MEASURES.items():
        table = spec[0]
        cells = sorted((cid, lab) for cid, lab in shells.items() if cid.startswith(table + "_"))
        if not cells:
            raise SystemExit(f"{key}: table {table} not in the shells")

        def find(label: str) -> list[str]:
            if label.endswith("*"):
                hits = [cid for cid, lab in cells if lab == label[:-1]]
                if not hits:
                    raise SystemExit(f"{key}: no cell labelled {label!r} in {table}")
                return hits
            if label.endswith("@1"):
                hits = [cid for cid, lab in cells if lab == label[:-2]]
                if not hits:
                    raise SystemExit(f"{key}: no cell labelled {label!r} in {table}")
                return hits[:1]
            hits = [cid for cid, lab in cells if lab == label]
            if len(hits) != 1:
                if label in UNDER18 + OVER65:  # male and female blocks of B01001: both are wanted
                    return hits
                raise SystemExit(f"{key}: label {label!r} occurs {len(hits)} times in {table}")
            return hits

        if kind == "value":
            out[key] = {"value": find(spec[1])[0]}
        else:
            num: list[str] = []
            for lab in spec[1]:
                num += find(lab)
            out[key] = {"num": num, "den": find(spec[2])[0]}
    return out


def col(cell_id: str, kind: str) -> str:
    table, line = cell_id.split("_")
    return f"{table}_{kind}{line}"


def load(acq_dir: str) -> tuple[dict[str, dict[str, float | None]], dict[str, dict], dict[str, str]]:
    """GEO_ID -> merged row of all tables; the resolved cells; the shells."""
    shells = S.read_shells(os.path.join(acq_dir, "census", "ACS20245YR_Table_Shells.txt"))
    cells = resolve_cells(shells)
    merged: dict[str, dict[str, float | None]] = {}
    for t in TABLES:
        rows = S.read_acs(os.path.join(acq_dir, "census", "acs5y2024", f"acsdt5y2024-{t.lower()}.subset.dat.gz"))
        for geo, row in rows.items():
            merged.setdefault(geo, {}).update(row)
    return merged, cells, shells


def measure(row: dict[str, float | None], cells: dict[str, dict], key: str) -> tuple[float | None, float | None]:
    """(estimate, MOE) for one measure in one geography; shares in percent."""
    spec = cells[key]
    if "value" in spec:
        return row.get(col(spec["value"], "E")), row.get(col(spec["value"], "M"))
    nums = [row.get(col(c, "E")) for c in spec["num"]]
    nmoes = [row.get(col(c, "M")) for c in spec["num"]]
    den, dmoe = row.get(col(spec["den"], "E")), row.get(col(spec["den"], "M"))
    if any(v is None for v in nums) or den is None or den <= 0:
        return None, None
    num = sum(nums)  # type: ignore[arg-type]
    p = num / den
    moe = None
    if all(m is not None for m in nmoes) and dmoe is not None:
        mnum = math.sqrt(sum(m * m for m in nmoes))  # type: ignore[operator]
        rad = mnum * mnum - p * p * dmoe * dmoe
        if rad < 0:
            rad = mnum * mnum + p * p * dmoe * dmoe
        moe = math.sqrt(rad) / den * 100
    return p * 100, moe


def profile(row: dict[str, float | None], cells: dict[str, dict]) -> dict[str, dict]:
    out = {}
    for key in MEASURES:
        v, m = measure(row, cells, key)
        out[key] = {"v": None if v is None else round(v, 2 if MEASURES[key][2] in ("pct", "dec1") else 0), "moe": None if m is None else round(m, 2 if MEASURES[key][2] in ("pct", "dec1") else 0)}
    return out


def counts(row: dict[str, float | None], cells: dict[str, dict], key: str) -> tuple[float | None, float | None]:
    """(numerator, denominator) counts of a share measure, for exact aggregation over counties."""
    spec = cells[key]
    nums = [row.get(col(c, "E")) for c in spec["num"]]
    den = row.get(col(spec["den"], "E"))
    if any(v is None for v in nums) or den is None:
        return None, None
    return float(sum(nums)), float(den)  # type: ignore[arg-type]
