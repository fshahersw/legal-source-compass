"""Exact-key name handling for the regulatory-finance datasets (no fuzzy matching anywhere).

normalize_company is the same documented normalisation the enforcement_actions builders use for company_sec_profiles:
drop a trailing EDGAR marker ("/DE", "/NEW/"), casefold, '&' -> 'and', drop punctuation, collapse spaces, drop a leading
'the' and trailing corporate-suffix tokens. Two names match only when these keys are equal; a key shared by two
registrants is ambiguous and never linked.

org_name_without_location removes the trailing "City, State" that the Federal Reserve appends to banking-organization
names ("Wells Fargo & Company, San Francisco, California"), so the legal name can be compared on its own.
"""
import re
from collections import defaultdict

_SUFFIXES = {
    "inc", "incorporated", "corp", "corporation", "co", "company", "llc", "ltd", "limited", "plc", "sa", "ag", "nv", "the",
}


def normalize_company(name):
    """Exact-key normalisation (see module docstring). Returns "" for an empty name."""
    if not name:
        return ""
    s = re.sub(r"\s*/(?:[A-Za-z]{2,4})?/?\s*$", "", name)
    s = s.casefold().replace("&", " and ")
    s = re.sub(r"[^\w\s]", " ", s)
    tokens = s.split()
    while tokens and tokens[0] == "the":
        tokens = tokens[1:]
    while tokens and tokens[-1] in _SUFFIXES:
        tokens = tokens[:-1]
    return " ".join(tokens)


def clean_space(text):
    """Collapse runs of whitespace (including no-break spaces) to single spaces; None -> ""."""
    return " ".join((text or "").split())


class Companies:
    """company_sec_profiles lookup: exact CIK and exact normalised legal name, ambiguity-aware."""

    def __init__(self, rows):
        """rows: iterable of (cik10, registrant name)."""
        self.names = {}
        keys = defaultdict(set)
        for cik, title in rows:
            if not (isinstance(cik, str) and cik.isdigit() and len(cik) == 10):
                continue
            self.names[cik] = title
            key = normalize_company(title)
            if key:
                keys[key].add(cik)
        self.unique = {k: next(iter(v)) for k, v in keys.items() if len(v) == 1}
        self.ambiguous = {k: sorted(v) for k, v in keys.items() if len(v) > 1}

    def by_cik(self, cik10):
        return cik10 if cik10 in self.names else None

    def by_name(self, name):
        """('matched', cik, key) | ('ambiguous', [ciks], key) | ('none', None, key)."""
        key = normalize_company(name)
        if not key:
            return ("none", None, key)
        if key in self.ambiguous:
            return ("ambiguous", self.ambiguous[key], key)
        cik = self.unique.get(key)
        return ("matched", cik, key) if cik else ("none", None, key)


def pad_cik(raw):
    """Digits-only CIK zero-padded to 10 digits, or None when the value is not a plain integer of 1-10 digits."""
    s = (raw or "").strip()
    return s.zfill(10) if s.isdigit() and 1 <= len(s) <= 10 else None


STATE_NAMES = {
    "alabama", "alaska", "arizona", "arkansas", "california", "colorado", "connecticut", "delaware", "florida", "georgia",
    "hawaii", "idaho", "illinois", "indiana", "iowa", "kansas", "kentucky", "louisiana", "maine", "maryland",
    "massachusetts", "michigan", "minnesota", "mississippi", "missouri", "montana", "nebraska", "nevada",
    "new hampshire", "new jersey", "new mexico", "new york", "north carolina", "north dakota", "ohio", "oklahoma",
    "oregon", "pennsylvania", "rhode island", "south carolina", "south dakota", "tennessee", "texas", "utah", "vermont",
    "virginia", "washington", "west virginia", "wisconsin", "wyoming", "district of columbia", "puerto rico", "guam",
    "american samoa", "northern mariana islands", "virgin islands", "u.s. virgin islands", "united states virgin islands",
}
STATE_CODES = {
    "AL", "AK", "AZ", "AR", "CA", "CO", "CT", "DE", "FL", "GA", "HI", "ID", "IL", "IN", "IA", "KS", "KY", "LA", "ME", "MD",
    "MA", "MI", "MN", "MS", "MO", "MT", "NE", "NV", "NH", "NJ", "NM", "NY", "NC", "ND", "OH", "OK", "OR", "PA", "RI", "SC",
    "SD", "TN", "TX", "UT", "VT", "VA", "WA", "WV", "WI", "WY", "DC", "PR", "GU", "AS", "MP", "VI",
}
# A trailing comma-separated token that belongs to the legal name, not to the city.
_NAME_TAIL = re.compile(
    r"^(?:inc\.?|incorporated|llc|l\.l\.c\.?|l\.p\.?|lp|llp|n\.a\.?|na|corp\.?|corporation|co\.?|company|ltd\.?|limited|"
    r"plc|s\.a\.?|n\.v\.?|ag|f\.s\.b\.?|fsb|ssb|s\.s\.b\.?|n\.a|trust|bancorp|bancorporation)$",
    re.I,
)


def _is_state(token):
    t = token.strip()
    if t.casefold() in STATE_NAMES or t.casefold().rstrip(".") in STATE_NAMES:
        return True
    return t.replace(".", "").upper() in STATE_CODES


def org_name_without_location(segment):
    """('Name', 'City, State' | None) for one "Name, City, State" segment. Only a trailing U.S. state (name or code) is
    treated as a location; the token before it is taken as the city unless it is a corporate-name tail ("Inc.")."""
    seg = clean_space(segment)
    parts = [p.strip() for p in seg.split(",")]
    if len(parts) >= 3 and _is_state(parts[-1]) and parts[-2] and not _NAME_TAIL.match(parts[-2]):
        return ", ".join(parts[:-2]), f"{parts[-2]}, {parts[-1]}"
    if len(parts) >= 2 and _is_state(parts[-1]) and len(parts[0]) > 0 and not _NAME_TAIL.match(parts[-1]):
        # "Name, State" without a city
        return ", ".join(parts[:-1]), parts[-1]
    return seg, None


_STATE_ALT = "|".join(sorted((re.escape(n) for n in STATE_NAMES), key=len, reverse=True) + sorted(STATE_CODES))
# "..., Lynnwood, Washington and UniBank, ..." : two organisations joined by 'and' right after a state.
_AND_AFTER_STATE = re.compile(r"(?<=,\s)(?:" + _STATE_ALT + r")(?:\.)?\s+and\s+(?=[A-Z0-9])", re.I)


def split_organizations(text):
    """Split the Fed's banking-organization / affiliation string into as-written segments: on ';', and on ' and ' when
    it directly follows a ', State' (two organisations each written 'Name, City, State'). Blank segments are dropped."""
    out = []
    for chunk in (text or "").split(";"):
        chunk = clean_space(chunk)
        if not chunk:
            continue
        cuts, last = [], 0
        for m in _AND_AFTER_STATE.finditer(chunk):
            state_text = chunk[m.start():m.end()]
            end_of_state = m.start() + len(re.match(r"(?:" + _STATE_ALT + r")(?:\.)?", state_text, re.I).group(0))
            cuts.append((last, end_of_state))
            last = m.end()
        cuts.append((last, len(chunk)))
        out.extend(clean_space(chunk[a:b]) for a, b in cuts if clean_space(chunk[a:b]))
    return out
