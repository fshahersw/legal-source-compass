"""Acquire the Census Population Estimates state and county total files (public CSVs on www2.census.gov).

Vintage 2025 (April 2020 base, July 1 2020-2025) is the latest; vintage 2019 (July 1 2010-2019) is kept as the earlier
series. The two vintages use different bases (2010 and 2020 census), so they are stored as separate series, never joined.
"""
from __future__ import annotations

import census_http as C

BASE = "https://www2.census.gov/programs-surveys/popest/datasets"
FILES = {
    "state_v2025": (f"{BASE}/2020-2025/state/totals/NST-EST2025-ALLDATA.csv", "pep/NST-EST2025-ALLDATA.csv"),
    "county_v2025": (f"{BASE}/2020-2025/counties/totals/co-est2025-alldata.csv", "pep/co-est2025-alldata.csv"),
    "county_v2019": (f"{BASE}/2010-2019/counties/totals/co-est2019-alldata.csv", "pep/co-est2019-alldata.csv"),
    "state_v2019": (f"{BASE}/2010-2019/national/totals/nst-est2019-alldata.csv", "pep/nst-est2019-alldata.csv"),
}


def run() -> None:
    for name, (url, rel) in FILES.items():
        try:
            path = C.fetch_file(url, rel)
            print(name, "ok", path)
        except RuntimeError as error:
            print(name, "FAILED", error)
