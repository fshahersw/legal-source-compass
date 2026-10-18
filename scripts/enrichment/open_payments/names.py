"""Deterministic company-name matching used across official sources (CMS Open Payments, openFDA MAUDE, SEC).

A name is reduced to a key: (base name, set of legal-form classes). The base ignores case and punctuation, treats
'&' as 'AND', joins runs of single letters into one initialism ('C. R.', 'C.R.' and 'C R' all become 'CR') and
drops a trailing 'AND SUBSIDIARIES' (CMS entities often file as '<parent> & Subsidiaries') and trailing legal-form
words. Two names are the same company only when the bases are identical AND the legal forms agree: either the
legal-form classes are equal (INC, CORP, CO and COMPANY are one class) or one name carries no legal form at all.
So 'Stryker Corp' = 'STRYKER CORPORATION', but 'BIOSENSE WEBSTER LTD' != 'BIOSENSE WEBSTER, INC.' and
'Medtronic plc' != 'MEDTRONIC, INC.'. Divisions, plants and parentheticals stay in the base, so
'MEDTRONIC USA, INC.' != 'MEDTRONIC, INC.' and 'C. R. BARD INC. (BASD)' != 'C. R. BARD, INC.'.
"""
import re

SUFFIX_CLASS = {
    "INC": "CORP", "INCORPORATED": "CORP", "CORP": "CORP", "CORPORATION": "CORP", "CO": "CORP", "COMPANY": "CORP",
    "LTD": "LTD", "LIMITED": "LTD", "LLC": "LLC", "LP": "LP", "LLP": "LLP", "PLC": "PLC", "AG": "AG", "SA": "SA",
    "SAS": "SAS", "GMBH": "GMBH", "NV": "NV", "BV": "BV", "SPA": "SPA", "AB": "AB", "AS": "AS", "KK": "KK",
    "PTY": "PTY", "SE": "SE", "ULC": "ULC", "LTDA": "LTDA", "SRL": "SRL", "SARL": "SARL",
}
LEGAL_SUFFIXES = set(SUFFIX_CLASS)


def _join_initials(words):
    tokens, in_run = [], False
    for word in words:
        single = len(word) == 1 and word.isalpha()
        if single and in_run:
            tokens[-1] += word
        else:
            tokens.append(word)
        in_run = single
    return tokens


def company_key(name):
    """(base, frozenset of legal-form classes); ('', frozenset()) for anything that is not a usable name."""
    if not isinstance(name, str):
        return "", frozenset()
    text = re.sub(r"[^A-Z0-9 ]+", " ", name.upper().replace("&", " AND "))
    tokens = _join_initials(text.split())
    original = list(tokens)
    classes = set()
    changed = True
    while changed and tokens:
        changed = False
        if len(tokens) >= 3 and tokens[-2:] == ["AND", "SUBSIDIARIES"]:
            tokens = tokens[:-2]
            changed = True
        elif len(tokens) > 1 and tokens[-1] in SUFFIX_CLASS:
            classes.add(SUFFIX_CLASS[tokens[-1]])
            tokens = tokens[:-1]
            changed = True
    return " ".join(tokens or original), frozenset(classes)


def normalize_company(name):
    return company_key(name)[0]


def same_company(a, b):
    (base_a, forms_a), (base_b, forms_b) = company_key(a), company_key(b)
    return bool(base_a) and base_a == base_b and (not forms_a or not forms_b or forms_a == forms_b)


US_FORMS = {"CORP", "LLC", "LP", "LLP"}


def matches_any(term, references, us_based):
    """True when `term` names the same company as one of `references` (a company's current and alternate names).

    Bases must be identical. If the references carry legal forms, the term must carry none or one of those form
    sets. If no reference carries a legal form, the term must carry none, or (for a U.S.-based company) only U.S.
    forms; a foreign form such as LTD, PTY or SPA then marks a different (foreign) affiliate and does not match.
    """
    base, forms = company_key(term)
    if not base:
        return False
    same_base = [company_key(r) for r in references if company_key(r)[0] == base]
    if not same_base:
        return False
    known = {f for _, f in same_base if f}
    if not forms:
        return True
    if known:
        return forms in known
    return us_based and forms <= US_FORMS


def search_phrase(name):
    """The name without punctuation or trailing legal suffix, initials kept apart, for an openFDA phrase search."""
    if not isinstance(name, str):
        return ""
    tokens = re.sub(r"[^A-Z0-9 ]+", " ", name.upper().replace("&", " AND ")).split()
    while len(tokens) > 1 and (tokens[-1] in LEGAL_SUFFIXES or (len(tokens) >= 3 and tokens[-2:] == ["AND", "SUBSIDIARIES"])):
        tokens = tokens[:-2] if tokens[-1] == "SUBSIDIARIES" else tokens[:-1]
    return " ".join(tokens)


QUERYABLE = re.compile(r"^[A-Za-z0-9 .,&'()/+\-]+$")


def queryable(term):
    """openFDA rejects some characters inside exact-match phrases (e.g. ';'); such spellings are not queried."""
    return bool(QUERYABLE.match(term or ""))
