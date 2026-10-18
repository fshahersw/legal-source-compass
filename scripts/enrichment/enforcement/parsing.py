"""Deterministic parsers for the enforcement lane (EPA ECHO case downloads, CPSC recall API).

Nothing here guesses: a value that does not match a stated pattern comes back as None.
"""
import re

# ---------------------------------------------------------------- shared


def clean_text(value):
    """Collapse internal whitespace and trim; empty -> ''."""
    return re.sub(r"\s+", " ", value or "").strip()


def money(value):
    """ECHO dollar field -> float, or None when blank/unparseable. Negative values are rejected as unparsed."""
    text = (value or "").strip().replace(",", "")
    if not text:
        return None
    try:
        amount = float(text)
    except ValueError:
        return None
    return amount if amount >= 0 else None


def fiscal_year(value):
    text = (value or "").strip()
    return int(text) if re.fullmatch(r"(19|20)\d\d", text) else None


def us_date(value):
    """MM/DD/YYYY -> YYYY-MM-DD or None."""
    match = re.fullmatch(r"(\d\d)/(\d\d)/(\d{4})", (value or "").strip())
    return f"{match.group(3)}-{match.group(1)}-{match.group(2)}" if match else None


# ---------------------------------------------------------------- EPA

ACTIVITY_TYPES = {"JDC": "Civil judicial", "AFR": "Administrative formal"}

STATUTE_NAMES = {
    "CAA": "Clean Air Act",
    "CWA": "Clean Water Act",
    "RCRA": "Resource Conservation and Recovery Act",
    "CERCLA": "Comprehensive Environmental Response, Compensation, and Liability Act (Superfund)",
    "SDWA": "Safe Drinking Water Act",
    "TSCA": "Toxic Substances Control Act",
    "FIFRA": "Federal Insecticide, Fungicide, and Rodenticide Act",
    "EPCRA": "Emergency Planning and Community Right-to-Know Act",
    "MPRSA": "Marine Protection, Research, and Sanctuaries Act",
    "AIM": "American Innovation and Manufacturing Act",
    "MWTA": "Medical Waste Tracking Act",
    "APPS": "Act to Prevent Pollution from Ships",
    "REFA": "Rivers and Harbors Act (Refuse Act)",
    "MCRBMA": "Mercury-Containing and Rechargeable Battery Management Act",
}


def primary_statute(sections):
    """sections: list of (rank_order:str, statute_code:str) in file order. The RANK_ORDER == '1' row is primary;
    when several rank-1 rows exist the first in file order wins; no rank-1 row -> None."""
    for rank, statute in sections:
        if (rank or "").strip() == "1" and (statute or "").strip():
            return statute.strip()
    return None


def defendant_key(name):
    """Group defendants by exact recorded name after whitespace trimming/collapsing only (case kept)."""
    return clean_text(name)


def case_states(facility_states):
    """Sorted unique two-letter state codes from a case's facility rows; blanks dropped."""
    return sorted({s.strip().upper() for s in facility_states if re.fullmatch(r"[A-Za-z]{2}", (s or "").strip())})


# ---------------------------------------------------------------- CPSC

# Keyword taxonomy applied to hazard text + recall title, case-insensitive. A recall can match several.
HAZARD_RULES = [
    ("fire_burn", "Fire, burn and overheating", r"\bfire|(?<!chemical )\bburn|flam(e|mab)|overheat|ignit|scald|smok(e|ing)\b|\bmelt"),
    ("shock", "Electric shock and electrocution", r"\bshock|electrocut"),
    ("fall", "Fall", r"\bfall(s|ing)?\b|\bfell\b"),
    ("tip_over", "Tip-over and instability", r"tip[- ]?over|\b(tips|tipping|tipped) over\b|instab|unstable"),
    ("choking", "Choking", r"\bchok"),
    ("strangulation", "Strangulation and entanglement", r"strangul|entangl|drawstring"),
    ("suffocation", "Suffocation, asphyxiation and entrapment", r"suffocat|asphyxi|entrap"),
    ("laceration", "Laceration and sharp edges", r"lacerat|\bsharp\b|\bcuts?\b"),
    ("ingestion", "Ingestion (magnets, batteries, small parts)", r"ingest|swallow|\bmagnets?\b|button[- ]cell|coin[- ]?batter|button batter"),
    ("chemical", "Lead, phthalates and chemical exposure", r"\blead (paint|content|levels?|poisoning)|levels? of lead|excessive lead|contains? lead|lead limit|phthalat|\btoxic|chemical(?! burns?)|(?<!blood )\bpoison|carbon monoxide|\bco poisoning|methylene|benzene|asbestos"),
    ("drowning", "Drowning", r"drown"),
    ("crash", "Crash, collision and loss of control", r"\bcrash|collision|loss of (steering )?control|lose control"),
    ("impact", "Impact and struck-by injury", r"\bimpact|struck|projectile|eject"),
]
STANDARD_RULE = r"violat|fails? to (meet|comply)|does not (meet|comply)|do not (meet|comply)|not in compliance|noncomplian|non-complian|mandatory (safety )?standard|federal (safety )?(standard|regulation|requirement)"
HAZARD_LABELS = {key: label for key, label, _ in HAZARD_RULES}
HAZARD_LABELS["other"] = "Other or unclassified"
_HAZARD_RX = [(key, re.compile(pattern, re.I)) for key, _, pattern in HAZARD_RULES]
_STANDARD_RX = re.compile(STANDARD_RULE, re.I)


