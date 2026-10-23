"""Acquire the Census Bureau figures for the state and county pages.

  python3 -I -B scripts/enrichment/census/acquire_census.py layout     table-group metadata of every vintage; label check
  python3 -I -B scripts/enrichment/census/acquire_census.py acs        ACS 5-year (2013-2024) and 1-year data
  python3 -I -B scripts/enrichment/census/acquire_census.py pep        Population Estimates (vintage 2025 and 2019 files)
  python3 -I -B scripts/enrichment/census/acquire_census.py cbp        County Business Patterns

Responses land unchanged in private/acq/census/raw/ with a manifest (census_http.py). Nothing is written to any remote service.
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)

import census_http as C  # noqa: E402
import census_spec as S  # noqa: E402

BUILD = os.path.join(C.ROOT, "private", "build", "census")
LEVELS = {
    "us": {"for": "us:1"},
    "state": {"for": "state:*"},
    "county": {"for": "county:*", "in": "state:*"},
}
SURVEYS = {"acs5": (S.ACS5_YEARS, ("us", "state", "county")), "acs1": (S.ACS1_YEARS, ("us", "state"))}
TABLES = sorted({c.split("_")[0] for c in S.ALL_CELLS})


def group_url(survey: str, year: int, table: str) -> str:
    return f"{C.BASE}/{year}/acs/{survey}/groups/{table}.json"


def data_urls(survey: str, year: int, level: str, geo: dict | None = None) -> list[str]:
    """Key-less request URLs for one vintage and level (``geo`` overrides the geography, e.g. one state or county)."""
    cells = [c for c in S.cells_for_year(year, survey) if available(survey, year, c)]
    out = []
    for batch in S.batches(S.api_variables(cells)):
        params = {"get": "NAME," + ",".join(batch), **(geo or LEVELS[level])}
        out.append(C.build_url(f"{year}/acs/{survey}", params))
    return out


_labels: dict[tuple[str, int], dict[str, str]] = {}
_missing_tables: dict[tuple[str, int], set[str]] = {}


def labels_for(survey: str, year: int) -> dict[str, str]:
    """cell id -> estimate label for every table the measures use, from the cached group metadata."""
    key = (survey, year)
    if key in _labels:
        return _labels[key]
    out: dict[str, str] = {}
    missing: set[str] = set()
    for table in TABLES:
        try:
            meta = C.load(group_url(survey, year, table))
        except RuntimeError as error:
            if "HTTP 404" in str(error):
                missing.add(table)
                continue
            raise
        for variable, info in meta["variables"].items():  # type: ignore[index]
            if variable.endswith("E") and not variable.endswith("EA"):
                out[variable[:-1]] = info["label"]
    _labels[key] = out
    _missing_tables[key] = missing
    return out


def available(survey: str, year: int, cell: str) -> bool:
    labels_for(survey, year)
    return cell.split("_")[0] not in _missing_tables[(survey, year)]


def prefetch_groups() -> None:
    """Fetch every table-group document concurrently (a 404 means the table has not started yet; it is handled later)."""
    from concurrent.futures import ThreadPoolExecutor  # noqa: PLC0415

    urls = [group_url(s, y, t) for s, (years, _) in SURVEYS.items() for y in years for t in TABLES]

    def one(url: str) -> None:
        try:
            C.fetch(url)
        except RuntimeError as error:
            if "HTTP 404" not in str(error):
                raise

    with ThreadPoolExecutor(max_workers=C.MAX_WORKERS) as pool:
        list(pool.map(one, [u for u in urls if not os.path.exists(os.path.join(C.RAW, C.cache_name(u)))]))


def layout_report() -> dict:
    """Fetch every group document, check labels, and return {survey: {year: {problems, missing_tables}}}."""
    prefetch_groups()
    report: dict = {}
    for survey, (years, _) in SURVEYS.items():
        for year in years:
            labels = labels_for(survey, year)
            missing = sorted(_missing_tables[(survey, year)])
            excluded = {t for t in TABLES if S.FIRST_YEAR.get((survey, t), 0) > year}
            problems = S.check_layout(labels, year, survey)
            # cells of a missing table are reported through the table, not cell by cell
            problems = {c: r for c, r in problems.items() if c.split("_")[0] not in missing}
            report.setdefault(survey, {})[str(year)] = {
                "tables_missing": missing,
                "tables_not_used_before_first_year": sorted(excluded),
                "tables_missing_unexpected": sorted(set(missing) - excluded),
                "label_problems": problems,
            }
    return report


def phase_layout() -> bool:
    report = layout_report()
    os.makedirs(BUILD, exist_ok=True)
    with open(os.path.join(BUILD, "layout_report.json"), "w", encoding="utf-8") as handle:
        json.dump(report, handle, indent=1, sort_keys=True)
    bad = 0
    for survey, years in report.items():
        for year, info in years.items():
            if info["tables_missing_unexpected"] or info["label_problems"]:
                bad += 1
                print(survey, year, json.dumps(info)[:600])
    print(f"layout: {sum(len(v) for v in report.values())} vintages checked, {bad} with problems")
    return bad == 0


def phase_acs() -> None:
    if not phase_layout():
        raise SystemExit("layout problems: fix census_spec.py before downloading data")
    urls: list[str] = []
    for survey, (years, levels) in SURVEYS.items():
        for year in years:
            for level in levels:
                urls += data_urls(survey, year, level)
    print(f"{len(urls)} ACS requests")
    C.fetch_many(urls)


def main(argv: list[str]) -> None:
    phase = argv[1] if len(argv) > 1 else "layout"
    if phase == "layout":
        phase_layout()
    elif phase == "acs":
        phase_acs()
    elif phase == "pep":
        import acquire_pep  # noqa: PLC0415

        acquire_pep.run()
    elif phase == "cbp":
        import acquire_cbp  # noqa: PLC0415

        acquire_cbp.run()
    else:
        raise SystemExit(__doc__)


if __name__ == "__main__":
    main(sys.argv)
