"""What the Census datasets measure: tables, cells, label checks and the arithmetic that turns cells into figures.

Everything here is pure (no network): the acquisition script requests the cells listed in ``CELLS``, the builder turns the
responses into measures with ``compute_measure``, and the tests exercise both with synthetic responses.

ACS cells are addressed by table and line (``B23025_005``). Before a vintage is used, the label of every cell, taken from
the Census Bureau's own group metadata for that vintage, is compared with the label this module expects; a changed table
layout drops that measure for that vintage (reported), it never produces a number from a cell that means something else.

Derived percentages follow the Census Bureau's ACS handbook ("Calculating Measures of Error for Derived Estimates"):
  * a sum or difference of cells has MOE = sqrt(sum of squared MOEs);
  * a proportion p = num / den whose numerator is part of the denominator has
    MOE(p) = sqrt(MOE(num)^2 - p^2 * MOE(den)^2) / den, and when the radicand is negative the ratio form
    sqrt(MOE(num)^2 + p^2 * MOE(den)^2) / den is used instead;
  * an estimate flagged -555555555 is controlled to an independent estimate and its MOE is treated as zero.
"""
from __future__ import annotations

import math
import re
from dataclasses import dataclass, field

# --- Census sentinel values (https://www.census.gov/data/developers/data-sets/acs-1year/notes-on-acs-estimate-and-annotation-values.html)
CONTROLLED = -555555555  # MOE: estimate controlled to an independent estimate; MOE may be treated as zero
ESTIMATE_SENTINELS = {
    -666666666: "insufficient sample observations to compute the estimate",
    -999999999: "insufficient sample cases in the geographic area",
    -888888888: "not applicable or not available",
}
MOE_SENTINELS = {
    -222222222: "margin of error could not be computed (insufficient sample observations)",
    -333333333: "margin of error could not be computed (median in an open-ended interval)",
    CONTROLLED: "controlled estimate; no sampling error",
}

# Vintages (end year of the period for 5-year estimates; the survey year for 1-year estimates).
ACS5_YEARS = list(range(2013, 2025))
ACS1_YEARS = [y for y in range(2013, 2025) if y != 2020]  # no standard 2020 1-year release exists


def norm_label(label: str) -> str:
    """Estimate label -> '|'-joined path without the 'Estimate' prefix, trailing colons or ' --' decoration."""
    parts = [p for p in label.split("!!") if p != "Estimate"]
    cleaned = []
    for part in parts:
        part = part.strip().rstrip(":").strip()
        part = part.replace(" --", "")
        part = re.sub(r"\bin \d{4} [Ii]nflation-adjusted", "in YYYY inflation-adjusted", part)
        cleaned.append(part)
    return "|".join(cleaned)


def _age_cells(table: str, lines: dict[int, str], sex: str) -> dict[str, str]:
    return {f"{table}_{n:03d}": f"^Total\\|{sex}\\|{re.escape(text)}$" for n, text in lines.items()}


_MALE_UNDER18 = {3: "Under 5 years", 4: "5 to 9 years", 5: "10 to 14 years", 6: "15 to 17 years"}
_FEMALE_UNDER18 = {27: "Under 5 years", 28: "5 to 9 years", 29: "10 to 14 years", 30: "15 to 17 years"}
_MALE_65 = {20: "65 and 66 years", 21: "67 to 69 years", 22: "70 to 74 years", 23: "75 to 79 years", 24: "80 to 84 years", 25: "85 years and over"}
_FEMALE_65 = {44: "65 and 66 years", 45: "67 to 69 years", 46: "70 to 74 years", 47: "75 to 79 years", 48: "80 to 84 years", 49: "85 years and over"}
_DISABILITY_LEAVES = [4, 7, 10, 13, 16, 19, 23, 26, 29, 32, 35, 38]

