"""Read the cached Census responses into plain structures (no network; the cache is filled by acquire_census.py).

Geography ids: ``US`` for the nation, the two-digit FIPS code for a state (Puerto Rico 72), the five-digit state+county code
for a county. All parsing is by header name, never by column position.
"""
from __future__ import annotations

import csv
import io
import os
from typing import Iterable

import census_spec as S

US = "US"
# State FIPS -> USPS for the 50 states, DC and Puerto Rico.
STATE_USPS = {
    "01": "AL", "02": "AK", "04": "AZ", "05": "AR", "06": "CA", "08": "CO", "09": "CT", "10": "DE", "11": "DC", "12": "FL",
    "13": "GA", "15": "HI", "16": "ID", "17": "IL", "18": "IN", "19": "IA", "20": "KS", "21": "KY", "22": "LA", "23": "ME",
    "24": "MD", "25": "MA", "26": "MI", "27": "MN", "28": "MS", "29": "MO", "30": "MT", "31": "NE", "32": "NV", "33": "NH",
    "34": "NJ", "35": "NM", "36": "NY", "37": "NC", "38": "ND", "39": "OH", "40": "OK", "41": "OR", "42": "PA", "44": "RI",
    "45": "SC", "46": "SD", "47": "TN", "48": "TX", "49": "UT", "50": "VT", "51": "VA", "53": "WA", "54": "WV", "55": "WI",
    "56": "WY", "72": "PR",
}
RANKED_STATES = sorted(f for f in STATE_USPS if f != "72")  # the 50 states and DC; Puerto Rico is shown, not ranked


def geoid_of(level: str, header: list[str], row: list) -> str:
    idx = {h: i for i, h in enumerate(header)}
    if level == "us":
        return US
    if level == "state":
        return str(row[idx["state"]])
    if level == "county":
        return str(row[idx["state"]]) + str(row[idx["county"]])
    raise ValueError(level)


def read_acs_response(data: list[list], level: str) -> tuple[dict[str, str], dict[str, dict[str, S.Cell]]]:
    """One API response (header row plus rows) -> ({geoid: name}, {geoid: {cell: Cell}})."""
    header = data[0]
    idx = {h: i for i, h in enumerate(header)}
    cell_ids = sorted({h[:-1] for h in header if len(h) > 8 and h[-1] in "EM" and h[:-1] in S.CELLS})
    names: dict[str, str] = {}
    cells: dict[str, dict[str, S.Cell]] = {}
    for row in data[1:]:
        geoid = geoid_of(level, header, row)
        names[geoid] = row[idx["NAME"]]
        cells[geoid] = {c: S.read_cell(row[idx[c + "E"]], row[idx[c + "M"]]) for c in cell_ids if c + "E" in idx and c + "M" in idx}
    return names, cells


def merge_batches(parts: Iterable[tuple[dict[str, str], dict[str, dict[str, S.Cell]]]]) -> tuple[dict[str, str], dict[str, dict[str, S.Cell]]]:
    """Merge the responses of one vintage and level (variables split over several requests) and check they agree."""
    names: dict[str, str] = {}
    cells: dict[str, dict[str, S.Cell]] = {}
    first = True
    for part_names, part_cells in parts:
        if first:
            names, first = dict(part_names), False
            cells = {g: dict(c) for g, c in part_cells.items()}
            continue
        if set(part_names) != set(names):
            raise ValueError("batches of one vintage return different geographies")
        for geoid, row in part_cells.items():
            overlap = set(cells[geoid]) & set(row)
            if overlap:
                raise ValueError(f"cell(s) {sorted(overlap)} appear in two batches")
            cells[geoid].update(row)
    return names, cells


def geoid_ok(level: str, geoid: str) -> bool:
    return (level == "us" and geoid == US) or (level == "state" and len(geoid) == 2) or (level == "county" and len(geoid) == 5)


# ----------------------------------------------------------------------------------------------------------- PEP
def _int(value: str) -> int | None:
    value = (value or "").strip()
    return int(value) if value.lstrip("-").isdigit() else None


