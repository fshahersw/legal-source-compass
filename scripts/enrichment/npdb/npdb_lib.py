"""Parsing, attribution and disclosure-control helpers for the NPDB Public Use Data File (PUF) builder.

Pure functions only (no network, no corpus access) so the unit tests can exercise them on synthetic fixtures.
"""
import collections
import html.parser
import math

MIN_CELL = 10  # publish only cells with >= 10 reports (stream rule; NPDB publishes no stricter numeric rule)

# 50 states + DC: the only codes with a /places/<USPS> page in the app (src/lib/corpus/geo.ts STATES).
PLACE_CODES = frozenset(
    "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK "
    "OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split()
)
TERRITORY_CODES = frozenset("PR GU VI AS MP FM MH PW".split())
MILITARY_CODES = frozenset("AA AE AP".split())
NOT_RECORDED = "Not recorded"
UNASSIGNED = "NR"


def area_kind(code):
    if code in PLACE_CODES:
        return "state"
    if code in TERRITORY_CODES:
        return "territory"
    if code in MILITARY_CODES:
        return "military"
    if code == UNASSIGNED:
        return "unrecorded"
    return "other"


def place_link(code, name):
    """Root-relative state link only on an exact USPS key the app serves."""
    return {"label": f"{name} state page", "url": f"/places/{code}"} if code in PLACE_CODES else None


# ---------------------------------------------------------------- codebook parsing (format specification HTML)

class _Tables(html.parser.HTMLParser):
    """Collect every <table summary="..."> as a list of rows (lists of cell texts)."""

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.tables = collections.OrderedDict()
        self._name = None
        self._row = None
        self._cell = None
        self._attrs = None

    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == "table":
            self._name = (attrs.get("summary") or attrs.get("id") or "").strip()
            self.tables.setdefault(self._name, [])
        elif tag == "tr" and self._name is not None:
            self._row = []
        elif tag in ("td", "th") and self._row is not None:
            self._cell = []
            self._attrs = attrs

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self._cell is not None:
            self._row.append((" ".join("".join(self._cell).split()), self._attrs))
            self._cell = None
        elif tag == "tr" and self._row is not None:
            if self._row:
                self.tables[self._name].append(self._row)
            self._row = None
        elif tag == "table":
            self._name = None

    def handle_data(self, data):
        if self._cell is not None:
            self._cell.append(data)


def parse_tables(raw_html):
    parser = _Tables()
    parser.feed(raw_html)
    return parser.tables


def parse_codebook(raw_html):
    """{VARIABLE: {code: label}} from the PUF format specification page (value/label tables)."""
    book = {}
    for name, rows in parse_tables(raw_html).items():
        key = name.strip().upper()
        if not key or " " in key:
            continue  # layout table and "... Codes with Major Text Changes" tables
        codes = {}
        for row in rows:
            cells = [text for text, _ in row]
            if len(cells) < 2 or cells[0].lower() == "value" or cells[0].startswith("("):
                continue
            codes[cells[0]] = cells[1]
        book[key] = codes
    for var, src in (("HOMESTAT", "WORKSTAT"), ("LICNSTAT", "WORKSTAT"), ("ALEGATN2", "ALEGATN1")):
        if not book.get(var):
            book[var] = dict(book.get(src, {}))
    return book


def parse_practitioner_types(raw_html):
    """NPDB Data Analysis Tool 'Practitioner Type' table: {LICNFELD int: practitioner type}."""
    tables = parse_tables(raw_html)
    rows = next((rows for name, rows in tables.items() if "Practitioner Type" in name), [])
    mapping, group = {}, None
    for row in rows:
        cells = [text for text, _ in row]
        if cells and cells[0] == "Practitioner Type":
            continue
        if len(cells) == 3:
            group, code = cells[0], cells[1]
        elif len(cells) == 2:
            code = cells[0]
        else:
            continue
        if group and code.isdigit():
            mapping[int(code)] = group
    return mapping


# ---------------------------------------------------------------- field parsing

