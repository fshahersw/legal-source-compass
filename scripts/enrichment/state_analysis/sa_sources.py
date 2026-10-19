"""Parsers for the official source files of the state_analysis stream. Pure functions over stored raw bytes.

Every parser drops malformed values (returns None) rather than guessing; callers report what was dropped.
"""
from __future__ import annotations

import csv
import gzip
import html
import io
import re
import zipfile

# 50 states + DC (the app's STATES table in src/lib/corpus/geo.ts).
STATES = [
    ("01", "AL", "Alabama"), ("02", "AK", "Alaska"), ("04", "AZ", "Arizona"), ("05", "AR", "Arkansas"), ("06", "CA", "California"),
    ("08", "CO", "Colorado"), ("09", "CT", "Connecticut"), ("10", "DE", "Delaware"), ("11", "DC", "District of Columbia"),
    ("12", "FL", "Florida"), ("13", "GA", "Georgia"), ("15", "HI", "Hawaii"), ("16", "ID", "Idaho"), ("17", "IL", "Illinois"),
    ("18", "IN", "Indiana"), ("19", "IA", "Iowa"), ("20", "KS", "Kansas"), ("21", "KY", "Kentucky"), ("22", "LA", "Louisiana"),
    ("23", "ME", "Maine"), ("24", "MD", "Maryland"), ("25", "MA", "Massachusetts"), ("26", "MI", "Michigan"), ("27", "MN", "Minnesota"),
    ("28", "MS", "Mississippi"), ("29", "MO", "Missouri"), ("30", "MT", "Montana"), ("31", "NE", "Nebraska"), ("32", "NV", "Nevada"),
    ("33", "NH", "New Hampshire"), ("34", "NJ", "New Jersey"), ("35", "NM", "New Mexico"), ("36", "NY", "New York"),
    ("37", "NC", "North Carolina"), ("38", "ND", "North Dakota"), ("39", "OH", "Ohio"), ("40", "OK", "Oklahoma"), ("41", "OR", "Oregon"),
    ("42", "PA", "Pennsylvania"), ("44", "RI", "Rhode Island"), ("45", "SC", "South Carolina"), ("46", "SD", "South Dakota"),
    ("47", "TN", "Tennessee"), ("48", "TX", "Texas"), ("49", "UT", "Utah"), ("50", "VT", "Vermont"), ("51", "VA", "Virginia"),
    ("53", "WA", "Washington"), ("54", "WV", "West Virginia"), ("55", "WI", "Wisconsin"), ("56", "WY", "Wyoming"),
]
FIPS_TO_USPS = {f: u for f, u, _ in STATES}
USPS_TO_FIPS = {u: f for f, u, _ in STATES}
NAME_TO_USPS = {n: u for _, u, n in STATES}
USPS_TO_NAME = {u: n for _, u, n in STATES}


# ---------------------------------------------------------------- ACS table-based summary file

def acs_value(text: str) -> float | None:
    """ACS summary-file cell -> number; empty, non-numeric and the negative annotation codes (e.g. -666666666) -> None."""
    t = (text or "").strip()
    if not t:
        return None
    try:
        v = float(t)
    except ValueError:
        return None
    if v < 0:  # annotation sentinels (-111111111 ... -999999999) are never real values for the tables used here
        return None
    return v


def read_acs(path: str, prefixes: tuple[str, ...] = ("0400000US", "0500000US", "1600000US", "0100000US")) -> dict[str, dict[str, float | None]]:
    """GEO_ID -> {column: value} for a stored subset file (pipe-delimited, gzip)."""
    out: dict[str, dict[str, float | None]] = {}
    with gzip.open(path, "rt", encoding="utf-8") as h:
        header = h.readline().rstrip("\n").split("|")
        for line in h:
            parts = line.rstrip("\n").split("|")
            if len(parts) != len(header) or not parts[0].startswith(prefixes):
                continue
            # MOE annotation -555555555: the estimate is controlled to official totals, so its sampling error is zero.
            out[parts[0]] = {header[i]: 0.0 if parts[i].strip() == "-555555555" and "_M" in header[i] else acs_value(parts[i])
                             for i in range(1, len(header))}
    return out


def read_shells(path: str) -> dict[str, str]:
    """Unique ID (e.g. B19013_001) -> label, from the ACS table shells file."""
    out: dict[str, str] = {}
    with open(path, encoding="utf-8", errors="replace") as h:
        h.readline()
        for line in h:
            p = line.rstrip("\n").split("|")
            if len(p) >= 5 and p[3]:
                out[p[3]] = p[4].strip()
    return out


def geo_county(geo_id: str) -> str | None:
    return geo_id[9:14] if geo_id.startswith("0500000US") and len(geo_id) == 14 else None