# cell id -> regex the normalised label path must match in every vintage that uses the cell
CELLS: dict[str, str] = {
    "B01003_001": r"^Total$",
    "B01002_001": r"^Median age\|Total$",
    "B19013_001": r"^Median household income in the past 12 months \(in YYYY inflation-adjusted dollars\)$",
    "B19301_001": r"^Per capita income in the past 12 months \(in YYYY inflation-adjusted dollars\)$",
    "B25077_001": r"^Median value \(dollars\)$",
    "B17001_001": r"^Total$",
    "B17001_002": r"^Total\|Income in the past 12 months below poverty level$",
    "B23025_001": r"^Total$",
    "B23025_002": r"^Total\|In labor force$",
    "B23025_003": r"^Total\|In labor force\|Civilian labor force$",
    "B23025_005": r"^Total\|In labor force\|Civilian labor force\|Unemployed$",
    "B27010_001": r"^Total$",
    "B15003_001": r"^Total$",
    "B15003_022": r"^Total\|Bachelor's degree$",
    "B15003_023": r"^Total\|Master's degree$",
    "B15003_024": r"^Total\|Professional school degree$",
    "B15003_025": r"^Total\|Doctorate degree$",
    "B21001_001": r"^Total$",
    "B21001_002": r"^Total\|Veteran$",
    "B25003_001": r"^Total$",
    "B25003_002": r"^Total\|Owner occupied$",
    "B28002_001": r"^Total$",
    "B28002_004": r"^Total\|With an Internet subscription\|Broadband of any type$",
    "B06007_001": r"^Total$",
    "B06007_002": r"^Total\|Speak only English$",
    "B01001_001": r"^Total$",
    "B03002_001": r"^Total$",
    "B03002_003": r"^Total\|Not Hispanic or Latino\|White alone$",
    "B03002_004": r"^Total\|Not Hispanic or Latino\|Black or African American alone$",
    "B03002_005": r"^Total\|Not Hispanic or Latino\|American Indian and Alaska Native alone$",
    "B03002_006": r"^Total\|Not Hispanic or Latino\|Asian alone$",
    "B03002_007": r"^Total\|Not Hispanic or Latino\|Native Hawaiian and Other Pacific Islander alone$",
    "B03002_008": r"^Total\|Not Hispanic or Latino\|Some other race alone$",
    "B03002_009": r"^Total\|Not Hispanic or Latino\|Two or more races$",
    "B03002_012": r"^Total\|Hispanic or Latino$",
    "B18101_001": r"^Total$",
}
for _line in (17, 33, 50, 66):  # B27010: "No health insurance coverage" under each age group
    CELLS[f"B27010_{_line:03d}"] = r"^Total\|[^|]+\|No health insurance coverage$"
for _line in _DISABILITY_LEAVES:
    CELLS[f"B18101_{_line:03d}"] = r"^Total\|(Male|Female)\|[^|]+\|With a disability$"
CELLS.update(_age_cells("B01001", _MALE_UNDER18, "Male"))
CELLS.update(_age_cells("B01001", _FEMALE_UNDER18, "Female"))
CELLS.update(_age_cells("B01001", _MALE_65, "Male"))
CELLS.update(_age_cells("B01001", _FEMALE_65, "Female"))

# Tables that exist only from some vintage on: (survey, table) -> first vintage. The 5-year B28002 starts with the
# 2013-2017 release (the "2017" vintage); the 1-year B28002 has a different layout (no "Broadband of any type" line)
# before 2016. A table missing, or laid out differently, in any other vintage is an error, not a quiet gap.
FIRST_YEAR: dict[tuple[str, str], int] = {("acs5", "B28002"): 2017, ("acs1", "B28002"): 2016}

UNDER18_CELLS = [f"B01001_{n:03d}" for n in (*_MALE_UNDER18, *_FEMALE_UNDER18)]
OVER65_CELLS = [f"B01001_{n:03d}" for n in (*_MALE_65, *_FEMALE_65)]
DISABILITY_CELLS = [f"B18101_{n:03d}" for n in _DISABILITY_LEAVES]
UNINSURED_CELLS = [f"B27010_{n:03d}" for n in (17, 33, 50, 66)]
BACHELORS_CELLS = [f"B15003_{n:03d}" for n in (22, 23, 24, 25)]