def payment(value):
    """'$97500' -> 97500.0 (NPDB coded midpoint); '' -> None."""
    value = (value or "").strip().replace("$", "").replace(",", "")
    return float(value) if value else None


def year(value):
    value = (value or "").strip()
    return int(value) if value.isdigit() and len(value) == 4 else None


def delay_years(orig_year, act_year):
    """Whole years from act/omission (MALYEAR1) to report processing (ORIGYEAR); None when the act year is
    missing or outside 1900..ORIGYEAR (the spec notes erroneous years such as 3999 are recorded as reported)."""
    if orig_year is None or act_year is None or act_year < 1900 or act_year > orig_year:
        return None
    return orig_year - act_year


def mmpr_state(row):
    """NPDB's documented assignment for non-licensure reports: work state if reported, else home state."""
    if row.get("WORKSTAT", "").strip():
        return row["WORKSTAT"].strip(), "work state"
    if row.get("HOMESTAT", "").strip():
        return row["HOMESTAT"].strip(), "home state (no work state reported)"
    return UNASSIGNED, "no work or home state reported"


LICENSURE_REPTYPES = frozenset({"301", "302", "1302"})


def aa_state(row):
    """Licensure actions: license state (NPDB note), else work, else home. Other actions: work, else home."""
    rep = row.get("REPTYPE", "").strip()
    if rep in LICENSURE_REPTYPES and row.get("LICNSTAT", "").strip():
        return row["LICNSTAT"].strip(), "license state"
    if row.get("WORKSTAT", "").strip():
        return row["WORKSTAT"].strip(), "work state"
    if row.get("HOMESTAT", "").strip():
        return row["HOMESTAT"].strip(), "home state"
    return UNASSIGNED, "no state reported"


def practitioner_type(licnfeld, mapping):
    value = (licnfeld or "").strip()
    if not value:
        return NOT_RECORDED
    code = int(value)
    if code in mapping:
        return mapping[code]
    if code >= 1300:
        return "Organization / entity (not an individual practitioner)"
    if code in (998, 999):
        return "Subject unspecified or not reportable (LICNFELD 998/999)"
    return "Individual outside NPDB practitioner types"


PAYER_GROUPS = {
    "1": "Insurance company (primary; legacy code 1 or P)",
    "P": "Insurance company (primary; legacy code 1 or P)",
    "E": "Insurance company - excess insurer (E)",
    "2": "Insurance guaranty fund (2 or G)",
    "G": "Insurance guaranty fund (2 or G)",
    "3": "Self-insured organization (3 or S)",
    "S": "Self-insured organization (3 or S)",
    "4": "State medical malpractice fund (4, M or O)",
    "M": "State medical malpractice fund (4, M or O)",
    "O": "State medical malpractice fund (4, M or O)",
}


def payer_group(code):
    return PAYER_GROUPS.get((code or "").strip(), NOT_RECORDED)


def judgment(paytype):
    """NPDB recommends treating every PAYTYPE except J as a settlement of one type or another."""
    code = (paytype or "").strip()
    if not code:
        return NOT_RECORDED
    return "Judgment" if code == "J" else "Settlement or other (S, B, O, U)"


SEVERITY_GROUPS = {
    "1": "Emotional or insignificant injury (1-2)", "2": "Emotional or insignificant injury (1-2)",
    "3": "Temporary injury (3-4)", "4": "Temporary injury (3-4)",
    "5": "Permanent injury, minor to major (5-7)", "6": "Permanent injury, minor to major (5-7)",
    "7": "Permanent injury, minor to major (5-7)",
    "8": "Quadriplegic, brain damage, lifelong care (8)",
    "9": "Death (9)",
    "10": "Cannot be determined from available records (10)",
}
LEGACY_OUTCOME = "Not recorded (legacy report format before 1/31/2004)"


def severity_group(outcome, rectype):
    code = (outcome or "").strip()
    if not code:
        return LEGACY_OUTCOME if rectype == "M" else NOT_RECORDED
    return SEVERITY_GROUPS.get(code, NOT_RECORDED)


