"""County Business Patterns datasets: census_cbp_states (2017-2023) and census_cbp_counties (2023)."""
from __future__ import annotations

import acquire_cbp as B
import census_http as C
import census_load as L
import census_rows as R
import corpus_writer as cw

SECTORS = {
    "00": "All sectors",
    "11": "Agriculture, forestry, fishing and hunting",
    "21": "Mining, quarrying, and oil and gas extraction",
    "22": "Utilities",
    "23": "Construction",
    "31-33": "Manufacturing",
    "42": "Wholesale trade",
    "44-45": "Retail trade",
    "48-49": "Transportation and warehousing",
    "51": "Information",
    "52": "Finance and insurance",
    "53": "Real estate and rental and leasing",
    "54": "Professional, scientific, and technical services",
    "55": "Management of companies and enterprises",
    "56": "Administrative and support and waste management and remediation services",
    "61": "Educational services",
    "62": "Health care and social assistance",
    "71": "Arts, entertainment, and recreation",
    "72": "Accommodation and food services",
    "81": "Other services (except public administration)",
    "99": "Industries not classified",
}
DOC = "https://www.census.gov/programs-surveys/cbp.html"
FLAGS = L.CBP_FLAGS


def load(year: int, level: str) -> dict[str, dict[str, dict]]:
    return L.read_cbp_response(C.load(B.cbp_url(year, level)), level, "NAICS2017")  # type: ignore[arg-type]


def compact(record: dict) -> list:
    """[establishments, employees, payroll in $1,000, flags or omitted]; a withheld figure is null, never 0."""
    out = [record["estab"], record["emp"], record["pay"]]
    if record.get("flags"):
        out.append(record["flags"])
    return out


def cbp_summary(rows: int, years: list[int], used: list[str]) -> dict:
    return {
        "published_by": "enrich/census",
        "source": DOC,
        "api": "https://api.census.gov/data/{year}/cbp",
        "years": years,
        "sectors": SECTORS,
        "rows": rows,
        "units": {"estab": "establishments", "emp": "employees, pay period including March 12", "pay": "annual payroll, $1,000"},
        "flags": FLAGS,
        "note": (
            "NAICS 2017 sectors. A figure the Census Bureau withholds (flag D or S) is Not recorded, never zero. Counts carry "
            "the Bureau's noise infusion, so sector rows need not add exactly to totals. CBP covers establishments with paid "
            "employees; it excludes self-employed people, most agricultural production, railroad and government employees."
        ),
        "requests": len(used),
    }


