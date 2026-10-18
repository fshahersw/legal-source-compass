"""Pure, deterministic text rules used to verify that a filing really names an MDL (unit-tested).

EDGAR full-text search is a candidate generator only: its phrase matching is loose, so every link is
re-checked here against the downloaded filing text before it is published.
"""
import html
import re

TAG = re.compile(r"<[^>]+>")
SPACE = re.compile(r"\s+")
HIDDEN = re.compile(r"<(script|style|ix:header)[^>]*>.*?</\1>", re.I | re.S)


def filing_text(raw: bytes) -> str:
    """Visible text of an EDGAR HTML/TXT document with tags removed and whitespace collapsed."""
    text = raw.decode("utf-8", "replace")
    text = HIDDEN.sub(" ", text)
    text = TAG.sub(" ", text)
    text = html.unescape(text).replace(" ", " ").replace("‑", "-").replace("–", "-").replace("—", "-")
    return SPACE.sub(" ", text).strip()


def number_pattern(n: int) -> re.Pattern:
    """'MDL No. 2924', 'MDL 2924', 'MDL-2924', 'MDL Docket No. 2924', 'MDL No 2924', 'MDL Number 2924',
    or a federal master docket such as '3:16-md-02738' / '16-md-2738'."""
    num = rf"0?{n}"
    return re.compile(
        rf"\bMDL\s*[-:]?\s*(?:Docket\s+)?(?:No\.?|Number|#)?\s*[-:]?\s*{num}(?!\d)"
        rf"|\b\d{{1,2}}[-:]?\d{{0,2}}-?md-{num}(?!\d)",
        re.I,
    )


def normalize(s: str) -> str:
    return SPACE.sub(" ", re.sub(r"[^a-z0-9]+", " ", s.lower())).strip()


def caption_pattern(caption: str) -> re.Pattern:
    """Every word of the official caption, in order, separated only by punctuation/space/symbols
    (so 'Zantac®/Ranitidine' matches the caption 'Zantac (Ranitidine)')."""
    words = normalize(caption).split()
    sep = r"[^A-Za-z0-9]{1,6}"
    return re.compile(r"(?<![A-Za-z0-9])" + sep.join(re.escape(w) for w in words) + r"(?![A-Za-z0-9])", re.I)


def excerpt(text: str, start: int, end: int, width: int = 360) -> str:
    a, b = max(0, start - width), min(len(text), end + width)
    if a > 0:
        a = text.find(" ", a) + 1 or a
    if b < len(text):
        cut = text.rfind(" ", start, b)
        b = cut if cut > end else b
    return ("… " if a > 0 else "") + text[a:b].strip() + (" …" if b < len(text) else "")


def subject_match(text: str, terms, required, pl_terms: re.Pattern, mdl_terms: re.Pattern, window: int = 500):
    """First position where a subject term has an MDL/multidistrict mention and every required term
    within `window` characters, and a products-liability / injury term within 2*window."""
    for term in terms:
        pattern = re.compile(rf"(?<![A-Za-z0-9]){re.escape(term)}(?![A-Za-z0-9])", re.I)
        for m in pattern.finditer(text):
            a, b = max(0, m.start() - window), min(len(text), m.end() + window)
            chunk = text[a:b]
            if not mdl_terms.search(chunk):
                continue
            if not all(re.search(rf"(?<![A-Za-z0-9]){re.escape(r)}(?![A-Za-z0-9])", chunk, re.I) for r in required):
                continue
            wide = text[max(0, m.start() - 2 * window): m.end() + 2 * window]
            if pl_terms.search(wide):
                return m.start(), m.end(), term
    return None


LITIGATION_CONTEXT = re.compile(
    r"litigation|lawsuit|court|district|multi-?district|JPML|Judicial Panel|plaintiff|defendant|claims?\b|settlement|product[s]? liability|transferee",
    re.I,
)
GENERIC_NAME_WORDS = {
    "inc", "corp", "co", "company", "corporation", "ltd", "limited", "plc", "llc", "lp", "nv", "n", "v", "sa", "ag", "se", "spa",
    "holdings", "holding", "group", "international", "industries", "the", "of", "and", "de", "del", "laboratories", "labs",
    "pharmaceuticals", "pharmaceutical", "pharma", "technologies", "technology", "systems", "brands", "products", "global",
    "america", "american", "usa", "us", "new", "trust", "capital", "funding", "scs", "sarl", "s", "a", "r", "l", "public",
    "medical", "health", "healthcare", "energy", "resources", "services", "enterprises", "partners", "north", "national",
}