BANDS = [
    (10_000, "$10,000 or less"),
    (50_000, "$10,001-$50,000"),
    (100_000, "$50,001-$100,000"),
    (250_000, "$100,001-$250,000"),
    (500_000, "$250,001-$500,000"),
    (1_000_000, "$500,001-$1,000,000"),
    (5_000_000, "$1,000,001-$5,000,000"),
    (math.inf, "More than $5,000,000"),
]


def band(coded):
    """Band of a coded payment. NPDB coding intervals nest inside these limits, so a coded midpoint below a limit
    means the actual payment is at or below it."""
    if coded is None:
        return NOT_RECORDED
    for limit, label in BANDS:
        if coded < limit or (limit == math.inf):
            return label
    return NOT_RECORDED


# AA report types (REPTYPE) -> type group and subject.
AA_TYPES = {
    "301": ("licensure", "individual"), "302": ("licensure", "individual"), "1302": ("licensure", "organization"),
    "401": ("clinical_privileges", "individual"), "402": ("clinical_privileges", "individual"),
    "451": ("health_plan", "individual"), "1451": ("health_plan", "organization"),
    "501": ("professional_society", "individual"), "502": ("professional_society", "individual"),
    "601": ("dea", "individual"), "602": ("dea", "individual"), "1602": ("dea", "organization"),
    "604": ("government_administrative", "individual"), "1604": ("government_administrative", "organization"),
    "1603": ("federal_licensure", "organization"),
    "702": ("exclusion_hhs_oig", "individual"), "1702": ("exclusion_hhs_oig", "organization"),
    "703": ("exclusion_debarment_other", "individual"), "1703": ("exclusion_debarment_other", "organization"),
    "1803": ("accreditation", "organization"),
}
AA_TYPE_LABELS = {
    "licensure": "State licensure or certification action",
    "clinical_privileges": "Clinical privileges or panel membership action",
    "health_plan": "Health plan action",
    "professional_society": "Professional society membership action",
    "dea": "Drug Enforcement Administration (DEA) action",
    "government_administrative": "Government administrative action",
    "federal_licensure": "Federal licensure action (organizations)",
    "exclusion_hhs_oig": "HHS-OIG exclusion (Medicare/Medicaid)",
    "exclusion_debarment_other": "Exclusion or debarment, non-HHS",
    "accreditation": "Accreditation action (organizations)",
    "other": "Other report type",
}


def aa_type(reptype):
    return AA_TYPES.get((reptype or "").strip(), ("other", "individual"))


# ---------------------------------------------------------------- aggregation

def median_from_counter(counter):
    """Exact median of a multiset given as {value: count}: middle value, or mean of the two middle values."""
    n = sum(counter.values()) if counter else 0
    if n == 0:
        return None
    lo_idx, hi_idx = (n - 1) // 2, n // 2
    seen, lo, hi = 0, None, None
    for value in sorted(counter):
        count = counter[value]
        if lo is None and seen + count > lo_idx:
            lo = value
        if seen + count > hi_idx:
            hi = value
            break
        seen += count
    return (lo + hi) / 2


class Agg:
    """Count of reports plus multisets of coded payments and delays (NPDB codes payments to ~220 midpoints)."""

    __slots__ = ("n", "pay", "delay", "dims")

    def __init__(self):
        self.n = 0
        self.pay = None  # Counter {coded payment: reports}, created on first payment
        self.delay = None  # Counter {whole years: reports}
        self.dims = None  # {dimension: {key: Agg}}

    def add(self, pay=None, delay=None, dims=None):
        self.n += 1
        if pay is not None:
            if self.pay is None:
                self.pay = collections.Counter()
            self.pay[pay] += 1
        if delay is not None:
            if self.delay is None:
                self.delay = collections.Counter()
            self.delay[delay] += 1
        if dims:
            for dim, key in dims.items():
                self.sub(dim, key).add(pay, delay)

    def sub(self, dim, key):
        if self.dims is None:
            self.dims = {}
        table = self.dims.setdefault(dim, {})
        agg = table.get(key)
        if agg is None:
            agg = table[key] = Agg()
        return agg

    def table(self, dim):
        return (self.dims or {}).get(dim, {})

    def merge(self, other):
        self.n += other.n
        if other.pay:
            self.pay = (self.pay or collections.Counter()) + other.pay
        if other.delay:
            self.delay = (self.delay or collections.Counter()) + other.delay

    @property
    def n_amount(self):
        return sum(self.pay.values()) if self.pay else 0

    @property
    def n_delay(self):
        return sum(self.delay.values()) if self.delay else 0

    @property
    def total(self):
        return sum(value * count for value, count in self.pay.items()) if self.pay else 0.0


