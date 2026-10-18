"""Pure analytics helpers for the JPML pending-MDL history (no I/O; unit-tested in test_jpml_history.py)."""
from datetime import date

STATE_NAMES = {
    "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California", "CO": "Colorado",
    "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia", "HI": "Hawaii", "ID": "Idaho",
    "IL": "Illinois", "IN": "Indiana", "IA": "Iowa", "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana",
    "ME": "Maine", "MD": "Maryland", "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi",
    "MO": "Missouri", "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey",
    "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio", "OK": "Oklahoma",
    "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina", "SD": "South Dakota",
    "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont", "VA": "Virginia", "WA": "Washington",
    "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming", "PR": "Puerto Rico", "GU": "Guam",
    "VI": "Virgin Islands", "MP": "Northern Mariana Islands",
}
DIRECTIONS = {"N": "N", "S": "S", "E": "E", "W": "W", "M": "M", "C": "C"}


def district_label(code: str | None):
    """JPML/CM-ECF district code -> court label in the court directory's style ('ILN' -> 'N.D. Illinois',
    'NJ' -> 'D. New Jersey', 'DC' -> 'District of Columbia'). None when the code does not follow the
    two-letter state + optional direction-letter pattern."""
    if not code:
        return None
    if code == "DC":
        return "District of Columbia"
    state, rest = code[:2], code[2:]
    name = STATE_NAMES.get(state)
    if not name:
        return None
    if rest == "":
        return f"D. {name}"
    if len(rest) == 1 and rest in DIRECTIONS:
        return f"{rest}.D. {name}"
    return None


TERRITORIES = {"Guam", "Virgin Islands", "Northern Mariana Islands", "Puerto Rico"}


def _match_label(label: str | None, spine_rows: list, why_none: str) -> dict:
    """Exact, unique match of 'District Court, <label>' against court_spine federal-district titles. A territory is
    also tried under its bare name ('District Court, Virgin Islands'), the spelling court_spine uses for it.
    Returns {court_id, label, method, status} with status matched | unmatched | ambiguous | no_label."""
    if not label:
        return {"court_id": None, "label": None, "status": "no_label", "method": why_none}
    wants = [f"District Court, {label}"]
    if label.startswith("D. ") and label[3:] in TERRITORIES:
        wants.append(f"District Court, {label[3:]}")
    for want in wants:
        hits = [r["id"] for r in spine_rows if r["title"] == want]
        if len(hits) == 1:
            return {"court_id": hits[0], "label": label, "status": "matched", "method": f"exact title '{want}'"}
        if len(hits) > 1:
            return {"court_id": None, "label": label, "status": "ambiguous", "method": f"{len(hits)} court_spine titles '{want}'"}
    return {"court_id": None, "label": label, "status": "unmatched", "method": "no court_spine title " + " or ".join(f"'{w}'" for w in wants)}


def match_court(code: str | None, spine_rows: list) -> dict:
    """Court match for a JPML / CM-ECF district code ('ILN', 'NJ', 'DC')."""
    return _match_label(district_label(code), spine_rows, "code pattern not recognised")


SMALL_WORDS = {"of"}


def court_label_from_key(key: str | None):
    """Court-directory label from a normalised district key ('illinois|N' -> 'N.D. Illinois', 'maine|' -> 'D. Maine',
    'district of columbia|' -> 'District of Columbia'), the key built by parse_stats.district_key."""
    if not key or "|" not in key:
        return None
    name, direction = key.split("|", 1)
    if not name:
        return None
    state = " ".join(w if w in SMALL_WORDS else w.capitalize() for w in name.split())
    if name == "district of columbia":
        return state
    return f"{direction}.D. {state}" if direction else f"D. {state}"


def match_court_key(key: str | None, spine_rows: list) -> dict:
    """Court match for a district named in the JPML fiscal-year statistics (e.g. 'ILLINOIS NORTHERN')."""
    return _match_label(court_label_from_key(key), spine_rows, "district name not recognised")


def month_of(iso: str) -> str:
    return iso[:7]


def month_diff(a: str, b: str) -> int:
    """Calendar months from month label a ('YYYY-MM') to b."""
    ya, ma = int(a[:4]), int(a[5:7])
    yb, mb = int(b[:4]), int(b[5:7])
    return (yb - ya) * 12 + (mb - ma)


def shift_month(label: str, k: int) -> str:
    y, m = int(label[:4]), int(label[5:7])
    idx = y * 12 + (m - 1) + k
    return f"{idx // 12:04d}-{idx % 12 + 1:02d}"


def months_between_dates(a: str, b: str):
    if not a or not b:
        return None
    da, db = date.fromisoformat(a), date.fromisoformat(b)
    return round((db - da).days / 30.4375, 1)


def share_pct(part, whole, digits=2):
    if part is None or not whole:
        return None
    return round(100 * part / whole, digits)


def top_n_share(values: list, n: int):
    vals = sorted((v for v in values if v is not None), reverse=True)
    total = sum(vals)
    return share_pct(sum(vals[:n]), total) if total else None


def hhi(values: list):
    """Herfindahl-Hirschman index on the 0-10,000 scale: sum of squared percentage shares."""
    vals = [v for v in values if v is not None]
    total = sum(vals)
    if not total:
        return None
    return round(sum((100 * v / total) ** 2 for v in vals), 1)


def change(points: dict, latest_month: str, k: int, field: str = "pending"):
    """Change over k calendar months ending at latest_month; None when either month is missing."""
    past = shift_month(latest_month, -k)
    if latest_month not in points or past not in points:
        return None
    return points[latest_month][field] - points[past][field]


def pct_change(points: dict, latest_month: str, k: int, field: str = "pending"):
    past = shift_month(latest_month, -k)
    if latest_month not in points or past not in points:
        return None
    base = points[past][field]
    if not base:
        return None
    return round(100 * (points[latest_month][field] - base) / base, 1)


def periods(series: list, key: str):
    """Collapse consecutive points with the same value of `key` into [{value, from, to, reports}]."""
    out = []
    for p in series:
        v = p.get(key)
        if out and out[-1]["value"] == v:
            out[-1]["to"] = p["month"]
            out[-1]["reports"] += 1
        else:
            out.append({"value": v, "from": p["month"], "to": p["month"], "reports": 1})
    return out


def peak(series: list, field: str = "pending"):
    """First point holding the maximum value of `field` (ties resolve to the earliest month)."""
    best = None
    for p in series:
        if best is None or p[field] > best[field]:
            best = p
    return best


def fmt(n):
    if n is None:
        return "Not recorded"
    if isinstance(n, float):
        return f"{n:,.1f}"
    if isinstance(n, int):
        return f"{n:,}"
    return str(n)


def signed(n):
    if n is None:
        return "Not recorded"
    return f"+{n:,}" if n > 0 else f"{n:,}"


def pct(n, digits=1):
    return "Not recorded" if n is None else f"{n:.{digits}f}%"
