"""Pure parsers for the state-metrics lane. Each returns {usps: {year: value}} keyed by the 50 states + DC.

Nothing here guesses: blank, suppressed or non-numeric cells become None (or are omitted), and a jurisdiction
is only kept when its official code maps exactly to one of the 51 jurisdictions below.
"""
import csv
import io
import re
import zipfile
from collections import defaultdict

# FIPS, USPS, name (50 states + DC); identical to src/lib/corpus/geo.ts STATES.
STATES = [
    ("01", "AL", "Alabama"), ("02", "AK", "Alaska"), ("04", "AZ", "Arizona"), ("05", "AR", "Arkansas"),
    ("06", "CA", "California"), ("08", "CO", "Colorado"), ("09", "CT", "Connecticut"), ("10", "DE", "Delaware"),
    ("11", "DC", "District of Columbia"), ("12", "FL", "Florida"), ("13", "GA", "Georgia"), ("15", "HI", "Hawaii"),
    ("16", "ID", "Idaho"), ("17", "IL", "Illinois"), ("18", "IN", "Indiana"), ("19", "IA", "Iowa"),
    ("20", "KS", "Kansas"), ("21", "KY", "Kentucky"), ("22", "LA", "Louisiana"), ("23", "ME", "Maine"),
    ("24", "MD", "Maryland"), ("25", "MA", "Massachusetts"), ("26", "MI", "Michigan"), ("27", "MN", "Minnesota"),
    ("28", "MS", "Mississippi"), ("29", "MO", "Missouri"), ("30", "MT", "Montana"), ("31", "NE", "Nebraska"),
    ("32", "NV", "Nevada"), ("33", "NH", "New Hampshire"), ("34", "NJ", "New Jersey"), ("35", "NM", "New Mexico"),
    ("36", "NY", "New York"), ("37", "NC", "North Carolina"), ("38", "ND", "North Dakota"), ("39", "OH", "Ohio"),
    ("40", "OK", "Oklahoma"), ("41", "OR", "Oregon"), ("42", "PA", "Pennsylvania"), ("44", "RI", "Rhode Island"),
    ("45", "SC", "South Carolina"), ("46", "SD", "South Dakota"), ("47", "TN", "Tennessee"), ("48", "TX", "Texas"),
    ("49", "UT", "Utah"), ("50", "VT", "Vermont"), ("51", "VA", "Virginia"), ("53", "WA", "Washington"),
    ("54", "WV", "West Virginia"), ("55", "WI", "Wisconsin"), ("56", "WY", "Wyoming"),
]
BY_FIPS = {f: u for f, u, _ in STATES}
BY_USPS = {u: (f, n) for f, u, n in STATES}
BY_NAME = {n: u for _, u, n in STATES}
US = "US"
MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October",
          "November", "December"]


def number(text):
    """Parse an official numeric cell; returns None for blanks, footnote codes like (D)/(NA), or junk."""
    if text is None:
        return None
    t = str(text).strip().replace(",", "")
    if not t or not re.fullmatch(r"-?\d+(\.\d+)?", t):
        return None
    value = float(t)
    return int(value) if value.is_integer() and "." not in t else value


def _put(out, key, year, value):
    if value is not None:
        out[key][int(year)] = value


# ---------------------------------------------------------------- Census population estimates (NST-EST)
def census_population(text, first_year, last_year):
    """POPESTIMATE<year> columns of an NST-EST*-ALLDATA file; SUMLEV 010 is the nation, 040 the states."""
    out = defaultdict(dict)
    for row in csv.DictReader(io.StringIO(text)):
        level, fips = row.get("SUMLEV", "").strip(), row.get("STATE", "").strip().zfill(2)
        key = US if level == "010" else BY_FIPS.get(fips) if level == "040" else None
        if not key:
            continue
        for year in range(first_year, last_year + 1):
            _put(out, key, year, number(row.get(f"POPESTIMATE{year}")))
    return dict(out)


# ---------------------------------------------------------------- BEA regional ALL_AREAS tables
def bea_table(zip_bytes, prefix, line_code, first_year=2010):
    """One line of a BEA ALL_AREAS CSV (e.g. SAGDP1 line 3). GeoFIPS 00000 is the nation, SS000 a state."""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
        name = next(n for n in archive.namelist() if n.startswith(prefix + "__ALL_AREAS_") and n.endswith(".csv"))
        text = archive.read(name).decode("latin-1")
    rows = list(csv.reader(io.StringIO(text)))
    header = rows[0]
    years = [(i, int(h)) for i, h in enumerate(header) if re.fullmatch(r"\d{4}", h.strip()) and int(h) >= first_year]
    out, meta = defaultdict(dict), {"file": name, "updated": None, "description": None, "unit": None}
    for row in rows[1:]:
        if row and row[0].startswith("Last updated"):
            meta["updated"] = ",".join(row).strip()
            continue
        if len(row) < len(header):
            continue
        geo = row[0].replace('"', "").strip()
        if row[4].strip() != str(line_code) or not re.fullmatch(r"\d{5}", geo):
            continue
        key = US if geo == "00000" else BY_FIPS.get(geo[:2]) if geo.endswith("000") else None
        if not key:
            continue
        meta["description"], meta["unit"] = row[6].strip(), row[7].strip()
        for index, year in years:
            _put(out, key, year, number(row[index]))
    return dict(out), meta