def geo_place(geo_id: str) -> str | None:
    return geo_id[9:16] if geo_id.startswith("1600000US") and len(geo_id) == 16 else None


def geo_state(geo_id: str) -> str | None:
    return geo_id[9:11] if geo_id.startswith("0400000US") and len(geo_id) == 11 else None


def ratio(num: float | None, den: float | None, scale: float = 100.0) -> float | None:
    if num is None or den is None or den <= 0:
        return None
    return num / den * scale


def sum_cells(row: dict[str, float | None], cols: list[str]) -> float | None:
    vals = [row.get(c) for c in cols]
    if any(v is None for v in vals):
        return None
    return float(sum(vals))  # type: ignore[arg-type]


# ---------------------------------------------------------------- Census population estimates, gazetteer

def read_pep_counties(path: str) -> tuple[dict[str, dict[int, int]], dict[str, str]]:
    """co-est2025-alldata.csv -> ({county fips: {year: July 1 estimate}}, {county fips: CTYNAME}); state rows keyed by 2-digit fips."""
    pops: dict[str, dict[int, int]] = {}
    names: dict[str, str] = {}
    with open(path, encoding="latin-1") as h:
        for row in csv.DictReader(h):
            st, co, lev = row["STATE"], row["COUNTY"], row["SUMLEV"]
            key = st if lev == "040" else st + co if lev == "050" else None
            if key is None:
                continue
            series = {}
            for y in range(2020, 2026):
                v = row.get(f"POPESTIMATE{y}", "")
                if v.strip().isdigit():
                    series[y] = int(v)
            pops[key] = series
            names[key] = row["CTYNAME"]
    return pops, names


def read_gazetteer(path: str) -> list[dict[str, str]]:
    z = zipfile.ZipFile(path)
    with z.open(z.namelist()[0]) as h:
        text = io.TextIOWrapper(h, encoding="utf-8", errors="replace")
        reader = csv.reader(text, delimiter="\t")
        header = [c.strip() for c in next(reader)]
        return [{header[i]: (r[i].strip() if i < len(r) else "") for i in range(len(header))} for r in reader]


# ---------------------------------------------------------------- BLS LAUS and BEA

def read_laus(path: str, years: range) -> dict[str, dict[str, dict[int, float]]]:
    """la.data.64.County(.gz) -> {county fips: {measure: {year: annual average}}} for measures 03 (rate), 04, 05, 06."""
    opener = gzip.open if path.endswith(".gz") else open
    out: dict[str, dict[str, dict[int, float]]] = {}
    with opener(path, "rt", encoding="utf-8") as h:  # type: ignore[operator]
        h.readline()
        for line in h:
            p = line.split("\t")
            if len(p) < 4:
                continue
            sid, year, period, value = p[0].strip(), p[1].strip(), p[2].strip(), p[3].strip()
            if period != "M13" or not sid.startswith("LAUCN") or len(sid) != 20:
                continue
            m = re.fullmatch(r"LAUCN(\d{5})0{8}(\d{2})", sid)
            if not m or not year.isdigit() or int(year) not in years:
                continue
            try:
                v = float(value)
            except ValueError:
                continue  # "-" (not available) stays absent
            out.setdefault(m.group(1), {}).setdefault(m.group(2), {})[int(year)] = v
    return out


def read_bea_cainc1(path: str, years: range) -> dict[str, dict[str, dict[int, float]]]:
    """CAINC1 ALL_AREAS -> {GeoFIPS: {'income'|'population'|'per_capita': {year: value}}}; '(NA)', '(D)' and blanks dropped."""
    lines = {"1": "income", "2": "population", "3": "per_capita"}
    z = zipfile.ZipFile(path)
    name = next(n for n in z.namelist() if n.startswith("CAINC1__ALL_AREAS") and n.endswith(".csv"))
    out: dict[str, dict[str, dict[int, float]]] = {}
    with z.open(name) as h:
        reader = csv.reader(io.TextIOWrapper(h, encoding="latin-1"))
        header = next(reader)
        for r in reader:
            if len(r) < len(header):
                continue
            fips = r[0].strip().strip('"').strip()
            code = r[4].strip()
            if not re.fullmatch(r"\d{5}", fips) or code not in lines:
                continue
            series = {}
            for i, col in enumerate(header):
                if col.isdigit() and int(col) in years:
                    try:
                        series[int(col)] = float(r[i])
                    except ValueError:
                        pass
            out.setdefault(fips, {})[lines[code]] = series
    return out


# ---------------------------------------------------------------- ZCTA relationships