@dataclass(frozen=True)
class Measure:
    """One published figure: a single cell (``kind`` value) or a percentage of a universe (``kind`` share)."""

    key: str
    label: str
    unit: str
    fmt: str  # int | dollars | dec1 | pct
    group: str
    kind: str  # value | share
    plus: tuple[str, ...]  # cells added (numerator, or the value cell)
    minus: tuple[str, ...] = ()  # cells subtracted from the numerator
    den: str | None = None  # denominator cell for shares
    universe: str = ""
    note: str = ""

    @property
    def cells(self) -> list[str]:
        out = list(self.plus) + list(self.minus)
        if self.den:
            out.append(self.den)
        return out

    @property
    def table(self) -> str:
        return self.plus[0].split("_")[0]

    def definition(self) -> dict:
        d = {
            "key": self.key,
            "label": self.label,
            "unit": self.unit,
            "format": self.fmt,
            "group": self.group,
            "kind": self.kind,
            "table": self.table,
            "cells": list(self.plus),
        }
        if self.minus:
            d["cells_subtracted"] = list(self.minus)
        if self.den:
            d["denominator_cell"] = self.den
        if self.universe:
            d["universe"] = self.universe
        if self.note:
            d["note"] = self.note
        return d


def _share(key, label, plus, den, universe, group, note="", minus=()):
    return Measure(key, label, "% of " + universe, "pct", group, "share", tuple(plus), tuple(minus), den, universe, note)


MEASURES: list[Measure] = [
    Measure("pop", "Total population", "people", "int", "People", "value", ("B01003_001",), universe="total population"),
    Measure("median_age", "Median age", "years", "dec1", "People", "value", ("B01002_001",)),
    _share("age_under18", "Under 18", UNDER18_CELLS, "B01001_001", "total population", "People"),
    _share("age_65plus", "Aged 65 and over", OVER65_CELLS, "B01001_001", "total population", "People"),
    _share("hispanic", "Hispanic or Latino (of any race)", ["B03002_012"], "B03002_001", "total population", "People"),
    _share("white_nh", "White alone, not Hispanic or Latino", ["B03002_003"], "B03002_001", "total population", "People"),
    _share("black_nh", "Black or African American alone, not Hispanic or Latino", ["B03002_004"], "B03002_001", "total population", "People"),
    _share("aian_nh", "American Indian and Alaska Native alone, not Hispanic or Latino", ["B03002_005"], "B03002_001", "total population", "People"),
    _share("asian_nh", "Asian alone, not Hispanic or Latino", ["B03002_006"], "B03002_001", "total population", "People"),
    _share("nhpi_nh", "Native Hawaiian and Other Pacific Islander alone, not Hispanic or Latino", ["B03002_007"], "B03002_001", "total population", "People"),
    _share("other_nh", "Some other race alone, not Hispanic or Latino", ["B03002_008"], "B03002_001", "total population", "People"),
    _share("two_plus_nh", "Two or more races, not Hispanic or Latino", ["B03002_009"], "B03002_001", "total population", "People"),
    _share("non_english", "Speak a language other than English at home", ["B06007_001"], "B06007_001", "population 5 years and over", "People",
           note="Population 5 and over minus those who speak only English (table B06007; B16001 is blank at county level from the 2016 release).", minus=["B06007_002"]),
    _share("veterans", "Veterans", ["B21001_002"], "B21001_001", "civilian population 18 years and over", "People"),
    _share("disability", "With a disability", DISABILITY_CELLS, "B18101_001", "civilian noninstitutionalized population", "People",
           note="Sum of the 'With a disability' cells by sex and age."),
    Measure("median_hh_income", "Median household income", "dollars (survey end year)", "dollars", "Economy", "value", ("B19013_001",),
            note="Inflation-adjusted to the last year of the period; releases are not adjusted to a common year."),
    Measure("per_capita_income", "Per capita income", "dollars (survey end year)", "dollars", "Economy", "value", ("B19301_001",),
            note="Inflation-adjusted to the last year of the period; releases are not adjusted to a common year."),
    _share("poverty_rate", "People below the poverty level", ["B17001_002"], "B17001_001", "people for whom poverty status is determined", "Economy"),
    _share("unemployment_rate", "Unemployment rate", ["B23025_005"], "B23025_003", "civilian labor force", "Economy",
           note="ACS survey estimate for the whole period; not the monthly BLS rate."),
    _share("lfpr", "Labor force participation", ["B23025_002"], "B23025_001", "population 16 years and over", "Economy"),
    _share("bachelors_plus", "Bachelor's degree or higher", BACHELORS_CELLS, "B15003_001", "population 25 years and over", "Economy"),
    _share("uninsured", "No health insurance coverage", UNINSURED_CELLS, "B27010_001", "civilian noninstitutionalized population", "Economy"),
    Measure("median_home_value", "Median home value", "dollars (survey end year)", "dollars", "Housing", "value", ("B25077_001",),
            universe="owner-occupied housing units", note="Owner-occupied housing units; value as reported by the owner."),
    _share("owner_occupied", "Owner-occupied housing units", ["B25003_002"], "B25003_001", "occupied housing units", "Housing"),
    _share("broadband", "Households with a broadband internet subscription", ["B28002_004"], "B28002_001", "households", "Housing",
           note="Broadband of any type; the 5-year tables begin with the 2013-2017 release."),
]
MEASURE_BY_KEY = {m.key: m for m in MEASURES}
ALL_CELLS: list[str] = sorted({c for m in MEASURES for c in m.cells})
assert all(c in CELLS for c in ALL_CELLS), sorted(set(ALL_CELLS) - set(CELLS))


