"""Build the Census datasets (build files for private/scratch/enrich/publish_build.py; nothing is written remotely).

  python3 -I -B scripts/enrichment/census/build_census.py acs5 acs1 pep cbp      (any subset)

Datasets (ids confirmed absent from public.corpus_datasets before the first publish):
  census_acs_states     ACS 5-year 2013-2024 vintages: nation, 50 states, DC, Puerto Rico
  census_acs_counties   ACS 5-year 2013-2024 vintages: every county, county equivalent and Puerto Rico municipio
  census_acs1_states    ACS 1-year 2013-2024 (no 2020 release): nation, states, DC, Puerto Rico
  census_pop_estimates  Population Estimates totals, vintage 2025 (2020-2025) and vintage 2019 (2010-2019)
  census_cbp_states     County Business Patterns 2017-2023 by NAICS sector, nation and states
  census_cbp_counties   County Business Patterns 2023 by NAICS sector, counties
"""
from __future__ import annotations

import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
sys.path.insert(0, os.path.join(HERE, ".."))

import acquire_census as A  # noqa: E402
import acquire_pep  # noqa: E402
import census_http as C  # noqa: E402
import census_load as L  # noqa: E402
import census_rows as R  # noqa: E402
import census_spec as S  # noqa: E402
import corpus_writer as cw  # noqa: E402

BUILD = os.path.join(C.ROOT, "private", "build", "census")
ACS_DOC = {
    "acs5": "https://www.census.gov/data/developers/data-sets/acs-5year.html",
    "acs1": "https://www.census.gov/data/developers/data-sets/acs-1year.html",
}
SURVEY_NAME = {"acs5": "American Community Survey 5-year estimates", "acs1": "American Community Survey 1-year estimates"}
HANDBOOK = "https://www.census.gov/programs-surveys/acs/guidance/handbooks/general.html"
MOE_NOTE = (
    "Margins of error are at the 90 percent confidence level. Percentages are computed from published counts; their margins "
    "of error follow the Census Bureau's ACS handbook formulas (see the dataset summary). A controlled estimate has no "
    "sampling error; an estimate the Bureau could not compute is Not recorded."
)


def inputs_for(urls: list[str]) -> list[dict]:
    man = C.manifest()
    out = []
    for url in sorted(set(urls)):
        entry = man.get(url)
        if entry:
            out.append({"url": url, "path": entry["path"], "sha256": entry["sha256"], "retrieved_at": entry["retrieved_at"]})
    return out


# ------------------------------------------------------------------------------------------------------- ACS
def load_acs(survey: str) -> tuple[dict[str, dict[int, dict[str, dict]]], dict[str, dict[str, str]], list[str]]:
    """({level: {year: {geoid: {measure: figure}}}}, {level: {geoid: latest name}}, urls used)."""
    years, levels = A.SURVEYS[survey]
    figures: dict[str, dict[int, dict[str, dict]]] = {}
    names: dict[str, dict[str, str]] = {}
    used: list[str] = []
    for level in levels:
        figures[level], names[level] = {}, {}
        for year in years:
            urls = A.data_urls(survey, year, level)
            used += urls
            parts = [L.read_acs_response(C.load(u), level) for u in urls]  # type: ignore[arg-type]
            year_names, cells = L.merge_batches(parts)
            bad = [g for g in cells if not L.geoid_ok(level, g)]
            if bad:
                raise SystemExit(f"{survey} {year} {level}: unexpected geoids {bad[:3]}")
            figures[level][year] = {g: S.compute_all(row, year) for g, row in cells.items()}
            names[level].update(year_names)  # later vintages overwrite earlier names
    return figures, names, used


def by_geo(per_year: dict[int, dict[str, dict]]) -> dict[str, dict[str, dict[str, list]]]:
    """{year: {geoid: {measure: fig}}} -> {geoid: {measure: {year: fig}}}."""
    out: dict[str, dict[str, dict[str, list]]] = {}
    for year, rows in sorted(per_year.items()):
        for geoid, measures in rows.items():
            for key, figure in measures.items():
                out.setdefault(geoid, {}).setdefault(key, {})[str(year)] = figure
    return out


