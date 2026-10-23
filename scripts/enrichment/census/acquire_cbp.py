"""Acquire County Business Patterns (establishments, employees, annual payroll by NAICS sector) from the Census Data API.

States and the nation for 2017-2023 (every release classified with NAICS 2017, so sector codes are comparable) and counties
for 2023 only. ``INDLEVEL=2`` selects the all-sector total ("00") and the 2-digit NAICS sectors in one request.
"""
from __future__ import annotations

import census_http as C

YEARS = list(range(2017, 2024))
LATEST = 2023
FIELDS = "NAME,NAICS2017,ESTAB,ESTAB_F,EMP,EMP_F,EMP_N,PAYANN,PAYANN_F,PAYANN_N"


def cbp_url(year: int, level: str) -> str:
    geo = {"us": {"for": "us:1"}, "state": {"for": "state:*"}, "county": {"for": "county:*", "in": "state:*"}}[level]
    return C.build_url(f"{year}/cbp", {"get": FIELDS, **geo, "INDLEVEL": "2"})


def urls() -> list[str]:
    out = [cbp_url(y, level) for y in YEARS for level in ("us", "state")]
    out.append(cbp_url(LATEST, "county"))
    return out


def run() -> None:
    C.fetch_many(urls())
