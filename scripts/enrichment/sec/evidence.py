"""Pure, deterministic text rules used to verify that a filing really names an MDL (unit-tested).

EDGAR full-text search is a candidate generator only: its phrase matching is loose, so every link is
re-checked here against the downloaded filing text before it is published.
"""
import html
import re

TAG = re.compile(r"<[^>]+>")
SPACE = re.compile(r"\s+")
HIDDEN = re.compile(r"<(script|style|ix:header)[^>]*>.*?</\1>", re.I | re.S)


BLOCK = re.compile(r"</?(?:p|div|tr|li|h[1-6]|table|thead|tbody|ul|ol|blockquote|center|pre)\b[^>]*>", re.I)
DOUBLE_BR = re.compile(r"(?:<br\s*/?>\s*){2,}", re.I)
HTML_HINT = re.compile(r"<(?:p|div|td|font|html|body|table)\b", re.I)


def filing_text(raw: bytes) -> str:
    """Visible text of an EDGAR HTML/TXT document: tags removed, spaces collapsed, and one newline
    between paragraphs (HTML block elements, or blank lines in plain-text filings) so rules can tell
    whether two phrases sit in the same paragraph."""
    text = raw.decode("utf-8", "replace")
    text = HIDDEN.sub(" ", text)
    if HTML_HINT.search(text[:400000]):
        text = SPACE.sub(" ", text)  # source line breaks are not structure in HTML
        text = DOUBLE_BR.sub("\n", text)
        text = BLOCK.sub("\n", text)
    else:
        text = re.sub(r"\r", "", text)
        text = re.sub(r"\n[ \t]*\n\s*", "\x00", text)
        text = SPACE.sub(" ", text).replace("\x00", "\n")
    text = TAG.sub(" ", text)
    text = html.unescape(text).replace(" ", " ").replace("‑", "-").replace("–", "-").replace("—", "-")
    text = re.sub(r"[^\S\n]+", " ", text)
    text = re.sub(r" ?\n[\s]*", "\n", text)
    return text.strip()


PARAGRAPH_CAP = 4000


def paragraph(text: str, pos: int) -> tuple[int, int]:
    """Bounds (start, end) of the paragraph containing text[pos], capped at 4,000 characters either side
    (a filing without block structure is otherwise one giant paragraph)."""
    lo = max(0, pos - PARAGRAPH_CAP)
    hi = min(len(text), pos + PARAGRAPH_CAP)
    a = text.rfind("\n", lo, pos) + 1 or lo
    a = max(a, lo)
    b = text.find("\n", pos, hi)
    return a, (hi if b < 0 else b)


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
    body = text[a:b].strip().replace("\n", " ¶ ")
    return ("… " if a > 0 else "") + body + (" …" if b < len(text) else "")


def term_pattern(term: str) -> re.Pattern:
    """Whole-word match (a trailing plural 's' allowed); 'A|B' matches either alternative; short
    all-capital terms (AFFF, ASR, ARC) are matched case-sensitively."""
    alts = term.split("|")
    flags = 0 if all(a.isupper() and len(a) <= 5 for a in alts) else re.I
    body = "|".join(re.escape(a) for a in alts)
    return re.compile(rf"(?<![A-Za-z0-9])(?:{body})s?(?![A-Za-z0-9])", flags)


SENTENCE_END = re.compile(r"(?<=[a-z0-9)”\"])[.!?](?=\s+[A-Z“\"(])")


def sentence(text: str, pos: int, pa: int, pb: int) -> tuple[int, int]:
    """Bounds of the sentence containing text[pos] within paragraph [pa, pb). A period ends a sentence
    only after a lower-case letter, digit or closing bracket/quote and before a capital, so 'U.S.
    District Court' and 'MDL No. 2738' do not split."""
    a = pa
    for m in SENTENCE_END.finditer(text, pa, pos):
        a = m.end()
    m = SENTENCE_END.search(text, pos, pb)
    return a, (m.end() if m else pb)


def section_end(text: str, pb: int, cap: int = 1500) -> int:
    """End of the section that follows a heading paragraph ending at `pb`: following paragraphs up to
    (not including) the next heading, at most `cap` characters."""
    end = pb
    while end < len(text) and end - pb < cap:
        nxt = text.find("\n", end + 1)
        nxt = len(text) if nxt < 0 else nxt
        if is_heading(text[end + 1: nxt]):
            break
        end = nxt
    return min(end, pb + cap)