def acs_payload(survey: str, level: str, geoid: str, name: str, series: dict, years: list[int], ranks: dict | None, with_defs: bool) -> dict:
    latest_year = max(years)
    payload = {
        "kind": "census_acs",
        "survey": survey,
        "level": level,
        "geoid": geoid,
        "name": name,
        "usps": R.state_usps(geoid),
        "years": sorted(years),
        "latest_year": latest_year,
        "period": R.period_label(survey, latest_year),
        "series": {k: series[k] for k in sorted(series)},
        "latest": R.latest_of(series),
    }
    if ranks:
        payload["rank"] = ranks
    if with_defs:
        payload["measures"] = [m.definition() for m in S.MEASURES]
        payload["moe_note"] = MOE_NOTE
    return payload


def acs_facts(payload: dict, urls: list[str], brief: bool = False) -> list[list[str]]:
    survey = payload["survey"]
    facts = [
        ["Survey", f"U.S. Census Bureau, {SURVEY_NAME[survey]}"],
        ["Latest period", payload["period"] + (" (five-year average)" if survey == "acs5" else " (calendar year)")],
        ["Vintages stored", ", ".join(str(y) for y in payload["years"])],
    ]
    defs = {m.key: m for m in S.MEASURES}
    for key, latest in payload["latest"].items():
        value, moe, year = latest[:3]
        m = defs[key]
        text = R.fmt(value, m.fmt)
        if moe is not None:
            text += f" ± {R.fmt(moe, m.fmt)}"
        facts.append([f"{m.label} ({year})", text])
    if brief:  # county rows: the margin-of-error note and the request pattern are in the dataset summary
        facts.append(["Census API request, first variable batch, latest vintage (key not shown)", urls[0]])
        return facts
    facts.append(["Margin of error", MOE_NOTE])
    facts.append(["Census API requests, latest vintage (key not shown)", " ".join(urls)])
    return facts