def name_aliases(name: str) -> list[str]:
    """Distinctive words of an EDGAR conformed name ('PFIZER INC' -> ['Pfizer']; '3M CO' -> ['3M'])."""
    base = re.sub(r"\(.*?\)|/[A-Z]{2,3}/?", " ", name.split("  (")[0])
    words = re.findall(r"[A-Za-z0-9][A-Za-z0-9'\-]*", base)
    keep = [w for w in words if w.lower() not in GENERIC_NAME_WORDS and (len(w) >= 3 or any(ch.isdigit() for ch in w))]
    return keep[:3]


def self_reference(window_text: str, aliases, main_document: bool) -> bool:
    """The passage must be about the registrant: its name (or, in its own report, 'we'/'our'/'the Company')."""
    for alias in aliases:
        if re.search(rf"(?<![A-Za-z0-9]){re.escape(alias)}(?![A-Za-z0-9])", window_text, re.I):
            return True
    if re.search(r"\bthe (?:Company|Group|Corporation|Registrant)\b", window_text, re.I):
        return True
    # Case-sensitive on purpose: "US"/"U.S." is a country, not the registrant.
    return main_document and bool(re.search(r"\b(?:[Ww]e|[Oo]ur|us)\b", window_text))


ANY_MDL_NUMBER = re.compile(r"\bMDL\s*[-:]?\s*(?:Docket\s+)?(?:No\.?|Number|#)?\s*[-:]?\s*0?(\d{3,4})(?!\d)", re.I)


def precedent_list(text: str, start: int, end: int, mdl: int, window: int = 600) -> bool:
    """Three or more other MDL numbers within `window` characters: a list of past cases (for example a
    claims administrator's credentials in a settlement exhibit), not a statement about the registrant."""
    chunk = text[max(0, start - window): end + window]
    others = {int(n) for n in ANY_MDL_NUMBER.findall(chunk)} - {mdl}
    return len(others) >= 3


def about_registrant(text: str, start: int, end: int, aliases, main_document: bool, mdl: int) -> bool:
    """Main documents: the registrant (name, 'the Company', or 'we/our/us') within 800 characters.
    Exhibits (EX-99 / EX-13): the registrant's name or 'the Company' within 400 characters, and the
    passage must not be a list of three or more other MDLs."""
    if main_document:
        return self_reference(text[max(0, start - 800): end + 800], aliases, True)
    if precedent_list(text, start, end, mdl):
        return False
    return self_reference(text[max(0, start - 400): end + 400], aliases, False)


def document_counts(form: str | None, file_type: str | None) -> bool:
    """Main documents of the registrant's report and its EX-99 / EX-13 report exhibits count. Contracts,
    instruments, consent decrees and other exhibits (EX-1..EX-10, EX-2x and so on) never do, because they
    quote other cases as precedent or describe counterparties."""
    ft = (file_type or "").upper()
    if not ft.startswith("EX-"):
        return True
    return ft.startswith("EX-99") or ft.startswith("EX-13")


_SUBJ = r"(?:the Company|the Group|we|us|our|it|its subsidiar\w+|our subsidiar\w+|certain (?:of (?:its|our) )?subsidiar\w+|{aliases})"


def _role_patterns(aliases):
    alias = "|".join(re.escape(a) for a in aliases) or "(?!x)x"
    subj = _SUBJ.format(aliases=alias)
    # Tokens are strictly alternating word / non-word runs (\w+\W+) so the patterns cannot backtrack
    # catastrophically on dot leaders or punctuation-heavy tables in filings.
    defendant = re.compile(
        rf"{subj}\W+(?:\w+\W+){{0,8}}?(?:(?:has|have) been|is|are|was|were|being)\W+(?:\w+\W+){{0,3}}?(?:co-)?defendants?\b"
        rf"|{subj}\W+(?:\w+\W+){{0,8}}?named\W+(?:\w+\W+){{0,3}}?defendants?\b"
        rf"|(?:lawsuits?|actions?|claims?|complaints?|cases?|suits?)\W+(?:\w+\W+){{0,7}}?against\W+(?:\w+\W+){{0,8}}?{subj}\b"
        rf"|(?:sued|suing|naming)\W+(?:\w+\W+){{0,4}}?{subj}\b",
        re.I,
    )
    plaintiff = re.compile(
        rf"{subj}\W+(?:\w+\W+){{0,4}}?(?:filed|brought|commenced|initiated)\W+(?:\w+\W+){{0,3}}?(?:suit|lawsuit|complaint|action|claims?)\b"
        rf"|{subj}\W+(?:\w+\W+){{0,4}}?(?:is|are|was|were)\W+(?:a |the )?plaintiffs?\b|settlement class members?\b",
        re.I,
    )
    return defendant, plaintiff