def subject_matches(text: str, terms, required, pl_terms: re.Pattern, mdl_terms: re.Pattern, window: int = 500, others=()):
    """Every position where a subject term and an MDL/multidistrict mention sit in the same paragraph
    within `window` characters (or, when the term is a section heading such as 'Chantix', in the section
    under that heading), every required term and a products-liability / injury term are in the same
    section, and no other target MDL's subject is in the MDL sentence or closer to the MDL mention than
    this term (so the Zantac MDL sentence next to a talc sentence is not talc evidence)."""
    other_patterns = [term_pattern(o) for o in others]
    hits = []
    for term in terms:
        for m in term_pattern(term).finditer(text):
            pa, pb = paragraph(text, m.start())
            if is_heading(text[pa:pb]):
                a, b = m.start(), section_end(text, pb)
                context = text[m.start(): b]
            else:
                a, b = max(pa, m.start() - window), min(pb, m.end() + window)
                nxt = text.find("\n", pb + 1) if pb < len(text) else -1
                nxt = len(text) if nxt < 0 else nxt
                context = text[max(section_start(text, pa), m.start() - 2 * window): min(max(nxt, pb), m.end() + 2 * window)]
            mentions = list(mdl_terms.finditer(text, a, b))
            if not mentions:
                continue
            if not all(term_pattern(r).search(context) for r in required):
                continue
            if not pl_terms.search(context):
                continue
            nearest = min(mentions, key=lambda x: abs(x.start() - m.start()))
            npa, npb = paragraph(text, nearest.start())
            sa, sb = sentence(text, nearest.start(), npa, npb)
            if not (sa <= m.start() < sb):
                # The MDL sentence does not contain this term: reject when it names another target's
                # subject, or when another target's subject is closer to the MDL mention than this term.
                if any(op.search(text, sa, sb) for op in other_patterns):
                    continue
                dist = abs(nearest.start() - m.start())
                lo, hi = max(min(pa, npa), nearest.start() - dist), min(max(pb, npb), nearest.end() + dist)
                if any(abs(o.start() - nearest.start()) < dist for op in other_patterns for o in op.finditer(text, lo, hi)):
                    continue
            hits.append((m.start(), m.end(), term))
    return sorted(hits)


def subject_match(text: str, terms, required, pl_terms: re.Pattern, mdl_terms: re.Pattern, window: int = 500, others=()):
    """First subject match (see subject_matches) or None."""
    hits = subject_matches(text, terms, required, pl_terms, mdl_terms, window, others)
    return hits[0] if hits else None


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


INSURER = re.compile(
    r"defend\w* (?:these|such|the|those) claims under|under (?:\w+ ){0,3}(?:insurance )?polic(?:y|ies) (?:issued|written|which)"
    r"|(?:our|its) (?:insureds|policyholders)|coverage for (?:these|such|the) (?:claims|lawsuits)",
    re.I,
)


def about_registrant(text: str, start: int, end: int, aliases, main_document: bool, mdl: int) -> bool:
    """Main documents: the registrant (name, 'the Company', or 'we/our/us') within 800 characters.
    Exhibits (EX-99 / EX-13): the registrant's name or 'the Company' within 400 characters, and the
    passage must not be a list of three or more other MDLs. In every document the paragraph must not
    describe the registrant as an insurer defending policyholders' claims."""
    pa, pb = paragraph(text, start)
    if INSURER.search(text[pa:pb]):
        return False
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
        rf"|{subj}\W+(?:\w+\W+){{0,3}}?defending\W+(?:\w+\W+){{0,8}}?(?:claims|lawsuits|cases|actions|suits)\b"
        rf"|(?:lawsuits?|actions?|claims?|complaints?|cases?|suits?)\W+(?:\w+\W+){{0,14}}?against\W+(?:\w+\W+){{0,8}}?{subj}\b"
        rf"|(?:defendants|parties)\W+(?:\w+\W+){{0,3}}?including\W+(?:\w+\W+){{0,10}}?{subj}\b"
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
# Sentence-level claimant statements; the sentence must refer to the registrant and must not describe
# claims against it.
CLAIMANT_SENTENCE = re.compile(
    r"\b(?:are|is|was|were) (?:each |also |both |one of the )?(?:a |the |among the )?plaintiffs?\b"
    r"|\bjoined (?:the |a |an )?(?:\w+ ){0,3}?(?:MDL|multi-?district litigation|litigation|lawsuits?|class action)"
    r"|\basserted (?:\w+ ){0,2}?claims\b",
    re.I,
)
DISMISSED = re.compile(
    r"dismissed with prejudice|motion to dismiss (?:\w+\W+){0,12}?(?:was|were|has been|had been|is) granted"
    r"|granted (?:\w+\W+){0,4}?motions? to dismiss|does not name (?:\w+\W+){0,4}?as (?:a )?defendant"
    r"|no (?:longer (?:has )?any |)active (?:lawsuits|cases|claims)",
    re.I,
)
REFERS = r"\b(?:the Company|the Group|we|our|us|its subsidiar\w+|our subsidiar\w+|subsidiaries{aliases})\b"