def build_acs(survey: str) -> list[dict]:
    figures, names, used = load_acs(survey)
    years, levels = A.SURVEYS[survey]
    dataset_states = {"acs5": "census_acs_states", "acs1": "census_acs1_states"}[survey]
    dataset_counties = "census_acs_counties"
    state_series = {**by_geo(figures["us"]), **by_geo(figures["state"])}
    state_names = {**names["us"], **names["state"]}
    latest_year = max(years)
    # Rank 1 = highest latest-vintage value among the 50 states and DC (Puerto Rico is shown, never ranked).
    ranks: dict[str, dict[str, list[int]]] = {}
    for measure in S.MEASURES:
        values = {}
        for fips in L.RANKED_STATES:
            figure = state_series.get(fips, {}).get(measure.key, {}).get(str(latest_year))
            if figure and figure[0] is not None:
                values[fips] = figure[0]
        for fips, (rank, n) in R.competition_ranks(values).items():
            ranks.setdefault(fips, {})[measure.key] = [rank, n]
    rows_states = []
    for geoid in [L.US] + sorted(g for g in state_series if g != L.US):
        series = state_series[geoid]
        level = "us" if geoid == L.US else "state"
        gyears = sorted({int(y) for by_year in series.values() for y in by_year})
        payload = acs_payload(survey, level, geoid, state_names[geoid], series, gyears, ranks.get(geoid), True)
        urls = R.api_urls(survey, max(gyears), level, geoid, C.build_url)
        usps = R.state_usps(geoid)
        latest = payload["latest"]
        fm = lambda key, kind: R.fmt(latest.get(key, [None])[0], kind)  # noqa: E731
        title = state_names[geoid]
        rows_states.append(
            cw.record(
                dataset_states,
                "US" if geoid == L.US else geoid,
                title,
                source_url=urls[0],
                subtitle=f"{SURVEY_NAME[survey]} {payload['period']}",
                cells={
                    "name": title,
                    "population": fm("pop", "int"),
                    "income": fm("median_hh_income", "dollars"),
                    "poverty": fm("poverty_rate", "pct"),
                    "period": payload["period"],
                },
                facts=acs_facts(payload, urls),
                text=f"{title} {usps} Census {SURVEY_NAME[survey]} population income poverty unemployment education insurance",
                filters={"level": [level], "survey": [survey], **({"region": [usps.lower()]} if usps else {})},
                state=usps,
                links=[{"url": f"/places/{usps}", "label": f"{title} state page"}] if usps else [],
                extra={"kind": "census_acs", "census": payload},
            )
        )
    summary = acs_summary(survey, years, used, len(rows_states))
    out = [
        {
            "dataset": dataset_states,
            "label": f"Census {SURVEY_NAME[survey]}: nation, states, DC and Puerto Rico, {years[0]}-{latest_year} releases",
            "listing_block": cw.listing(
                [("name", "Geography"), ("population", "Population"), ("income", "Median household income"), ("poverty", "Below poverty"), ("period", "Latest period")],
                [("level", "Level", {"us": "Nation", "state": "State, DC or Puerto Rico"})],
            ),
            "summary": summary,
            "rows": rows_states,
            "built_at": R.utc_now(),
            "inputs": inputs_for(used),
        }
    ]
    if survey == "acs5":
        county_series = by_geo(figures["county"])
        county_names = names["county"]
        # Rank within the state among counties that have a latest-vintage value (1 = highest).
        state_ranks: dict[str, dict[str, list[int]]] = {}
        for measure in S.MEASURES:
            groups: dict[str, dict[str, float]] = {}
            for geoid, series in county_series.items():
                figure = series.get(measure.key, {}).get(str(latest_year))
                if figure and figure[0] is not None:
                    groups.setdefault(geoid[:2], {})[geoid] = figure[0]
            for values in groups.values():
                for geoid, (rank, n) in R.competition_ranks(values).items():
                    state_ranks.setdefault(geoid, {})[measure.key] = [rank, n]
        rows_counties = []
        for geoid in sorted(county_series):
            series = county_series[geoid]
            gyears = sorted({int(y) for by_year in series.values() for y in by_year})
            payload = acs_payload(survey, "county", geoid, county_names[geoid], series, gyears, state_ranks.get(geoid), False)
            payload["rank_scope"] = "counties of the same state with a value in the latest vintage; 1 = highest"
            urls = R.api_urls(survey, max(gyears), "county", geoid, C.build_url)
            usps = R.state_usps(geoid)
            latest = payload["latest"]
            fm = lambda key, kind: R.fmt(latest.get(key, [None])[0], kind)  # noqa: E731
            title = county_names[geoid]
            rows_counties.append(
                cw.record(
                    dataset_counties,
                    geoid,
                    title,
                    source_url=urls[0],
                    subtitle=f"{SURVEY_NAME[survey]} {payload['period']}",
                    cells={
                        "name": title,
                        "population": fm("pop", "int"),
                        "income": fm("median_hh_income", "dollars"),
                        "poverty": fm("poverty_rate", "pct"),
                        "period": payload["period"],
                    },
                    facts=acs_facts(payload, urls, brief=True),
                    text=f"{title} {usps} county Census American Community Survey population income poverty",
                    filters={"state": [usps.lower()], "survey": [survey]},
                    state=usps,
                    links=[{"url": f"/places/{usps}/{geoid}", "label": f"{title} county page"}],
                    extra={"kind": "census_acs", "census": payload},
                )
            )
        out.append(
            {
                "dataset": dataset_counties,
                "label": f"Census American Community Survey 5-year estimates: counties, {years[0]}-{latest_year} releases",
                "listing_block": cw.listing(
                    [("name", "County"), ("population", "Population"), ("income", "Median household income"), ("poverty", "Below poverty"), ("period", "Latest period")],
                    [("state", "State", {u.lower(): u for u in sorted(L.STATE_USPS.values())})],
                ),
                "summary": acs_summary(survey, years, used, len(rows_counties), counties=True),
                "rows": rows_counties,
                "built_at": R.utc_now(),
                "inputs": inputs_for(used),
            }
        )
    return out