def build() -> list[dict]:
    state_series: dict[str, dict[str, dict[str, list]]] = {}
    names: dict[str, str] = {}
    used = B.urls()
    for year in B.YEARS:
        for level in ("us", "state"):
            for geoid, sectors in load(year, level).items():
                if geoid != L.US and geoid[:2] not in L.STATE_USPS:  # island areas have no page
                    continue
                for sector, record in sectors.items():
                    state_series.setdefault(geoid, {}).setdefault(sector, {})[str(year)] = compact(record)
    # names come from the same responses (NAME column)
    for year in (B.LATEST,):
        for level in ("us", "state"):
            data = C.load(B.cbp_url(year, level))
            header = data[0]  # type: ignore[index]
            for row in data[1:]:  # type: ignore[index]
                names[L.geoid_of(level, header, row)] = row[header.index("NAME")]
    man = C.manifest()
    inputs = [{"url": u, "path": man[u]["path"], "sha256": man[u]["sha256"], "retrieved_at": man[u]["retrieved_at"]} for u in used if u in man]
    rows = []
    for geoid in [L.US] + sorted(g for g in state_series if g != L.US):
        series = state_series[geoid]
        level = "us" if geoid == L.US else "state"
        usps = R.state_usps(geoid)
        total = series.get("00", {}).get(str(B.LATEST))
        title = names.get(geoid, geoid)
        payload = {"kind": "census_cbp", "level": level, "geoid": geoid, "name": title, "usps": usps, "years": B.YEARS, "latest_year": B.LATEST, "series": series}
        rows.append(
            cw.record(
                "census_cbp_states",
                "US" if geoid == L.US else geoid,
                title,
                source_url=C.build_url(f"{B.LATEST}/cbp", {"get": B.FIELDS, **R.geo_params(level, geoid), "INDLEVEL": "2"}),
                subtitle=f"County Business Patterns {B.LATEST}, NAICS 2017 sectors",
                cells={
                    "name": title,
                    "estab": R.fmt(total[0] if total else None, "int"),
                    "emp": R.fmt(total[1] if total else None, "int"),
                    "payroll": R.fmt(total[2] if total else None, "int"),
                    "year": str(B.LATEST),
                },
                facts=[
                    ["Survey", "U.S. Census Bureau, County Business Patterns"],
                    ["Years stored", f"{B.YEARS[0]}-{B.YEARS[-1]}"],
                    [f"Establishments, {B.LATEST}", R.fmt(total[0] if total else None, "int")],
                    [f"Employees, {B.LATEST}", R.fmt(total[1] if total else None, "int")],
                    [f"Annual payroll, {B.LATEST} ($1,000)", R.fmt(total[2] if total else None, "int")],
                ],
                text=f"{title} County Business Patterns establishments employment payroll NAICS",
                filters={"level": [level], **({"region": [usps.lower()]} if usps else {})},
                state=usps,
                links=[{"url": f"/places/{usps}", "label": f"{title} state page"}] if usps else [],
                extra={"kind": "census_cbp", "census": payload},
            )
        )
    builds = [
        {
            "dataset": "census_cbp_states",
            "label": f"Census County Business Patterns: establishments, employees and payroll by NAICS sector, nation and states, {B.YEARS[0]}-{B.LATEST}",
            "listing_block": cw.listing(
                [("name", "Geography"), ("estab", "Establishments"), ("emp", "Employees"), ("payroll", "Annual payroll ($1,000)"), ("year", "Year")],
                [("level", "Level", {"us": "Nation", "state": "State, DC or Puerto Rico"})],
            ),
            "summary": cbp_summary(len(rows), B.YEARS, used),
            "rows": rows,
            "built_at": R.utc_now(),
            "inputs": inputs,
        }
    ]
    county_rows = []
    counties = load(B.LATEST, "county")
    county_names: dict[str, str] = {}
    data = C.load(B.cbp_url(B.LATEST, "county"))
    header = data[0]  # type: ignore[index]
    for row in data[1:]:  # type: ignore[index]
        county_names[L.geoid_of("county", header, row)] = row[header.index("NAME")]
    for geoid in sorted(g for g in counties if g[:2] in L.STATE_USPS):
        sectors = counties[geoid]
        usps = R.state_usps(geoid)
        total = sectors.get("00")
        title = county_names[geoid]
        series = {sector: {str(B.LATEST): compact(rec)} for sector, rec in sectors.items()}
        payload = {"kind": "census_cbp", "level": "county", "geoid": geoid, "name": title, "usps": usps, "years": [B.LATEST], "latest_year": B.LATEST, "series": series}
        county_rows.append(
            cw.record(
                "census_cbp_counties",
                geoid,
                title,
                source_url=C.build_url(f"{B.LATEST}/cbp", {"get": B.FIELDS, "for": f"county:{geoid[2:]}", "in": f"state:{geoid[:2]}", "INDLEVEL": "2"}),
                subtitle=f"County Business Patterns {B.LATEST}, NAICS 2017 sectors",
                cells={
                    "name": title,
                    "estab": R.fmt(total["estab"] if total else None, "int"),
                    "emp": R.fmt(total["emp"] if total else None, "int"),
                    "payroll": R.fmt(total["pay"] if total else None, "int"),
                    "year": str(B.LATEST),
                },
                facts=[
                    ["Survey", "U.S. Census Bureau, County Business Patterns"],
                    [f"Establishments, {B.LATEST}", R.fmt(total["estab"] if total else None, "int")],
                    [f"Employees, {B.LATEST}", R.fmt(total["emp"] if total else None, "int")],
                ],
                text=f"{title} County Business Patterns establishments employment payroll NAICS",
                filters={"state": [usps.lower()]},
                state=usps,
                links=[{"url": f"/places/{usps}/{geoid}", "label": f"{title} county page"}],
                extra={"kind": "census_cbp", "census": payload},
            )
        )
    builds.append(
        {
            "dataset": "census_cbp_counties",
            "label": f"Census County Business Patterns: establishments, employees and payroll by NAICS sector, counties, {B.LATEST}",
            "listing_block": cw.listing(
                [("name", "County"), ("estab", "Establishments"), ("emp", "Employees"), ("payroll", "Annual payroll ($1,000)"), ("year", "Year")],
                [("state", "State", {u.lower(): u for u in sorted(L.STATE_USPS.values())})],
            ),
            "summary": cbp_summary(len(county_rows), [B.LATEST], used),
            "rows": county_rows,
            "built_at": R.utc_now(),
            "inputs": inputs,
        }
    )
    return builds