def hazard_categories(text):
    """Return the sorted keys of every category whose pattern matches; ['other'] when none match."""
    found = [key for key, rx in _HAZARD_RX if rx.search(text or "")]
    return found or ["other"]


def mentions_standard_violation(text):
    return bool(_STANDARD_RX.search(text or ""))


_DEATH = re.compile(r"\b(deaths?|died|dies|fatal(ity|ities)?|killed)\b", re.I)
_NEGATED_DEATH = re.compile(
    r"\bno (reported |known )?(deaths?|fatalit(y|ies))\b"
    r"|\bno (reports?|incidents?) of (any )?(injur(y|ies)|incidents?)?( or | and |, )?(deaths?|fatalit(y|ies))\b"
    r"|\bno (injur(y|ies)|incidents?)(,? (or|and) (incidents?|injur(y|ies)))?,? (or|and) (deaths?|fatalit(y|ies))\b"
    r"|\bnot aware of any (injur(y|ies)|incidents?)?( or | and )?(deaths?|fatalit(y|ies))\b"
    r"|\bwithout (any )?(injur(y|ies)|deaths?)( or deaths?)?\b",
    re.I,
)
_NONE = re.compile(r"^(none|no)\b[^.]*\b(reported|known|injur|incident)", re.I)


def mentions_death(text):
    """True when the injury statement mentions a death/fatality after removing explicitly negated phrases
    such as 'no reports of injury or death'. This is a text mention, not a verified death count."""
    remaining = _NEGATED_DEATH.sub(" ", text or "")
    return bool(_DEATH.search(remaining))


_INJURY = re.compile(r"\binjur(y|ies|ed)\b|\bburns?\b|\blacerations?\b|\bbruis|\bfractur|\bconcussion|\bhospital|\bemergency (room|department)|\bmedical (treatment|attention)", re.I)
_NEGATED_INJURY = re.compile(r"\bno (reported |known )?(injur(y|ies)|incidents?)( or (injur(y|ies)|incidents?|deaths?))*( (have|has) been| were| was)? reported\b|\bno injur(y|ies)\b|\bwithout (any )?injur(y|ies)\b|\bnot aware of any (injur(y|ies)|incidents?)( or (injur(y|ies)|incidents?))*\b", re.I)


def reports_none(text):
    """True when the whole injury statement says none were reported (e.g. 'None reported.')."""
    clean = clean_text(text)
    return bool(clean) and bool(_NONE.match(clean)) and not mentions_death(clean) and not _INJURY.search(_NEGATED_INJURY.sub(" ", clean))


def mentions_injury(text):
    remaining = _NEGATED_INJURY.sub(" ", text or "")
    return bool(_INJURY.search(remaining))


_WORD_NUM = {"one": 1, "two": 2, "three": 3, "four": 4, "five": 5, "six": 6, "seven": 7, "eight": 8, "nine": 9, "ten": 10}
_UNITS = re.compile(r"^(?:about|approximately)?\s*(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?|one|two|three|four|five|six|seven|eight|nine|ten)\s*(million|thousand)?\s*(?:units)?\.?$", re.I)


def parse_units(text):
    """Strict parse of CPSC 'NumberOfUnits' such as 'About 14,250', '1.2 million' or 'Approximately 500 units'.
    Anything else (ranges, several products, 'More than', 'Up to', foreign markets) -> None."""
    match = _UNITS.match(clean_text(text))
    if not match:
        return None
    raw, scale = match.group(1).lower(), (match.group(2) or "").lower()
    value = float(_WORD_NUM[raw]) if raw in _WORD_NUM else float(raw.replace(",", ""))
    if scale == "million":
        value *= 1_000_000
    elif scale == "thousand":
        value *= 1_000
    elif "." in raw:
        return None
    return int(round(value))


def normalize_country(value, standalone):
    """CPSC ManufacturerCountries value -> list of country names.
    Rule: drop parenthetical qualifiers ('China (batteries)' -> 'China'); a value that is itself a standalone value
    elsewhere ('Bosnia and Herzegovina') is kept whole; otherwise a ', ' / ' and ' list is split only when every
    part is a standalone value; anything else is kept as the cleaned string (never guessed)."""
    text = clean_text(re.sub(r"\([^)]*\)", " ", value or "")).strip(" ,;.")
    if not text:
        return []
    if text in standalone:
        return [text]
    parts = [clean_text(p) for p in re.split(r",\s*|\s+and\s+|;\s*", text) if clean_text(p)]
    if len(parts) > 1 and all(p in standalone for p in parts):
        return list(dict.fromkeys(parts))
    return [text]


def recall_units(products):
    """Recall-level units only when every product row with a units string carries the same string and it parses."""
    texts = {clean_text(p.get("NumberOfUnits")) for p in products if clean_text(p.get("NumberOfUnits"))}
    if len(texts) != 1:
        return None
    return parse_units(next(iter(texts)))