def _refers(sentence: str, aliases) -> bool:
    alias = "".join("|" + re.escape(a) for a in aliases)
    return bool(re.search(REFERS.format(aliases=alias), sentence, re.I))


def claimant_statement(passage: str, aliases=()) -> bool:
    if CLAIMANT.search(passage):
        return True
    alias = "|".join(re.escape(a) for a in aliases) or "(?!x)x"
    against = re.compile(rf"against (?:the Company|us|it|{alias})\b", re.I)
    for sentence in re.split(r"(?<=[.;])\s+|\n", passage):
        if CLAIMANT_SENTENCE.search(sentence) and _refers(sentence, aliases) and not against.search(sentence):
            return True
    return False


def role_hint(snippet: str, aliases=(), wide: str | None = None) -> str:
    """Deterministic reading of a passage: not_named, plaintiff (claimant / class member), defendant or unclear.

    `snippet` is the passage near the evidence match; `wide` (optional) is a longer passage used only
    for explicit class-membership statements. Explicit statements win over generic phrasing."""
    if NOT_NAMED.search(snippet):
        return "not_named"
    if claimant_statement(snippet, aliases) or (wide is not None and CLAIMANT.search(wide)):
        return "plaintiff"
    defendant, plaintiff = _role_patterns(aliases)
    if defendant.search(snippet):
        return "defendant"
    if plaintiff.search(snippet):
        return "plaintiff"
    return "unclear"


NEAR_WINDOW = 900
WIDE_WINDOW = 1500


HEADING_MAX = 160


def is_heading(par: str) -> bool:
    """A short paragraph that does not end a sentence: a section heading such as
    'k. Dupixent Product Liability Litigation' or '• Personal Injury Actions'."""
    par = par.strip()
    return len(par) <= HEADING_MAX and not par.endswith((".", ":", ";"))


def section_start(text: str, pa: int, limit: int = 900) -> int:
    """Start of the passage that belongs with the paragraph at `pa`: earlier paragraphs of the same
    section are included back to (not including) the nearest heading, at most `limit` characters back."""
    start = pa
    while start > 0 and pa - start < limit:
        prev_end = start - 1
        prev_start = text.rfind("\n", 0, prev_end) + 1
        if is_heading(text[prev_start:prev_end]):
            break
        start = prev_start
    return max(start, pa - limit)


def role_passages(text: str, start: int, end: int) -> tuple[str, str]:
    """(near, wide) passages a role is read from: the match's paragraph plus earlier paragraphs of the
    same section (back to the nearest heading, at most 900 characters), and the paragraph after it,
    capped at 900 characters past the match; the wide passage extends to two following paragraphs and
    1,500 characters. Paragraphs above a heading never count, so a role stated about a different matter
    in the previous section does not bleed in."""
    pa, pb = paragraph(text, start)
    pa = section_start(text, pa)
    nxt = text.find("\n", pb + 1) if pb < len(text) else -1
    nxt = len(text) if nxt < 0 else nxt
    near = text[max(pa, start - NEAR_WINDOW): min(max(nxt, pb), end + NEAR_WINDOW)]
    nxt2 = text.find("\n", nxt + 1) if nxt < len(text) else -1
    nxt2 = len(text) if nxt2 < 0 else nxt2
    wide = text[max(pa, start - WIDE_WINDOW): min(max(nxt2, pb), end + WIDE_WINDOW)]
    return near, wide


def role_at(text: str, start: int, end: int, aliases=()) -> str:
    """Role reading for an evidence match at text[start:end] (see role_passages)."""
    near, wide = role_passages(text, start, end)
    return role_hint(near, aliases, wide)


def dismissed_at(text: str, start: int, end: int, aliases=()) -> bool:
    """The match's passage (see role_passages) has a sentence that both refers to the registrant and
    reports a dismissal or that the registrant is not sued (e.g. 'claims against the Company were
    dismissed with prejudice'). A dismissal of other parties' cases does not count."""
    near, _ = role_passages(text, start, end)
    for sentence in re.split(r"(?<=[.;])\s+|\n", near):
        if DISMISSED.search(sentence) and _refers(sentence, aliases):
            return True
    return False


def verify(text: str, *, tier: str, mdl: int, caption: str | None, subjects=None, pl_terms=None, mdl_terms=None,
           aliases=(), main_document=True, others=()):
    """Return (start, end, matched) when the tier's rule holds in this filing text, else None.

    Every tier also requires the passage to refer to the registrant (see about_registrant); tier A
    also requires litigation vocabulary within 300 characters of the number (so 'MDL 3040' as a
    Queensland mineral-development licence is not a docket)."""
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
        for found in subject_matches(text, subjects[0], subjects[1], pl_terms, mdl_terms, others=others):
            if about_registrant(text, found[0], found[1], aliases, main_document, mdl):
                return found
    return None