# ---------------------------------------------------------------- BLS LAUS annual averages
def laus_annual(text, measure="03", first_year=2010):
    """Statewide LAUS series LAUST<SS>00000000000<MM> (not seasonally adjusted); M13 is the annual average."""
    out = defaultdict(dict)
    pattern = re.compile(r"LAUST(\d{2})0{11}(\d{2})$")
    for line in text.splitlines()[1:]:
        parts = [p.strip() for p in line.split("\t")]
        if len(parts) < 4:
            continue
        match = pattern.match(parts[0])
        if not match or match.group(2) != measure or parts[2] != "M13":
            continue
        key = BY_FIPS.get(match.group(1))
        if key and int(parts[1]) >= first_year:
            _put(out, key, parts[1], number(parts[3]))
    return dict(out)


# ---------------------------------------------------------------- CDC NCHS leading causes (bi63-dtpu)
def cause_slug(name):
    return re.sub(r"[^a-z0-9]+", "_", name.lower().replace("'", "")).strip("_")


def leading_causes(text):
    """{cause_slug: {"name": str, "code": str, "deaths": {usps: {year: n}}, "rate": {usps: {year: r}}}}."""
    causes = {}
    for row in csv.DictReader(io.StringIO(text)):
        state = row["State"].strip()
        key = US if state == "United States" else BY_NAME.get(state)
        if not key:
            continue
        slug = cause_slug(row["Cause Name"].strip())
        entry = causes.setdefault(slug, {"name": row["Cause Name"].strip(), "code": row["113 Cause Name"].strip(),
                                         "deaths": defaultdict(dict), "rate": defaultdict(dict)})
        _put(entry["deaths"], key, row["Year"], number(row["Deaths"]))
        _put(entry["rate"], key, row["Year"], number(row["Age-adjusted Death Rate"]))
    return {k: {**v, "deaths": dict(v["deaths"]), "rate": dict(v["rate"])} for k, v in causes.items()}


# ---------------------------------------------------------------- CDC VSRR provisional overdose (xkb8-kh2a)
def vsrr(text, indicator):
    """Calendar-year counts = the December '12 month-ending' reported value (jurisdiction of occurrence).

    New York State = the 'NY' row (which excludes New York City) plus the 'YC' row (New York City); it is only
    reported when both parts are present for that year. Returns (values, notes, latest) where notes holds the CDC
    footnote for flagged cells and latest is the most recent 12-month-ending period for each jurisdiction.
    """
    raw, notes, latest = defaultdict(dict), defaultdict(dict), {}
    for row in csv.DictReader(io.StringIO(text)):
        if row["Indicator"] != indicator or row["Period"] != "12 month-ending":
            continue
        code = row["State"].strip()
        if code not in BY_USPS and code not in (US, "YC"):
            continue
        month = MONTHS.index(row["Month"]) + 1
        value = number(row["Data Value"])
        stamp = (int(row["Year"]), month)
        if value is not None and (code not in latest or stamp > latest[code]["stamp"]):
            latest[code] = {"stamp": stamp, "value": value, "footnote": row["Footnote"].strip()}
        if month == 12:
            raw[code][int(row["Year"])] = value
            if value is not None and "Underreported" in row["Footnote"]:
                notes[code][int(row["Year"])] = "Underreported due to incomplete data (CDC footnote)."
    upstate, city = raw.pop("NY", {}), raw.pop("YC", {})
    raw["NY"] = {y: upstate[y] + city[y] for y in upstate if upstate.get(y) is not None and city.get(y) is not None}
    up_n, city_n = notes.pop("NY", {}), notes.pop("YC", {})
    notes["NY"] = {y: up_n.get(y) or city_n.get(y) for y in set(up_n) | set(city_n)}
    if "NY" in latest and "YC" in latest and latest["NY"]["stamp"] == latest["YC"]["stamp"]:
        latest["NY"] = {**latest["NY"], "value": latest["NY"]["value"] + latest["YC"]["value"]}
    else:
        latest.pop("NY", None)
    latest.pop("YC", None)
    values = {k: {y: v for y, v in years.items() if v is not None} for k, years in raw.items()}
    out_latest = {k: {"period": f"{v['stamp'][0]}-{v['stamp'][1]:02d}", "value": v["value"]} for k, v in latest.items()}
    return values, {k: v for k, v in notes.items() if v}, out_latest


