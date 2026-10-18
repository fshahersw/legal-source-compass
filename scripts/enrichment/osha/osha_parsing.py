"""Pure parsing and aggregation helpers for the OSHA enforcement builders (no I/O, no network)."""
import datetime
import math
import re

# Federal fiscal year N runs 1 October (N-1) through 30 September N.
FY_START_MONTH = 10

# Inspection type codes and labels as given in the DOL Open Data Portal field dictionary (OSHA inspection, dataset 10334).
INSP_TYPES = {
    "A": "Accident", "B": "Complaint", "C": "Referral", "D": "Monitoring", "E": "Variance", "F": "Follow-up",
    "G": "Unprogrammed related", "H": "Planned", "I": "Programmed related", "J": "Unprogrammed other",
    "K": "Programmed other", "L": "Other-L", "M": "Fatality/catastrophe", "N": "Unprogrammed emphasis",
}
# Programmed = scheduled/planned work (Planned, Programmed related, Programmed other). Unprogrammed = inspections
# triggered by an event or outside information (accident, complaint, referral, monitoring, follow-up, unprogrammed
# related/other/emphasis, fatality/catastrophe). Variance (E), Other-L (L) and blank stay "other / not classified".
PROGRAMMED = frozenset("HIK")
UNPROGRAMMED = frozenset("ABCDFGJMN")

INSP_SCOPES = {"A": "Complete", "B": "Partial", "C": "Records", "D": "No inspection"}
OWNER_TYPES = {"A": "Private", "B": "Local government", "C": "State government", "D": "Federal"}

# Violation types (osha.gov Inspection Information Search Help: Serious, Willful, Repeat, Other, Unclassified).
VIOL_TYPES = {"S": "serious", "W": "willful", "R": "repeat", "O": "other", "U": "unclassified"}
VIOL_KEYS = ("serious", "willful", "repeat", "other", "unclassified", "other_codes")

# NAICS sectors that span several two-digit codes (Census NAICS 2022 structure).
SECTOR_GROUPS = {"31": "31-33", "32": "31-33", "33": "31-33", "44": "44-45", "45": "44-45", "48": "48-49", "49": "48-49"}

PENALTY_BUCKETS = (
    ("0", 0.0, 0.0),
    ("1-999", 0.01, 999.99),
    ("1000-4999", 1000.0, 4999.99),
    ("5000-9999", 5000.0, 9999.99),
    ("10000-49999", 10000.0, 49999.99),
    ("50000-99999", 50000.0, 99999.99),
    ("100000-499999", 100000.0, 499999.99),
    ("500000+", 500000.0, math.inf),
)

_DATE = re.compile(r"^(\d{4})-(\d{2})-(\d{2})")


def clean(value):
    """Trim a CSV cell; the bulk export writes missing values as '', 'nan', 'NaN', 'NaT' or 'None'."""
    if value is None:
        return ""
    text = value.strip()
    return "" if text in ("nan", "NaN", "NaT", "None", "NULL") else text


def parse_date(value):
    """'2008-01-04 00:00:00+00:00' -> date(2008, 1, 4); blank/NaT/invalid -> None."""
    match = _DATE.match(clean(value))
    if not match:
        return None
    try:
        return datetime.date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError:
        return None


def fiscal_year(day):
    """Federal fiscal year of a date (FY2026 = 2025-10-01 .. 2026-09-30); None stays None."""
    if day is None:
        return None
    return day.year + 1 if day.month >= FY_START_MONTH else day.year


def money(value):
    """Penalty cell -> float dollars; blank/nan -> None (not zero)."""
    text = clean(value).replace(",", "").replace("$", "")
    if not text:
        return None
    try:
        amount = float(text)
    except ValueError:
        return None
    return None if math.isnan(amount) else amount


def int_or_none(value):
    text = clean(value)
    if not text:
        return None
    try:
        return int(float(text))
    except ValueError:
        return None


def inspection_class(code):
    code = clean(code)
    if code in PROGRAMMED:
        return "programmed"
    if code in UNPROGRAMMED:
        return "unprogrammed"
    return "other"


def jurisdiction(reporting_id):
    """'state_plan' when the third digit of the 7-digit reporting ID is 5 (a State Plan office), 'federal' for any
    other digit, None when the ID is missing. Derived rule; see the builder summary for its empirical check."""
    rid = clean(reporting_id)
    if len(rid) < 3 or not rid[2].isdigit():
        return None
    return "state_plan" if rid[2] == "5" else "federal"


def naics_sector(code):
    """Two-digit NAICS sector ('31-33' style for multi-code sectors); None when blank, zero-filled or malformed."""
    text = clean(code)
    if len(text) < 2 or not text[:2].isdigit() or set(text) <= {"0"}:
        return None
    two = text[:2]
    return SECTOR_GROUPS.get(two, two)


def viol_key(code):
    return VIOL_TYPES.get(clean(code).upper(), "other_codes")


def penalty_bucket(amount):
    amount = amount or 0.0
    for label, low, high in PENALTY_BUCKETS:
        if low <= amount <= high:
            return label
    # amounts between bucket edges (e.g. 999.995) fall to the bucket below the next lower bound
    for label, low, _ in reversed(PENALTY_BUCKETS):
        if amount >= low:
            return label
    return PENALTY_BUCKETS[0][0]


def median(values):
    """Median of a list of numbers (mean of the two middle values for an even count); None for an empty list."""
    if not values:
        return None
    ordered = sorted(values)
    n = len(ordered)
    mid = n // 2
    return float(ordered[mid]) if n % 2 else (ordered[mid - 1] + ordered[mid]) / 2.0


def nearest_rank(ordered, p):
    """Nearest-rank percentile of an already sorted list (p in 0..100); None for an empty list."""
    if not ordered:
        return None
    rank = max(1, math.ceil(p / 100.0 * len(ordered)))
    return float(ordered[rank - 1])


def top_share(ordered_desc, fraction):
    """Share of the total held by the top `fraction` of values (at least one value); None when the total is 0."""
    total = sum(ordered_desc)
    if not ordered_desc or total <= 0:
        return None
    k = max(1, math.ceil(len(ordered_desc) * fraction))
    return sum(ordered_desc[:k]) / total


def name_key(name):
    """Deterministic normalisation used ONLY to compare names with SEC titles: upper case, internal whitespace runs
    collapsed to one space, outer whitespace removed. Punctuation and legal suffixes are untouched."""
    return " ".join((name or "").upper().split())


def build_title_index(rows):
    """{normalised title: sorted list of CIKs} from company_sec_profiles rows ({id, title}); non-CIK ids are skipped."""
    index = {}
    for row in rows:
        cik = str(row.get("id") or "")
        if not re.fullmatch(r"\d{10}", cik):
            continue
        key = name_key(row.get("title"))
        if key:
            index.setdefault(key, set()).add(cik)
    return {key: sorted(ciks) for key, ciks in index.items()}


def match_company(name, index):
    """Exact unique match of an establishment name to an SEC title: ('matched', cik), ('ambiguous', None) when the
    normalised title belongs to several CIKs, ('no_match', None) otherwise."""
    ciks = index.get(name_key(name))
    if not ciks:
        return "no_match", None
    if len(ciks) > 1:
        return "ambiguous", None
    return "matched", ciks[0]


def pct_change(new, old):
    if new is None or old in (None, 0):
        return None
    return round((new - old) / old * 100.0, 2)


def blank_violations():
    return {key: 0 for key in VIOL_KEYS}


def money_label(amount):
    return "Not recorded" if amount is None else "${:,.0f}".format(amount)