def read_zcta_county(path: str) -> dict[str, list[tuple[str, int]]]:
    """2020 ZCTA-to-county relationship -> {zcta: [(county fips, land area of the part in m^2)]} (water-only parts kept with 0)."""
    out: dict[str, list[tuple[str, int]]] = {}
    with open(path, encoding="utf-8-sig") as h:
        reader = csv.DictReader(h, delimiter="|")
        for r in reader:
            z, c = r["GEOID_ZCTA5_20"], r["GEOID_COUNTY_20"]
            if not re.fullmatch(r"\d{5}", z or "") or not re.fullmatch(r"\d{5}", c or ""):
                continue
            land = int(r["AREALAND_PART"] or 0)
            out.setdefault(z, []).append((c, land))
    return out


def assign_zcta(parts: list[tuple[str, int]]) -> tuple[str | None, bool]:
    """(county, whole): the county holding the largest land share of the ZCTA, and whether the ZCTA lies in that county alone.

    Ties on land area are left unassigned (None) rather than broken arbitrarily.
    """
    land = [(c, a) for c, a in parts if a > 0] or parts
    counties = {c for c, _ in land}
    if len(counties) == 1:
        return next(iter(counties)), True
    best = max(a for _, a in land)
    top = sorted({c for c, a in land if a == best})
    if len(top) != 1:
        return None, False
    return top[0], False


def zip5(text: str) -> str | None:
    t = (text or "").strip()
    m = re.match(r"^(\d{5})(?:-\d{4})?$", t)
    return m.group(1) if m else None


# ---------------------------------------------------------------- 28 U.S.C. chapter 5

REGION_LETTER = {"Northern": "n", "Southern": "s", "Eastern": "e", "Western": "w", "Middle": "m", "Central": "c"}
_SECTION = re.compile(r'<h3 class="section-head">(.*?)</h3>(.*?)(?=<h3 class="section-head">|\Z)', re.S)


def _text(fragment: str) -> str:
    return html.unescape(re.sub(r"<[^>]+>", "", fragment)).replace("—", "-").strip()


def _split_top(text: str) -> list[str]:
    """Split on commas that are not inside parentheses."""
    parts, depth, cur = [], 0, []
    for ch in text:
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth = max(0, depth - 1)
        if ch == "," and depth == 0:
            parts.append("".join(cur))
            cur = []
        else:
            cur.append(ch)
    parts.append("".join(cur))
    return parts


def split_names(text: str) -> list[str]:
    """'A, B, and C' / 'A and B' / 'A' -> ['A', 'B', 'C'] (top-level commas and a leading 'and' on the last item)."""
    t = text.strip().rstrip(".;").strip()
    parts = [p.strip() for p in _split_top(t) if p.strip()]
    if not parts:
        return []
    serial = parts[-1].startswith("and ")  # '..., and York': the last item is complete (it may itself contain 'and')
    parts[-1] = re.sub(r"^and\s+", "", parts[-1]).strip()
    last = parts[-1]
    if not serial and "(" not in last:
        m = re.fullmatch(r"(.+)\s+and\s+(.+)", last)  # 'Hampton and Williamsburg' (no serial comma): split at the last 'and'
        if m:
            parts[-1:] = [m.group(1).strip(), m.group(2).strip()]
    return [p for p in parts if p]


def strip_exception(name: str) -> tuple[str, str | None]:
    """'Durham (excluding that portion ...)' -> ('Durham', 'excluding that portion ...')."""
    m = re.fullmatch(r"(.*?)\s*\((.*)\)\s*", name)
    return (m.group(1).strip(), m.group(2).strip()) if m else (name.strip(), None)


def parse_composition(sentence: str) -> dict:
    """Extract named counties/parishes/cities from one 'comprises ...' sentence of 28 U.S.C. ch. 5.

    Recognised forms (exactly as the Code words them): 'the counties of X, Y, and Z', 'the county of X', 'the parishes of ...',
    'X County', and a trailing 'and the city of X' / 'and the City of X' / 'and the cities of X and Y'. Anything after
    'and concurrently' (shared jurisdiction over waters) is not territory and is ignored. Clauses naming only *portions* of
    counties ('those portions of ... encompassing ...') are returned verbatim in 'partial' and assign no whole county; a
    parenthetical exception after a county name is returned in 'exceptions'.
    """
    s = sentence.split(" and concurrently")[0]
    m = re.search(r"compris\w*\s+(.*)$", s)
    if not m:
        return {}
    rest = m.group(1).strip().rstrip(".")
    out: dict = {"counties": [], "cities": [], "partial": [], "exceptions": {}}
    part = re.search(r",\s+(?:those portions? of|that portion of)\s+.*$", rest)
    if part:
        out["partial"].append(part.group(0).lstrip(", ").strip())
        rest = rest[: part.start()]
    city = re.search(r",?\s+and the cit(?:y|ies) of\s+(.*)$", rest, re.I)
    if city:
        out["cities"] = split_names(city.group(1))
        rest = rest[: city.start()]
    cm = re.match(r"the (?:counties|county|parishes|parish) of\s+(.*)$", rest, re.I)
    names: list[str] = []
    if cm:
        names = split_names(cm.group(1))
    else:
        one = re.fullmatch(r"([A-Z][A-Za-z .'-]+) County", rest.strip())
        if not one:
            return {}
        names = [one.group(1)]
    for n in names:
        base, exc = strip_exception(n)
        out["counties"].append(base)
        if exc:
            out["exceptions"][base] = exc
    return out