def stats(agg, money=True, min_cell=MIN_CELL):
    """Published statistics for one cell; cells with 1..min_cell-1 reports are suppressed (values None)."""
    if 0 < agg.n < min_cell:
        return {"n": None, "suppressed": True}
    out = {"n": agg.n}
    if money:
        n_amount = agg.n_amount
        total = agg.total
        out.update({
            "n_amount": n_amount,
            "total": round(total, 2) if n_amount else None,
            "mean": round(total / n_amount, 2) if n_amount >= min_cell else None,
            "median": median_from_counter(agg.pay) if n_amount >= min_cell else None,
        })
        n_delay = agg.n_delay
        out["delay_n"] = n_delay if n_delay >= min_cell else None
        out["delay_median"] = median_from_counter(agg.delay) if n_delay >= min_cell else None
    return out


COMBINED_KEY = "_combined"
COMBINED_LABEL = "Suppressed or withheld categories (combined)"


def fold(cells, min_cell=MIN_CELL):
    """Complementary suppression for one breakdown that sums to a shown total.

    Categories with 1..min_cell-1 reports are pooled into one combined cell; while that pool holds 1..min_cell-1
    reports the smallest remaining category (ties by key) is moved into it, so no published cell is below the
    threshold and no suppressed category can be recovered by subtracting published cells from the total.
    Returns (published {key: Agg}, combined Agg or None, [folded keys]).
    """
    live = {k: a for k, a in cells.items() if a.n > 0}
    small = sorted((k for k, a in live.items() if a.n < min_cell), key=mixed_key)
    published = {k: a for k, a in live.items() if a.n >= min_cell}
    folded = list(small)
    pool = Agg()
    for key in small:
        pool.merge(live[key])
    while 0 < pool.n < min_cell and published:
        key = min(published, key=lambda k: (published[k].n, mixed_key(k)))
        pool.merge(published.pop(key))
        folded.append(key)
    if pool.n == 0:
        return published, None, []
    return published, pool, sorted(folded, key=mixed_key)


def mixed_key(key):
    """Deterministic order for keys mixing numbers (years) and strings ('Not recorded')."""
    return (0, key, "") if isinstance(key, (int, float)) else (1, 0, str(key))


def breakdown(agg, dim, labels=None, money=True, order=None, total=None, min_cell=MIN_CELL):
    """Published rows for one dimension of an Agg, with complementary suppression and shares of the total."""
    cells = agg.table(dim)
    published, pool, folded = fold(cells, min_cell)
    base = total if total is not None else agg.n
    rows = []
    keys = sorted(published, key=order) if order else sorted(published, key=lambda k: (-published[k].n, str(k)))
    for key in keys:
        cell = stats(published[key], money, min_cell)
        cell["key"] = key
        if callable(labels):
            cell["label"] = labels(key)
        else:
            cell["label"] = (labels or {}).get(key, key) if labels is not None else key
        cell["share"] = round(published[key].n / base, 4) if base else None
        rows.append(cell)
    if pool is not None:
        cell = stats(pool, money, min_cell) if pool.n >= min_cell else {"n": None, "suppressed": True}
        cell.update({"key": COMBINED_KEY, "label": COMBINED_LABEL, "folded": len(folded), "folded_keys": list(folded),
                     "share": round(pool.n / base, 4) if (base and pool.n >= min_cell) else None})
        rows.append(cell)
    return rows