def acs_summary(survey: str, years: list[int], used: list[str], rows: int, counties: bool = False) -> dict:
    return {
        "published_by": "enrich/census",
        "survey": SURVEY_NAME[survey],
        "source": ACS_DOC[survey],
        "api": f"https://api.census.gov/data/{{year}}/acs/{survey}",
        "vintages": years,
        "geographies": ("counties, county equivalents and Puerto Rico municipios" if counties else "nation, 50 states, DC, Puerto Rico"),
        "rows": rows,
        "measures": [m.definition() for m in S.MEASURES],
        "formulas": (
            "value = estimate of the cell(s) as published; percentage = 100 x (sum of numerator cells) / denominator cell; "
            "MOE of a sum or difference = sqrt(sum of squared MOEs); MOE of a percentage = 100 x sqrt(MOE_num^2 - p^2 x MOE_den^2) / den, "
            "or sqrt(MOE_num^2 + p^2 x MOE_den^2) / den when the first radicand is negative (ACS handbook); a -555555555 margin of error "
            "(controlled estimate) counts as zero; any other Census sentinel value makes the figure Not recorded."
        ),
        "handbook": HANDBOOK,
        "comparability": (
            "Five-year releases overlap (2019-2023 and 2020-2024 share four years) and are not independent; dollar figures are "
            "inflation-adjusted to the last year of each release and are not adjusted to a common year. "
            "Connecticut's counties were replaced by planning regions from the 2018-2022 release and Alaska's Valdez-Cordova "
            "census area was split in 2019, so those geographies have no values for the other period."
            if survey == "acs5"
            else "One-year estimates cover calendar-year samples of areas with 65,000 or more residents; 2020 has no standard release."
        ),
        "layout_check": "Every cell's published label was compared with the expected label for each vintage before use (private/build/census/layout_report.json).",
        "requests": len(set(used)),
    }