# ---------------------------------------------------------------- NHTSA FARS accident file
def fars_fatalities(zip_bytes):
    """Sum of FATALS by STATE (FIPS) in accident.csv. Puerto Rico (72) and unknown codes are excluded."""
    with zipfile.ZipFile(io.BytesIO(zip_bytes)) as archive:
        name = next(n for n in archive.namelist() if n.lower().endswith("/accident.csv") or n.lower() == "accident.csv")
        raw = archive.read(name)
    text = raw[3:].decode("latin-1") if raw.startswith(b"\xef\xbb\xbf") else raw.decode("latin-1")
    reader = csv.DictReader(io.StringIO(text))
    reader.fieldnames = [f.strip().upper() for f in reader.fieldnames]
    totals, crashes = defaultdict(int), defaultdict(int)
    for row in reader:
        state = BY_FIPS.get(str(row["STATE"]).strip().zfill(2))
        fatals = number(row["FATALS"])
        if state and fatals is not None:
            totals[state] += fatals
            crashes[state] += 1
    return dict(totals), dict(crashes), name


# ---------------------------------------------------------------- NHTSA ODI complaints flat files
def nhtsa_complaints(lines):
    """Unique complaints (ODINO) by consumer STATE (field 14) and year received (LDATE, field 17).

    A complaint naming several components appears on several lines; it is counted once. Returns
    (counts, crash_counts, max_ldate).
    """
    seen = set()
    counts, crash = defaultdict(lambda: defaultdict(int)), defaultdict(lambda: defaultdict(int))
    max_date = ""
    for line in lines:
        f = line.rstrip("\r\n").split("\t")
        if len(f) < 17:
            continue
        odino, state, ldate = f[1].strip(), f[13].strip().upper(), f[16].strip()
        if not odino or odino in seen or not re.fullmatch(r"\d{8}", ldate):
            continue
        seen.add(odino)
        max_date = max(max_date, ldate)
        if state in BY_USPS:
            counts[state][int(ldate[:4])] += 1
            if f[6].strip() == "Y":
                crash[state][int(ldate[:4])] += 1
    return {k: dict(v) for k, v in counts.items()}, {k: dict(v) for k, v in crash.items()}, max_date


# ---------------------------------------------------------------- FDA enforcement entries from the corpus
def fda_enforcement(rows):
    """Enforcement-report entries by recalling-firm state and report_date year, with Class I counts."""
    total, class1 = defaultdict(lambda: defaultdict(int)), defaultdict(lambda: defaultdict(int))
    for row in rows:
        state = (row.get("state") or "").strip().upper()
        date = row.get("report_date") or ""
        if state not in BY_USPS or not re.fullmatch(r"\d{4}-\d{2}-\d{2}", date):
            continue
        if (row.get("country") or "United States") != "United States":
            continue
        year = int(date[:4])
        total[state][year] += 1
        if row.get("classification") == "Class I":
            class1[state][year] += 1
    return {k: dict(v) for k, v in total.items()}, {k: dict(v) for k, v in class1.items()}


# ---------------------------------------------------------------- derived statistics
def per_capita(counts, population, per):
    """counts / same-year population * per, rounded to 2 decimals; None when either side is missing."""
    out = {}
    for year, value in counts.items():
        pop = population.get(year)
        if value is not None and pop:
            out[year] = round(value / pop * per, 2)
    return out


def median(values):
    s = sorted(values)
    if not s:
        return None
    mid = len(s) // 2
    return s[mid] if len(s) % 2 else (s[mid - 1] + s[mid]) / 2


def quantile(values, q):
    s = sorted(values)
    if not s:
        return None
    pos = (len(s) - 1) * q
    lo = int(pos)
    hi = min(lo + 1, len(s) - 1)
    return s[lo] + (s[hi] - s[lo]) * (pos - lo)


def ranks_and_z(values):
    """{key: value} -> {key: (rank, z)}; rank 1 = highest (ties share the best rank); population SD."""
    items = {k: v for k, v in values.items() if v is not None}
    if not items:
        return {}
    ordered = sorted(items.values(), reverse=True)
    mean = sum(items.values()) / len(items)
    sd = (sum((v - mean) ** 2 for v in items.values()) / len(items)) ** 0.5
    return {k: (ordered.index(v) + 1, round((v - mean) / sd, 2) if sd else 0.0) for k, v in items.items()}


def change_pct(series, year, span=5):
    a, b = series.get(year - span), series.get(year)
    if a is None or b is None or a == 0:
        return None
    return round((b - a) / abs(a) * 100, 1)
