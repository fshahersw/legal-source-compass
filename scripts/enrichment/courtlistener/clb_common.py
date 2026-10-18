"""Pure helpers shared by the CourtListener bulk builders (no DuckDB import, safe to unit-test anywhere)."""
from __future__ import annotations

import datetime as dt
from collections import Counter

SNAPSHOT = "2026-09-30"
SNAPSHOT_DATE = dt.date(2026, 9, 30)
BULK_URL = "https://www.courtlistener.com/help/api/bulk-data/"
BULK_BASE = "https://com-courtlistener-storage.s3-us-west-2.amazonaws.com/bulk-data/"

# Court jurisdiction codes as stored (search_court.jurisdiction); labels from CourtListener's API documentation.
JURISDICTION_LABEL = {
    "F": "Federal appellate",
    "FD": "Federal district",
    "FB": "Federal bankruptcy",
    "FBP": "Federal bankruptcy panel",
    "FS": "Federal special",
    "S": "State supreme",
    "SA": "State appellate",
    "ST": "State trial",
    "SS": "State special",
    "SAG": "State attorney general",
    "C": "Committee",
    "I": "International",
    "T": "Testing",
}
FEDERAL_JURISDICTIONS = {"F", "FD", "FB", "FBP", "FS"}
STATE_JURISDICTIONS = {"S", "SA", "ST", "SS", "SAG"}

# Docket.source is a bit field (CourtListener coding): 1 RECAP, 2 scraper, 4 Columbia, 8 FJC IDB, 16 Harvard.
SOURCE_BITS = [(1, "RECAP"), (2, "Scraper"), (4, "Columbia"), (8, "FJC IDB"), (16, "Harvard")]

HOW_SELECTED_LABEL = {
    "a_pres": "Appointed by the President",
    "a_gov": "Appointed by a governor",
    "a_judge": "Appointed by judge(s)",
    "e_non_part": "Non-partisan election",
    "e_part": "Partisan election",
    "a_legis": "Appointed by the legislature",
    "ct_trans": "Court transfer",
}
TERMINATION_LABEL = {
    "retire_vol": "Retired voluntarily",
    "retire_mand": "Mandatory retirement",
    "ded": "Died in office",
    "resign": "Resigned",
    "other_pos": "Left for another position",
    "termed_out": "Term ended",
    "lost": "Lost election or retention",
    "abolished": "Court or seat abolished",
    "recess_not_confirmed": "Recess appointment not confirmed",
    "bad_judge": "Removed or impeached",
}
POSITION_LABEL = {
    "jud": "Judge",
    "pres-jud": "Presiding judge",
    "trial-jud": "Trial judge",
    "mag": "Magistrate judge",
    "jus": "Justice",
    "act-jus": "Acting justice",
    "ass-jus": "Associate justice",
    "c-jus": "Chief justice",
    "c-jud": "Chief judge",
    "c-mag": "Chief magistrate judge",
    "act-jud": "Acting judge",
    "ret-senior-jud": "Retired senior judge",
}
# Position types that are seats on a court (people-db position_type codes); others (clerk, commissioner, practice...) are excluded.
JUDICIAL_POSITIONS = set(POSITION_LABEL) | {"asst-pres-jud", "sup-jud", "pres-jus", "ass-jud", "ad-law-jud", "spec-tr-jud", "jud-pt", "ad-pres-jus"}
PARTY_LABEL = {"d": "Democratic", "r": "Republican"}  # other codes are shown as stored


def source_flags(value: int | None) -> list[str]:
    """Decode a docket source bit field into names; unknown higher bits are reported as 'other flags'."""
    if value is None:
        return []
    names = [label for bit, label in SOURCE_BITS if value & bit]
    rest = value & ~sum(bit for bit, _ in SOURCE_BITS)
    if rest:
        names.append(f"other flags ({rest})")
    return names or ["Default"]


def parse_date(text: str | None) -> dt.date | None:
    """YYYY-MM-DD (or longer ISO timestamps); anything else is None, never a guess."""
    if not text:
        return None
    try:
        return dt.date.fromisoformat(str(text)[:10])
    except ValueError:
        return None


def years_between(a: dt.date | None, b: dt.date | None) -> float | None:
    if a is None or b is None or b < a:
        return None
    return (b - a).days / 365.25  # exact; rounded only when displayed


def median(values: list[float]) -> float | None:
    v = sorted(x for x in values if x is not None)
    if not v:
        return None
    mid = len(v) // 2
    return float(v[mid]) if len(v) % 2 else (v[mid - 1] + v[mid]) / 2.0


def share(part: int, whole: int, digits: int = 1) -> float | None:
    return None if not whole else round(100.0 * part / whole, digits)


def top_counts(values, limit: int = 5, labels: dict | None = None) -> list[dict]:
    c = Counter(v for v in values if v not in (None, ""))
    total = sum(c.values())
    return [{"value": k, "label": (labels or {}).get(k, k), "count": n, "share_pct": share(n, total)} for k, n in sorted(c.items(), key=lambda kv: (-kv[1], str(kv[0])))[:limit]]


def decade(date: dt.date | None) -> int | None:
    return None if date is None else date.year // 10 * 10


SUFFIX_LABEL = {"jr": "Jr.", "sr": "Sr.", "1": "I", "2": "II", "3": "III", "4": "IV"}  # people-db name_suffix codes


def full_name(first: str | None, middle: str | None, last: str | None, suffix: str | None) -> str:
    parts = [p.strip() for p in (first, middle, last) if p and p.strip()]
    name = " ".join(parts)
    if suffix and suffix.strip():
        s = suffix.strip()
        name += f" {SUFFIX_LABEL.get(s.lower(), s)}"
    return name or "Name not recorded"


def r2(v):
    """Round for storage at the very end of a computation (None stays None)."""
    return None if v is None else round(float(v), 2)


def r1(v):
    return None if v is None else round(float(v), 1)


def fiscal_year(date: dt.date | None) -> int | None:
    """Federal fiscal year (Oct 1 - Sep 30) labelled by the year it ends, as the AO labels statistical years."""
    if date is None:
        return None
    return date.year + 1 if date.month >= 10 else date.year


def ratio(part, whole, digits: int = 3):
    """part / whole, or None when whole is missing or zero (never a guessed value)."""
    if part is None or not whole:
        return None
    return round(float(part) / float(whole), digits)


def spearman(xs: list[float], ys: list[float]) -> tuple[float | None, int]:
    """Spearman rank correlation over pairs where both values exist; returns (rho, n). Ties get average ranks."""
    pairs = [(float(x), float(y)) for x, y in zip(xs, ys) if x is not None and y is not None]
    n = len(pairs)
    if n < 3:
        return None, n

    def ranks(values: list[float]) -> list[float]:
        order = sorted(range(len(values)), key=lambda i: values[i])
        out = [0.0] * len(values)
        i = 0
        while i < len(order):
            j = i
            while j + 1 < len(order) and values[order[j + 1]] == values[order[i]]:
                j += 1
            avg = (i + j) / 2.0 + 1.0
            for k in range(i, j + 1):
                out[order[k]] = avg
            i = j + 1
        return out

    rx, ry = ranks([p[0] for p in pairs]), ranks([p[1] for p in pairs])
    mx, my = sum(rx) / n, sum(ry) / n
    sxx = sum((a - mx) ** 2 for a in rx)
    syy = sum((b - my) ** 2 for b in ry)
    if sxx == 0 or syy == 0:
        return None, n
    sxy = sum((a - mx) * (b - my) for a, b in zip(rx, ry))
    return sxy / (sxx * syy) ** 0.5, n