# ------------------------------------------------------------------------------------------------------- PEP
def build_pep() -> list[dict]:
    base = os.path.join(C.ACQ, "pep")
    sources = {
        ("state", "v2025"): ("NST-EST2025-ALLDATA.csv", acquire_pep.FILES["state_v2025"][0]),
        ("county", "v2025"): ("co-est2025-alldata.csv", acquire_pep.FILES["county_v2025"][0]),
        ("state", "v2019"): ("nst-est2019-alldata.csv", acquire_pep.FILES["state_v2019"][0]),
        ("county", "v2019"): ("co-est2019-alldata.csv", acquire_pep.FILES["county_v2019"][0]),
    }
    data: dict[tuple[str, str], dict[str, dict]] = {}
    for (level, vintage), (fname, _url) in sources.items():
        data[(level, vintage)] = L.read_pep_file(os.path.join(base, fname), level)
    geoids = set()
    for table in data.values():
        geoids |= set(table)
    # rank states by the latest estimate (50 states + DC)
    latest_values = {g: data[("state", "v2025")][g]["pop"].get("2025") for g in L.RANKED_STATES if g in data[("state", "v2025")]}
    ranks = R.competition_ranks({g: v for g, v in latest_values.items() if v is not None})
    rows = []
    used_urls = [u for _, u in sources.values()]
    man = C.manifest()
    for geoid in sorted(geoids, key=lambda g: (len(g) != 2 and g != L.US, g)):
        level = "us" if geoid == L.US else ("state" if len(geoid) == 2 else "county")
        series: dict[str, dict] = {}
        name = None
        for vintage in ("v2025", "v2019"):
            table = data[("state" if level != "county" else "county", vintage)]
            if geoid in table:
                entry = table[geoid]
                name = name or entry["name"]
                series[vintage] = {"base": entry["base"], "pop": entry["pop"]}
        v25 = series.get("v2025", {}).get("pop", {})
        latest = None
        if "2025" in v25:
            latest = {"year": 2025, "date": "July 1, 2025", "vintage": 2025, "value": v25["2025"]}
            if geoid in ranks:
                latest["rank"], latest["of"] = ranks[geoid]
        usps = R.state_usps(geoid)
        title = name or geoid
        payload = {"kind": "census_pep", "level": level, "geoid": geoid, "name": title, "usps": usps, "series": series, "latest": latest}
        rows.append(
            cw.record(
                "census_pop_estimates",
                "US" if geoid == L.US else geoid,
                title,
                source_url=sources[("county" if level == "county" else "state", "v2025" if "v2025" in series else "v2019")][1],
                subtitle="Census Population Estimates, resident population on July 1",
                cells={
                    "name": title,
                    "level": {"us": "Nation", "state": "State", "county": "County"}[level],
                    "pop2025": R.fmt(v25.get("2025"), "int"),
                    "pop2020": R.fmt(v25.get("2020"), "int"),
                    "pop2019": R.fmt(series.get("v2019", {}).get("pop", {}).get("2019"), "int"),
                },
                facts=[
                    ["Estimates", "U.S. Census Bureau, Population Estimates Program: vintage 2025 (April 2020 base; July 1, 2020-2025) and vintage 2019 (April 2010 base; July 1, 2010-2019)"],
                    ["Population, July 1, 2025", R.fmt(v25.get("2025"), "int")],
                    ["Population, July 1, 2019 (vintage 2019)", R.fmt(series.get("v2019", {}).get("pop", {}).get("2019"), "int")],
                    ["Comparability", "Vintage 2019 and vintage 2025 rest on different bases (2010 and 2020 census); the two series are stored separately and are not joined."],
                ],
                text=f"{title} population estimates Census",
                filters={"level": [level], **({"state": [usps.lower()]} if usps else {})},
                state=usps,
                links=[{"url": f"/places/{usps}" if level != "county" else f"/places/{usps}/{geoid}", "label": f"{title} page"}] if usps else [],
                extra={"kind": "census_pep", "census": payload},
            )
        )
    inputs = [
        {"url": u, "path": man[u]["path"], "sha256": man[u]["sha256"], "retrieved_at": man[u]["retrieved_at"]}
        for u in used_urls
        if u in man
    ]
    return [
        {
            "dataset": "census_pop_estimates",
            "label": "Census Population Estimates: annual resident population of the nation, states, counties (vintage 2025, 2020-2025, and vintage 2019, 2010-2019)",
            "listing_block": cw.listing(
                [("name", "Geography"), ("level", "Level"), ("pop2025", "July 1, 2025"), ("pop2020", "July 1, 2020"), ("pop2019", "July 1, 2019 (vintage 2019)")],
                [("level", "Level", {"us": "Nation", "state": "State", "county": "County"})],
            ),
            "summary": {
                "published_by": "enrich/census",
                "source": "https://www.census.gov/programs-surveys/popest.html",
                "files": {f"{level}_{vintage}": url for (level, vintage), (_name, url) in sources.items()},
                "rows": len(rows),
                "note": "Totals only (resident population on July 1). Puerto Rico municipios are not in these files. Connecticut counties are planning regions from the 2022 estimates on.",
            },
            "rows": rows,
            "built_at": R.utc_now(),
            "inputs": inputs,
        }
    ]


def write_build(build: dict) -> None:
    os.makedirs(BUILD, exist_ok=True)
    path = os.path.join(BUILD, build["dataset"] + ".json")
    with open(path, "w", encoding="utf-8") as handle:
        json.dump(build, handle, ensure_ascii=False, sort_keys=True, separators=(",", ":"))
    size = os.path.getsize(path)
    print(f"{build['dataset']}: {len(build['rows'])} rows, {size / 1e6:.1f} MB -> {path}")


def main(argv: list[str]) -> None:
    wanted = argv[1:] or ["acs5", "acs1", "pep"]
    for name in wanted:
        if name in ("acs5", "acs1"):
            for build in build_acs(name):
                write_build(build)
        elif name == "pep":
            for build in build_pep():
                write_build(build)
        elif name == "cbp":
            import build_cbp  # noqa: PLC0415

            for build in build_cbp.build():
                write_build(build)
        else:
            raise SystemExit(f"unknown dataset group {name}")


if __name__ == "__main__":
    main(sys.argv)
