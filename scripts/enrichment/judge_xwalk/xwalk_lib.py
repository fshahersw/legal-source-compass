"""Deterministic name and court normalisation for the judge ↔ CourtListener crosswalk.

Nothing here is fuzzy: names are compared token by token after documented clean-up (case, punctuation, honorific prefixes, suffix spelling),
and court names after documented, reversible rewrites of CourtListener's federal naming style. No edit distance, phonetics or nicknames.
"""
from __future__ import annotations

import re

HONORIFIC_PREFIX = {"judge", "justice", "hon", "honorable", "the", "chief", "associate", "magistrate", "presiding", "president",
                    "senior", "retired", "acting", "administrative", "district", "circuit", "bankruptcy", "special", "trial", "supervising"}
SUFFIX_TOKENS = {"jr": "jr", "junior": "jr", "sr": "sr", "ii": "ii", "iii": "iii", "iv": "iv", "2nd": "ii", "3rd": "iii"}
CL_SUFFIX = {"jr": "jr", "sr": "sr", "1": None, "2": "ii", "3": "iii", "4": "iv"}
TRAILING_TITLES = {"emeritus", "emerita", "ret", "retired"}

STATE_CODES = {
    "alabama": "AL", "alaska": "AK", "arizona": "AZ", "arkansas": "AR", "california": "CA", "colorado": "CO", "connecticut": "CT",
    "delaware": "DE", "district of columbia": "DC", "florida": "FL", "georgia": "GA", "hawaii": "HI", "idaho": "ID", "illinois": "IL",
    "indiana": "IN", "iowa": "IA", "kansas": "KS", "kentucky": "KY", "louisiana": "LA", "maine": "ME", "maryland": "MD",
    "massachusetts": "MA", "michigan": "MI", "minnesota": "MN", "mississippi": "MS", "missouri": "MO", "montana": "MT", "nebraska": "NE",
    "nevada": "NV", "new hampshire": "NH", "new jersey": "NJ", "new mexico": "NM", "new york": "NY", "north carolina": "NC",
    "north dakota": "ND", "ohio": "OH", "oklahoma": "OK", "oregon": "OR", "pennsylvania": "PA", "rhode island": "RI",
    "south carolina": "SC", "south dakota": "SD", "tennessee": "TN", "texas": "TX", "utah": "UT", "vermont": "VT", "virginia": "VA",
    "washington": "WA", "west virginia": "WV", "wisconsin": "WI", "wyoming": "WY", "puerto rico": "PR", "guam": "GU",
    "virgin islands": "VI", "u.s. virgin islands": "VI", "northern mariana islands": "MP", "american samoa": "AS",
}

_PUNCT = re.compile(r"[.,'’`\"()]")
_SPACE = re.compile(r"[\s\-‐–—/]+")


def tokens(text: str | None) -> list[str]:
    """Lower-case tokens with punctuation removed; hyphens and slashes split tokens (applied identically to both sides)."""
    if not text:
        return []
    t = _PUNCT.sub(" ", text.lower())
    return [x for x in _SPACE.split(t) if x]


def split_name(tok: list[str]) -> tuple[tuple[str, ...], frozenset[str]]:
    """(name tokens without honorific prefixes, trailing titles and suffix tokens; suffix set)."""
    tok = list(tok)
    while tok and tok[0] in HONORIFIC_PREFIX:
        tok.pop(0)
    while tok and tok[-1] in TRAILING_TITLES:
        tok.pop()
    suffix = set()
    kept = []
    for i, x in enumerate(tok):
        if x in SUFFIX_TOKENS and i > 0:
            suffix.add(SUFFIX_TOKENS[x])
        else:
            kept.append(x)
    return tuple(kept), frozenset(suffix)


def record_name(name: str) -> tuple[tuple[str, ...], frozenset[str]]:
    return split_name(tokens(name))


def cl_name(first, middle, last, suffix_code) -> tuple[tuple[str, ...], frozenset[str], tuple[str, ...], tuple[str, ...], tuple[str, ...]]:
    """(full tokens, suffix set, first tokens, middle tokens, last tokens) for a CourtListener person row."""
    f, m, l = tokens(first), tokens(middle), tokens(last)
    suffix = set()
    clean_m = []
    for x in m:  # some rows carry the suffix inside the middle name ("E., Jr.")
        if x in SUFFIX_TOKENS:
            suffix.add(SUFFIX_TOKENS[x])
        else:
            clean_m.append(x)
    s = CL_SUFFIX.get((suffix_code or "").strip().lower()) if suffix_code else None
    if s:
        suffix.add(s)
    while l and l[-1] in SUFFIX_TOKENS:
        suffix.add(SUFFIX_TOKENS[l.pop()])
    return tuple(f + clean_m + l), frozenset(suffix), tuple(f), tuple(clean_m), tuple(l)