def read_pep_csv(text: str, level: str) -> dict[str, dict]:
    """Population Estimates totals CSV -> {geoid: {"name", "base": {...}, "pop": {year: n}}}.

    Level ``state``: SUMLEV 040 rows (state FIPS) plus the SUMLEV 010 nation row (``US``). Level ``county``: SUMLEV 050.
    Column names: ESTIMATESBASE<yyyy>, CENSUS2010POP, POPESTIMATE<yyyy>.
    """
    reader = csv.DictReader(io.StringIO(text))
    out: dict[str, dict] = {}
    for row in reader:
        sumlev = (row.get("SUMLEV") or "").strip().zfill(3)
        state = (row.get("STATE") or "").strip().zfill(2)
        county = (row.get("COUNTY") or "").strip().zfill(3)
        if level == "state":
            if sumlev == "010":
                geoid = US
            elif sumlev == "040":
                geoid = state
            else:
                continue
            name = (row.get("NAME") or row.get("STNAME") or "").strip()
        else:
            if sumlev != "050":
                continue
            geoid = state + county
            name = f"{(row.get('CTYNAME') or '').strip()}, {(row.get('STNAME') or '').strip()}"
        base: dict[str, int] = {}
        pop: dict[str, int] = {}
        for column, value in row.items():
            if column is None:
                continue
            number = _int(value)
            if number is None:
                continue
            if column.startswith("POPESTIMATE") and column[len("POPESTIMATE"):].isdigit():
                pop[column[len("POPESTIMATE"):]] = number
            elif column.startswith("ESTIMATESBASE"):
                base[column[len("ESTIMATESBASE"):]] = number
            elif column == "CENSUS2010POP":
                base["census2010"] = number
        out[geoid] = {"name": name, "base": base, "pop": pop}
    return out


# ----------------------------------------------------------------------------------------------------------- CBP
CBP_FLAGS = {"D": "withheld to avoid disclosing data for individual companies", "S": "withheld because the estimate did not meet publication standards"}


def read_cbp_response(data: list[list], level: str, naics_column: str) -> dict[str, dict[str, dict]]:
    """CBP response -> {geoid: {sector: {"estab", "emp", "pay", "flags"}}}; a flagged EMP or PAYANN is None, never 0.

    The API returns 0 in a withheld cell together with the flag, so a flag always overrides the number.
    """
    header = data[0]
    idx = {h: i for i, h in enumerate(header)}
    first_naics = header.index(naics_column)
    out: dict[str, dict[str, dict]] = {}
    for row in data[1:]:
        geoid = geoid_of(level, header, row)
        sector = str(row[first_naics])

        def num(name: str):
            v = row[idx[name]] if name in idx else None
            return int(v) if v not in (None, "") else None

        def flag(name: str):
            v = row[idx[name]] if name in idx else None
            return v if v not in (None, "") else None

        e_flag, p_flag, a_flag = flag("EMP_F"), flag("PAYANN_F"), flag("ESTAB_F")
        record = {
            "estab": None if a_flag else num("ESTAB"),
            "emp": None if e_flag else num("EMP"),
            "pay": None if p_flag else num("PAYANN"),
        }
        flags = {k: v for k, v in (("estab", a_flag), ("emp", e_flag), ("pay", p_flag)) if v}
        if flags:
            record["flags"] = flags
        for noise in ("EMP_N", "PAYANN_N"):
            if num(noise):
                record.setdefault("noise", {})[noise] = num(noise)
        out.setdefault(geoid, {})[sector] = record
    return out


def read_pep_file(path: str, level: str) -> dict[str, dict]:
    with open(path, "rb") as handle:
        raw = handle.read()
    try:
        text = raw.decode("utf-8-sig")
    except UnicodeDecodeError:  # the county files are Latin-1 (for example "Doña Ana County")
        text = raw.decode("latin-1")
    return read_pep_csv(text, level)


def exists(path: str) -> bool:
    return os.path.exists(path)