NOT_NAMED = re.compile(
    r"(?:has|have|had) not (?:yet )?been (?:named|served)|not (?:been )?named as (?:a )?defendants?|(?:is|are) not (?:a )?(?:named )?(?:defendants?|part(?:y|ies))"
    r"|not a defendant",
    re.I,
)


CLAIMANT = re.compile(
    r"(?:the Company|we|it)\W+(?:is|are|was|were)\W+(?:\w+\W+){0,3}?(?:class of plaintiffs|plaintiff class|class members?|settlement class)",
    re.I,
)
NEAR_WINDOW = 900
WIDE_WINDOW = 1500


def role_hint(snippet: str, aliases=(), wide: str | None = None) -> str:
    """Deterministic reading of a passage: not_named, plaintiff (claimant / class member), defendant or unclear.

    `snippet` is the passage near the evidence match; `wide` (optional) is a longer passage used only
    for explicit class-membership statements ('the Company is in the class of plaintiffs'), which a
    filing may make a paragraph after it names the MDL. Explicit statements win over generic phrasing."""
    if NOT_NAMED.search(snippet):
        return "not_named"
    if CLAIMANT.search(wide if wide is not None else snippet):
        return "plaintiff"
    defendant, plaintiff = _role_patterns(aliases)
    if defendant.search(snippet):
        return "defendant"
    if plaintiff.search(snippet):
        return "plaintiff"
    return "unclear"


def role_at(text: str, start: int, end: int, aliases=()) -> str:
    """Role reading for an evidence match at text[start:end] (near window 900, wide window 1,500 characters)."""
    near = text[max(0, start - NEAR_WINDOW): end + NEAR_WINDOW]
    wide = text[max(0, start - WIDE_WINDOW): end + WIDE_WINDOW]
    return role_hint(near, aliases, wide)


def verify(text: str, *, tier: str, mdl: int, caption: str | None, subjects=None, pl_terms=None, mdl_terms=None,
           aliases=(), main_document=True):
    """Return (start, end, matched) when the tier's rule holds in this filing text, else None.

    Every tier also requires the passage to refer to the registrant (see about_registrant); tier A
    also requires litigation vocabulary within 300 characters of the number (so 'MDL 3040' as a
    Queensland mineral-development licence is not a docket)."""
    found = None
    if tier == "A":
        for m in number_pattern(mdl).finditer(text):
            if LITIGATION_CONTEXT.search(text[max(0, m.start() - 300): m.end() + 300]):
                if about_registrant(text, m.start(), m.end(), aliases, main_document, mdl):
                    return m.start(), m.end(), m.group(0)
        return None
    if tier == "B":
        if not caption:
            return None
        for m in caption_pattern(caption).finditer(text):
            if about_registrant(text, m.start(), m.end(), aliases, main_document, mdl):
                return m.start(), m.end(), m.group(0)
        return None
    if tier == "C" and subjects:
        found = subject_match(text, subjects[0], subjects[1], pl_terms, mdl_terms)
        if found and not about_registrant(text, found[0], found[1], aliases, main_document, mdl):
            # Try later occurrences that do refer to the registrant.
            offset = found[1]
            while found:
                nxt = subject_match(text[offset:], subjects[0], subjects[1], pl_terms, mdl_terms)
                if not nxt:
                    return None
                found = (nxt[0] + offset, nxt[1] + offset, nxt[2])
                if about_registrant(text, found[0], found[1], aliases, main_document, mdl):
                    return found
                offset = found[1]
        return found
    return None