def middle_compatible(a: tuple[str, ...], b: tuple[str, ...]) -> bool:
    """Middle names agree when equal, when one side has none, or token by token as initial vs full name (same first letter)."""
    if a == b or not a or not b:
        return True
    if len(a) != len(b):
        return False
    for x, y in zip(a, b):
        if x == y:
            continue
        if (len(x) == 1 and y.startswith(x)) or (len(y) == 1 and x.startswith(y)):
            continue
        return False
    return True


DIRECTIONS = {"n.d.": "northern district of", "s.d.": "southern district of", "e.d.": "eastern district of", "w.d.": "western district of",
              "m.d.": "middle district of", "c.d.": "central district of", "d.": "district of"}
_STATE_PREFIX = re.compile(r"^[a-z]{2}\s+-\s+")


def norm_court(name: str | None) -> str:
    if not name:
        return ""
    t = name.strip().lower()
    t = _STATE_PREFIX.sub("", t)  # "CO - Denver County Court"
    t = t.replace("united states", "u s").replace("u.s.", "u s")
    t = re.sub(r"[.,'’()]", " ", t)
    return " ".join(t.split())


def court_aliases(full_name: str | None, short_name: str | None) -> set[str]:
    """Normalised names a CourtListener court can appear under: its own names plus the FJC/uscourts long forms of federal names."""
    out = {norm_court(full_name), norm_court(short_name)}
    fn = (full_name or "").strip()
    m = re.match(r"^District Court, (N\.D\.|S\.D\.|E\.D\.|W\.D\.|M\.D\.|C\.D\.|D\.) (.+)$", fn)
    if m:
        place = m.group(2)
        long_form = f"{DIRECTIONS[m.group(1).lower()]} {place}"
        out |= {norm_court(f"U.S. District Court for the {long_form}"), norm_court(f"United States District Court for the {long_form}"),
                norm_court(long_form)}
    if fn == "District Court, District of Columbia":
        out |= {norm_court("U.S. District Court for the District of Columbia")}
    m = re.match(r"^United States Bankruptcy Court, (N\.D\.|S\.D\.|E\.D\.|W\.D\.|M\.D\.|C\.D\.|D\.) (.+)$", fn)
    if m:
        long_form = f"{DIRECTIONS[m.group(1).lower()]} {m.group(2)}"
        out |= {norm_court(f"U.S. Bankruptcy Court for the {long_form}"), norm_court(f"United States Bankruptcy Court for the {long_form}")}
    m = re.match(r"^Court of Appeals for the (.+)$", fn)
    if m:
        out |= {norm_court(f"U.S. Court of Appeals for the {m.group(1)}"), norm_court(f"United States Court of Appeals for the {m.group(1)}")}
        if m.group(1) == "D.C. Circuit":
            out |= {norm_court("U.S. Court of Appeals for the District of Columbia Circuit")}
    # state trial courts: CourtListener's naming vs the directory's naming, rewritten exactly (no partial matching)
    m = re.match(r"^Texas (\d+(?:st|nd|rd|th)) Judicial District Court$", fn)
    if m:
        n = m.group(1)
        out |= {norm_court(f"{n} District Court"), norm_court(f"{n} District Court of Texas"), norm_court(f"{n} Judicial District Court")}
    m = re.match(r"^(Superior|Municipal) Court of California, County of (.+)$", fn)
    if m:
        out |= {norm_court(f"{m.group(2)} County {m.group(1)} Court")}
    m = re.match(r"^New York Supreme Court, (.+) County$", fn)
    if m:
        out |= {norm_court(f"{m.group(1)} County Supreme Court")}
    m = re.match(r"^New York County Court, (.+) County$", fn)
    if m:
        out |= {norm_court(f"{m.group(1)} County Court")}
    out.discard("")
    return out


JUDICIAL_TITLE = re.compile(r"\b(judge|justice|surrogate|magistrate|chancellor)\b", re.I)
NON_JUDICIAL_TITLE = re.compile(r"\b(clerk|attorney|assistant|secretary|law|staff|counsel|arbitrator)\b", re.I)


def is_judicial(position_type: str | None, job_title: str | None, judicial_types: set[str]) -> bool:
    if position_type:
        return position_type in judicial_types
    t = job_title or ""
    return bool(JUDICIAL_TITLE.search(t)) and not NON_JUDICIAL_TITLE.search(t)


_YEARS = re.compile(r"\b(1[7-9]\d\d|20\d\d)\b")


def term_years(term: str | None) -> tuple[int | None, int | None]:
    ys = [int(y) for y in _YEARS.findall(term or "")]
    if not ys:
        return None, None
    return min(ys), max(ys)