def death_share(agg, min_cell=MIN_CELL):
    """Deaths (OUTCOME 9) as a share of reports whose severity was recorded (OUTCOME exists only on RECTYPE P reports,
    from 1/31/2004). None unless both counts are at least min_cell; never uses reports without a recorded severity."""
    recorded = agg.table("outcome_recorded").get("yes")
    deaths = agg.table("severity").get("Death (9)")
    if recorded is None or deaths is None or recorded.n < min_cell or deaths.n < min_cell:
        return None
    return round(deaths.n / recorded.n, 4)


SUPPRESSED_SHARE = "Suppressed (fewer than 10 reports)"


def share_text(rows, key):
    """Display text for one category's share of a breakdown: a percentage, '0.0%' when the category has no
    reports, the suppression notice when it was pooled into the combined cell, 'Not recorded' with no breakdown."""
    if not rows:
        return NOT_RECORDED
    cell = next((r for r in rows if r.get("key") == key), None)
    if cell is not None and cell.get("share") is not None:
        return "{:.1f}%".format(cell["share"] * 100)
    pool = next((r for r in rows if r.get("key") == COMBINED_KEY), None)
    if pool is not None and key in pool.get("folded_keys", ()):
        return SUPPRESSED_SHARE
    return "0.0%" if cell is None else NOT_RECORDED


def published_cells(obj):
    """Yield every dict with an 'n' entry anywhere in a nested structure (used by the disclosure audit)."""
    if isinstance(obj, dict):
        if "n" in obj and (obj["n"] is None or isinstance(obj["n"], int)):
            yield obj
        for value in obj.values():
            yield from published_cells(value)
    elif isinstance(obj, list):
        for value in obj:
            yield from published_cells(value)


def cagr(start, end, years):
    """Compound annual growth rate (end/start)^(1/years) - 1; None when undefined."""
    if not start or not end or years <= 0:
        return None
    return round((end / start) ** (1 / years) - 1, 5)


def pct_change(start, end):
    if not start or end is None:
        return None
    return round((end - start) / start, 5)


def ranks(values):
    """Competition ranking (1 = highest) over {key: value}; None values are unranked."""
    present = sorted(((v, k) for k, v in values.items() if v is not None), key=lambda t: (-t[0], t[1]))
    out, last, last_rank = {}, None, 0
    for index, (value, key) in enumerate(present, 1):
        if value != last:
            last_rank, last = index, value
        out[key] = last_rank
    return out, len(present)


def match_state_name(name, table):
    """Unique exact match of a state name to a code after case/whitespace normalisation; None when absent or ambiguous."""
    norm = " ".join((name or "").split()).casefold()
    hits = sorted({code for code, label in table.items() if " ".join(label.split()).casefold() == norm})
    return hits[0] if len(hits) == 1 else None


def money(value):
    return NOT_RECORDED if value is None else "${:,.0f}".format(value)


def count_text(cell):
    if cell.get("suppressed"):
        return "Fewer than 10 reports (suppressed)"
    return "{:,}".format(cell["n"])


def parse_dat_practitioners(csv_text):
    """NPDB Data Analysis Tool 'NPDB Practitioners' CSV export -> [{type, practitioners}] largest first.

    Values are published with thousands separators ("258,182"); a blank or non-numeric count becomes None and the
    type is kept so the caller can show it as Not recorded rather than inventing a number."""
    import csv
    import io

    out = []
    for row in csv.DictReader(io.StringIO(csv_text)):
        label = (row.get("Practitioner Type") or "").strip()
        if not label:
            continue
        raw = (row.get("NPDB Practitioners") or "").replace(",", "").strip()
        out.append({"type": label, "practitioners": int(raw) if raw.isdigit() else None})
    return sorted(out, key=lambda d: (-(d["practitioners"] or -1), d["type"]))