def parse_usc_chapter5(page: str) -> list[dict]:
    """Sections 81-131 -> [{section, state, districts: [{name, court_suffix, single, divisions: [{name, counties, cities, held_at}]}]}]."""
    out = []
    for head, body in _SECTION.findall(re.sub(r"<!--.*?-->", "", page, flags=re.S)):
        h = _text(head)
        m = re.match(r"§(\d+A?)\.\s+(.*?)\.?$", h)
        if not m or m.group(2) not in NAME_TO_USPS:
            continue
        sec, state = m.group(1), m.group(2)
        statutory = body.split('<p class="source-credit">')[0]
        blocks = re.findall(r'(<h3 class="analysis-subhead">.*?</h3>|<p class="statutory[^"]*">.*?</p>)', statutory, re.S)
        districts: list[dict] = []
        current: dict | None = None
        single = False
        for b in blocks:
            t = _text(b)
            if b.startswith("<h3"):
                rm = re.match(r"(Northern|Southern|Eastern|Western|Middle|Central) District", t)
                current = {"name": t, "court_suffix": REGION_LETTER[rm.group(1)] if rm else None, "divisions": []}
                districts.append(current)
                continue
            dname = state if state == "District of Columbia" else f"District of {state}"
            if re.search(r"constitutes? one judicial district", t) and current is None:
                single = True
                current = {"name": dname, "court_suffix": "", "divisions": [], "whole_state": True, "text": t}
                districts.append(current)
                continue
            if current is None and re.search(r"comprising \w+ divisions|divided into", t):
                # single district with divisions (e.g. Minnesota): the district is the whole state
                if "comprising" in t:
                    single = True
                    current = {"name": dname, "court_suffix": "", "divisions": [], "whole_state": True, "text": t}
                    districts.append(current)
                continue
            if current is None:
                continue
            comp = parse_composition(t) if "compris" in t else {}
            if comp:
                head_text = t.split("compris")[0]
                dm = re.search(r"The\s+([A-Z][A-Za-z ]*?)\s+Division\s+$", head_text)
                current["divisions"].append({"name": (dm.group(1) + " Division") if dm else current["name"],
                                             "counties": comp["counties"], "cities": comp["cities"], "partial": comp["partial"],
                                             "exceptions": comp["exceptions"], "held_at": [], "text": t})
                continue
            hm = re.match(r"Court for the .*? shall be held at (.*)$", t)
            if hm and current["divisions"]:
                current["divisions"][-1]["held_at"] = held_places(hm.group(1))
            elif hm and current.get("whole_state"):
                current.setdefault("held_at", held_places(hm.group(1)))
        out.append({"section": sec, "state": state, "usps": NAME_TO_USPS[state], "single": single, "districts": districts})
    return out


def held_places(text: str) -> list[str]:
    """'Court ... shall be held at A, B, and C.' -> place names as written (footnote digits removed, duplicates dropped)."""
    t = re.sub(r"(?<=[a-z])\d+", "", text).rstrip(".")
    seen: list[str] = []
    for p in split_names(t):
        if p not in seen:
            seen.append(p)
    return seen


def norm_county(name: str) -> str:
    """Deterministic key for matching a county name as the Code writes it to a Census county name in the same state.

    Lower-case; the Census legal/statistical-area suffix removed (County, Parish, Borough, Census Area, Municipality, City and
    Borough); 'Saint'/'St.' unified to 'st', 'Sainte'/'Ste.' to 'ste'; spaces, periods, hyphens and apostrophes removed.
    """
    t = name.strip().lower()
    t = re.sub(r"\s+(county|parish|borough|census area|municipality|city and borough|planning region)$", "", t)
    t = re.sub(r"\bsainte\b", "ste", t)
    t = re.sub(r"\bsaint\b", "st", t)
    t = re.sub(r"\bste\.", "ste", t)
    t = re.sub(r"\bst\.", "st", t)
    return re.sub(r"[\s.'’-]", "", t)
