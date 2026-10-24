"""Exact court-id checks against our own court names.

A workbook row links a photo to a court id. The id is accepted only when it exists in court_spine AND a court name the
row itself gives for that id equals one of our recorded names for the same id, after a documented deterministic
normalisation. Two comparisons are used, both exact:

1. normalised text: case folded, "&" read as "and", punctuation removed, "U.S." read as "United States",
   whitespace collapsed;
2. the federal naming key: the U.S. Courts directory style ("Texas Western District Court", "Ninth Circuit Court of
   Appeals", "Ninth Circuit Bankruptcy Appellate Panel") and our style ("District Court, W.D. Texas", "Court of
   Appeals for the Ninth Circuit", "Bankruptcy Appellate Panel of the Ninth Circuit") are parsed by a fixed grammar
   into (kind, place, district part); a name the grammar does not parse has no key.

No similarity scores, no closest name, no partial or token-overlap matches.
"""
import re

ORDINALS = {
    "first": "1", "second": "2", "third": "3", "fourth": "4", "fifth": "5", "sixth": "6", "seventh": "7",
    "eighth": "8", "ninth": "9", "tenth": "10", "eleventh": "11",
}
DIRECTIONS = {"northern": "n", "southern": "s", "eastern": "e", "western": "w", "middle": "m", "central": "c"}
ABBREV = {"n": "n", "s": "s", "e": "e", "w": "w", "m": "m", "c": "c"}


def norm(name):
    s = (name or "").casefold().replace("&", " and ")
    s = re.sub(r"[^\w\s]", " ", s)
    s = re.sub(r"\bu s\b", "united states", s)
    return " ".join(s.split())


def _circuit(word):
    w = word.strip()
    if w in ORDINALS:
        return ORDINALS[w]
    if w in ("district of columbia", "d c", "dc"):
        return "dc"
    if w == "federal":
        return "fed"
    return None


def federal_key(name):
    """(kind, place, part) for a federal court name in either naming style, else None."""
    s = norm(name)
    s = re.sub(r"^united states ", "", s)
    # Courts of appeals.
    m = re.fullmatch(r"court of appeals for the (.+) circuit", s) or re.fullmatch(r"(.+) circuit court of appeals", s)
    if m:
        c = _circuit(m.group(1))
        return ("appeals", c, "") if c else None
    # Bankruptcy appellate panels.
    m = re.fullmatch(r"bankruptcy appellate panel (?:of|for) the (.+) circuit", s) or re.fullmatch(
        r"(.+) circuit bankruptcy appellate panel", s
    )
    if m:
        c = _circuit(m.group(1))
        return ("bap", c, "") if c else None
    # Our style: "District Court, N.D. Texas" / "Bankruptcy Court, D. Alaska" (punctuation already removed).
    m = re.fullmatch(r"(district|bankruptcy) court (?:([nsewmc]) d |d )?(.+)", s)
    if m and not m.group(3).startswith(("for ", "of ")):
        return (m.group(1), m.group(3), ABBREV.get(m.group(2) or "", ""))
    # Directory style: "Texas Western District Court" / "Alaska Bankruptcy Court".
    m = re.fullmatch(r"(.+?) (?:(northern|southern|eastern|western|middle|central) )?(district|bankruptcy) court", s)
    if m:
        return (m.group(3), m.group(1), DIRECTIONS.get(m.group(2) or "", ""))
    return None


def our_names(court_id, spine, courts_db):
    """Every name our data records for this exact id: court_spine title and short name, Courts-DB name and sub-names."""
    out = []
    row = spine.get(court_id)
    if row:
        out += [row.get("title"), row.get("short_name")]
    prof = courts_db.get(court_id)
    if prof:
        out += [prof.get("name")] + list(prof.get("sub_names") or [])
    return [n for n in out if n]


def name_match(court_id, row_names, spine, courts_db):
    """'text' or 'federal_key' when one of the row's names for this id equals one of ours; None otherwise."""
    if court_id not in spine:
        return None
    ours = our_names(court_id, spine, courts_db)
    ours_norm = {norm(n) for n in ours}
    ours_keys = {k for k in (federal_key(n) for n in ours) if k}
    for name in row_names:
        if name and norm(name) in ours_norm:
            return "text"
    for name in row_names:
        key = federal_key(name) if name else None
        if key and key in ours_keys:
            return "federal_key"
    return None
