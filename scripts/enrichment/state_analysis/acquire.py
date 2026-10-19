"""Acquire the official, keyless source files for the state_analysis stream into private/acq/state_analysis/.

Run: python3 -I -B acquire.py [name ...]   (names select a subset; default all). Re-runnable: stored files are kept.

Sources (all official publishers):
  * Census ACS 2020-2024 5-year table-based summary file (www2.census.gov), streamed; nation/state/county/place rows kept.
    (api.census.gov now redirects keyless requests to missing_key.html, so the summary file is the keyless channel.)
  * Census ACS 2024 5-year table shells (labels for every table cell).
  * Census Population Estimates Vintage 2025 county totals (co-est2025-alldata.csv).
  * Census 2024 Gazetteer counties and places (land area, names, place type).
  * Census 2020 ZCTA-to-county and ZCTA-to-place relationship files.
  * BLS LAUS county series (la.data.64.County) and series list (la.series).
  * BEA CAINC1 county personal income, population and per capita income.
  * 28 U.S.C. chapter 5 (judicial districts), U.S. Code 2024 edition, GovInfo (GPO).
"""
from __future__ import annotations

import sys

import sa_http

ACS = "https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/data/5YRData/acsdt5y2024-{t}.dat"
ACS_TABLES = [
    "b01001", "b01002", "b01003", "b03002", "b05012", "b15003", "b19013", "b19301", "b23025", "b25003", "b25064", "b25077",
    "c17002", "b27001",
]
# GEO_ID prefixes: 010 nation, 040 state, 050 county, 160 place (the "US" component follows the 7-character summary code).
KEEP = (b"0100000US", b"0400000US", b"0500000US", b"1600000US")
RULE = "keep the header line and lines whose GEO_ID starts with 0100000US, 0400000US, 0500000US or 1600000US"

FILES = {
    "acs_shells": ("https://www2.census.gov/programs-surveys/acs/summary_file/2024/table-based-SF/documentation/ACS20245YR_Table_Shells.txt", "census/ACS20245YR_Table_Shells.txt"),
    "pep_counties": ("https://www2.census.gov/programs-surveys/popest/datasets/2020-2025/counties/totals/co-est2025-alldata.csv", "census/co-est2025-alldata.csv"),
    "gaz_counties": ("https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_counties_national.zip", "census/2024_Gaz_counties_national.zip"),
    "gaz_places": ("https://www2.census.gov/geo/docs/maps-data/data/gazetteer/2024_Gazetteer/2024_Gaz_place_national.zip", "census/2024_Gaz_place_national.zip"),
    "zcta_county": ("https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_county20_natl.txt", "census/tab20_zcta520_county20_natl.txt"),
    "zcta_place": ("https://www2.census.gov/geo/docs/maps-data/data/rel2020/zcta520/tab20_zcta520_place20_natl.txt", "census/tab20_zcta520_place20_natl.txt"),
    "laus_county": ("https://download.bls.gov/pub/time.series/la/la.data.64.County", "bls/la.data.64.County"),
    "laus_series": ("https://download.bls.gov/pub/time.series/la/la.series", "bls/la.series"),
    "bea_cainc1": ("https://apps.bea.gov/regional/zip/CAINC1.zip", "bea/CAINC1.zip"),
    "usc28_ch5": ("https://www.govinfo.gov/content/pkg/USCODE-2024-title28/html/USCODE-2024-title28-partI-chap5.htm", "usc/USCODE-2024-title28-partI-chap5.htm"),
    # Virginia: 28 U.S.C. 127 names only counties (some since abolished); the courts' own local rules list the independent cities.
    "vaed_rules": ("https://www.vaed.uscourts.gov/sites/vaed/files/Local%20Rules%20EDVA%20December%201%202024.pdf", "courts/vaed_local_rules_2024-12-01.pdf"),
    "vawd_rules": ("https://www.vawd.uscourts.gov/sites/Public/assets/File/court/local_rules.pdf", "courts/vawd_local_rules.pdf"),
    # N.D. Tex. division pages: corroborate the Census spelling of two counties the Code spells differently and whose residents
    # filed too few cases for the IDB check (Shackleford/Shackelford, Brisco/Briscoe).
    "txnd_abilene": ("https://www.txnd.uscourts.gov/location/abilene", "courts/txnd_location_abilene.html"),
    "txnd_amarillo": ("https://www.txnd.uscourts.gov/location/amarillo", "courts/txnd_location_amarillo.html"),
}


def keep(line: bytes) -> bool:
    return line.startswith(KEEP)


def main(names: list[str]) -> None:
    for name, (url, rel) in FILES.items():
        if names and name not in names:
            continue
        print(name, sa_http.fetch(url, rel))
    for t in ACS_TABLES:
        if names and "acs" not in names and t not in names:
            continue
        print(t, sa_http.fetch_filtered(ACS.format(t=t), f"census/acs5y2024/acsdt5y2024-{t}.subset.dat.gz", keep, RULE))
    if not names or "acs155" in names:
        # Summary level 155 (state-place-county): population of each part of a place lying in each county, so a city can be
        # placed in its county or counties exactly as the Census tabulates it.
        print("b01003-155", sa_http.fetch_filtered(ACS.format(t="b01003"), "census/acs5y2024/acsdt5y2024-b01003.sl155.dat.gz",
                                                   lambda line: line.startswith(b"1550000US"),
                                                   "keep the header line and lines whose GEO_ID starts with 1550000US"))


if __name__ == "__main__":
    main(sys.argv[1:])
