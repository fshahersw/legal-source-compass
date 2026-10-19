"""Deterministic firm-name normalisation and party-side mapping for the firm intelligence datasets.

Firm strings are merged only by the documented rules below; typos, abbreviations and acronyms are never guessed. Every raw spelling is kept.
Government counsel (attorneys general, departments of justice or law, U.S. and county attorneys, courts) is classed separately and never
merged into a firm: a bare "Office of the Attorney General" names a different office in each state.
"""
from __future__ import annotations

import re

NOT_A_FIRM = re.compile(r"^(pro se|counsel not admitted (to )?usdc\s*-?\s*nj bar|unknown|none|n/?a|not applicable|self|in pro per)$", re.I)
GOVERNMENT = re.compile(
    r"attorney general|attorney generals|\bag'?s office\b|department of (justice|law|the attorney general)|dept of (justice|law|the attorney general)|"
    r"\bu ?s attorney|united states attorney|united states district court|\bus department of|u ?s department of|"
    r"\b(district|county|city|state's|states) attorney|public defender|solicitor general|solicitors? office|corporation counsel|law department|\bcaag\b|"
    r"^(state|commonwealth|people|city|county|town|township|village|borough) of ",
    re.I)
ENTITY_TOKENS = {"llp", "llc", "pc", "pa", "pllc", "plc", "ltd", "lpa", "aplc", "apc", "lp", "inc", "co", "chartered", "sc", "pllp", "lllp", "psc", "spc", "corp"}
PREFIXES = (("invalid", "address"), ("law", "offices", "of"), ("law", "office", "of"), ("the", "law", "offices", "of"), ("the", "law", "office", "of"), ("the",))
SUFFIX_PHRASES = (("attorneys", "at", "law"), ("attorney", "at", "law"), ("attorneys", "and", "counselors", "at", "law"))
_OFFICE = re.compile(r"\s+-\s+([A-Za-z .]{2,30})$")
_PUNCT = re.compile(r"[.,'’\"()]")
_INVALID = re.compile(r"^invalid address\s*-?\s*", re.I)

PLAINTIFF_TYPES = {"plaintiff", "consol plaintiff", "consolidated plaintiff", "intervenor plaintiff", "petitioner", "claimant"}
DEFENSE_TYPES = {"defendant", "respondent", "third party defendant"}


def _flat(raw: str) -> str:
    return " ".join(_PUNCT.sub("", raw or "").lower().split())


def is_firm(raw: str | None) -> bool:
    s = (raw or "").strip()
    return bool(s) and not NOT_A_FIRM.match(_flat(s))


def is_government(raw: str | None) -> bool:
    return bool(GOVERNMENT.search(_flat(_INVALID.sub("", (raw or "").strip()))))


def strip_office(raw: str) -> str:
    """Drop a trailing ' - <office>' segment (city, state or office label) unless it carries an entity form such as LLP."""
    s = _INVALID.sub("", raw.strip())
    m = _OFFICE.search(s)
    if m and not any(t in ENTITY_TOKENS for t in _PUNCT.sub(" ", m.group(1).lower()).split()):
        s = s[: m.start()]
    return s.strip()


def firm_key(raw: str) -> str:
    """Normalised key: case, punctuation and hyphens, &/+ as 'and', trailing office after ' - ', entity forms, 'attorneys at law', 'law offices of' prefix."""
    s = strip_office(raw)
    s = s.replace("&", " and ").replace("+", " and ")
    toks = _PUNCT.sub(" ", s.lower()).replace("-", " ").split()
    # join trailing single letters ("l l p" -> "llp", "p c" -> "pc")
    i = len(toks)
    while i > 0 and len(toks[i - 1]) == 1:
        i -= 1
    if len(toks) - i >= 2:
        toks = toks[:i] + ["".join(toks[i:])]
    changed = True
    while changed and toks:
        changed = False
        if toks[-1] in ENTITY_TOKENS:
            toks.pop()
            changed = True
        for phrase in SUFFIX_PHRASES:
            n = len(phrase)
            if len(toks) > n and tuple(toks[-n:]) == phrase:
                del toks[-n:]
                changed = True
    for prefix in PREFIXES:
        n = len(prefix)
        if len(toks) > n and tuple(toks[:n]) == prefix:
            toks = toks[n:]
            break
    return " ".join(toks)


def party_side(types: list[str] | None) -> str:
    t = {x.strip().lower() for x in types or [] if x}
    plaintiff = bool(t & PLAINTIFF_TYPES)
    defense = bool(t & DEFENSE_TYPES)
    if plaintiff and not defense:
        return "plaintiff"
    if defense and not plaintiff:
        return "defense"
    return "other"