def cells_for_year(year: int, survey: str = "acs5") -> list[str]:
    """Cells expected in a vintage (a table that has not started yet is left out)."""
    return [c for c in ALL_CELLS if FIRST_YEAR.get((survey, c.split("_")[0]), 0) <= year]


def api_variables(cells: list[str]) -> list[str]:
    """Estimate and margin-of-error variable names for the cells."""
    return [f"{c}{suffix}" for c in cells for suffix in ("E", "M")]


def batches(variables: list[str], size: int = 48) -> list[list[str]]:
    """Split variables into API requests (the API accepts at most 50 variables a request); E and M of a cell stay together."""
    out, current = [], []
    for variable in variables:
        if len(current) >= size:
            out.append(current)
            current = []
        current.append(variable)
    if current:
        out.append(current)
    return out


def check_layout(labels: dict[str, str], year: int, survey: str = "acs5") -> dict[str, str]:
    """Cells whose published label does not match the expected one (cell -> reason). Empty means the layout is as expected."""
    problems = {}
    for cell in cells_for_year(year, survey):
        label = labels.get(cell)
        if label is None:
            problems[cell] = "cell not in the vintage's table"
        elif not re.match(CELLS[cell], norm_label(label)):
            problems[cell] = f"label is {norm_label(label)!r}"
    return problems


def parse_number(raw) -> float | None:
    """API string/number -> float; None for JSON null or an empty string."""
    if raw is None or raw == "":
        return None
    try:
        return float(raw)
    except (TypeError, ValueError):
        return None


@dataclass
class Cell:
    """One ACS cell for one geography: estimate, margin of error and the sentinel that replaced either."""

    estimate: float | None
    moe: float | None
    estimate_flag: int | None = None
    moe_flag: int | None = None

    @property
    def moe_for_math(self) -> float | None:
        return 0.0 if self.moe_flag == CONTROLLED else self.moe


def read_cell(estimate_raw, moe_raw) -> Cell:
    e, m = parse_number(estimate_raw), parse_number(moe_raw)
    e_flag = int(e) if e is not None and int(e) in ESTIMATE_SENTINELS and e == int(e) else None
    m_flag = int(m) if m is not None and int(m) in MOE_SENTINELS and m == int(m) else None
    if e is not None and e <= -200000000 and e_flag is None:  # an unlisted sentinel must never become a number
        e_flag = int(e)
    if m is not None and m <= -200000000 and m_flag is None:
        m_flag = int(m)
    return Cell(None if e_flag is not None else e, None if m_flag is not None else m, e_flag, m_flag)


@dataclass
class Figure:
    value: float | None
    moe: float | None
    flag: int | None = None  # sentinel that made the value unavailable, else None
    moe_note: str | None = None  # "c" controlled estimate (no sampling error), "m" margin of error not computable


def _moe_note(cell: Cell) -> str | None:
    if cell.moe_flag == CONTROLLED:
        return "c"
    if cell.moe is None:
        return "m"
    return None


def compute_measure(measure: Measure, cells: dict[str, Cell]) -> Figure:
    """Value and margin of error of a measure from its cells (percent for shares). Missing inputs give value None."""
    parts = [cells.get(c) for c in measure.cells]
    if any(p is None for p in parts):
        return Figure(None, None, None)
    if measure.kind == "value":
        cell = cells[measure.plus[0]]
        if cell.estimate is None:
            return Figure(None, None, cell.estimate_flag)
        note = _moe_note(cell)
        return Figure(cell.estimate, None if note else cell.moe, None, note)
    assert measure.den is not None
    den = cells[measure.den]
    signed = [(cells[c], 1) for c in measure.plus] + [(cells[c], -1) for c in measure.minus]
    for cell, _ in signed:
        if cell.estimate is None:
            return Figure(None, None, cell.estimate_flag)
    if den.estimate is None:
        return Figure(None, None, den.estimate_flag)
    if den.estimate <= 0:
        return Figure(None, None, None)
    num = sum(sign * cell.estimate for cell, sign in signed)  # type: ignore[operator]
    p = num / den.estimate
    contributors = [cell for cell, _ in signed] + [den]
    if all(c.moe_flag == CONTROLLED for c in contributors):
        return Figure(p * 100, None, None, "c")
    if any(c.moe_for_math is None for c in contributors):
        return Figure(p * 100, None, None, "m")
    mnum = math.sqrt(sum(cell.moe_for_math ** 2 for cell, _ in signed))  # type: ignore[operator]
    dmoe = den.moe_for_math
    radicand = mnum * mnum - p * p * dmoe * dmoe  # type: ignore[operator]
    if radicand < 0:
        radicand = mnum * mnum + p * p * dmoe * dmoe  # type: ignore[operator]
    return Figure(p * 100, math.sqrt(radicand) / den.estimate * 100)


def round_figure(measure: Measure, figure: Figure) -> tuple[float | int | None, float | int | None]:
    """Storage precision: counts and dollars whole, percentages and median age to 3 and 1 decimals."""
    def r(v, places):
        if v is None:
            return None
        out = round(v, places)
        return int(out) if places == 0 else out

    places = {"int": 0, "dollars": 0, "dec1": 1, "pct": 3}[measure.fmt]
    return r(figure.value, places), r(figure.moe, places)


def compute_all(row: dict[str, Cell], year: int) -> dict[str, list]:
    """measure key -> [value, moe], [value, None, "c"|"m"] (see Figure) or [None, None(, sentinel)]; measures with a missing cell are left out."""
    out: dict[str, list] = {}
    for measure in MEASURES:
        if any(c not in row for c in measure.cells):
            continue
        figure = compute_measure(measure, row)
        v, m = round_figure(measure, figure)
        if v is None:
            out[measure.key] = [None, None, figure.flag] if figure.flag is not None else [None, None]
        elif figure.moe_note:
            out[measure.key] = [v, None, figure.moe_note]
        else:
            out[measure.key] = [v, m]
    return out


@dataclass
class VintagePlan:
    """The API requests of one vintage and geography level."""

    survey: str  # acs5 | acs1
    year: int
    level: str  # us | state | county
    urls: list[str] = field(default_factory=list)
