"""Deterministic, conservative title derivation from a document's own first-page text.

A title is returned only when exactly one title block is typographically distinguishable (or one standalone
document-type heading exists) and every quality gate passes. Anything else returns (None, reason): the caller
records "Not recorded". Nothing here ever composes words that are not on the page.
"""
import re
import unicodedata

METHOD_BLOCK = "first_page_title_block"
METHOD_DOCTYPE = "first_page_doctype_heading"
METHOD_H1 = "first_h1_markdown"

TOP_FRACTION = 0.55
MAX_BLOCK_LINES = 4
MAX_TITLE_CHARS = 220
MIN_TITLE_CHARS = 5

CAPTION_RE = re.compile(
    r"^(?:(?:IN|FOR) THE\b.*|THE\b.*COURT.*|UNITED STATES\b.*|U\.?S\.? (?:DISTRICT|BANKRUPTCY|COURT)\b.*|"
    r"(?:SUPREME|SUPERIOR|CIRCUIT|DISTRICT|COUNTY|MUNICIPAL|PROBATE|FAMILY|JUVENILE|APPELLATE|APPEALS) COURT\b.*|"
    r"COURT OF\b.*|STATE OF\b.*|COMMONWEALTH OF\b.*|.*\b(?:DISTRICT|CIRCUIT|COUNTY|DIVISION) OF\b.*|"
    r"(?:\w+ ){0,4}(?:JUDICIAL )?(?:DISTRICT|CIRCUIT)(?: COURT)?|.*\bCOURTS?\b|.*\bCOUNTY,? [A-Z ]+)$",
    re.I,
)
COURT_ONLY_RE = re.compile(
    r"^(?:(?:IN|FOR|OF) THE\s+)?(?:(?:UNITED STATES|U\.?S\.?)\s+)?(?:(?:[A-Z][A-Za-z.'’-]*\s+){0,5})"
    r"(?:COURT(?:S)?|DISTRICT|CIRCUIT|COUNTY|DIVISION|STATE|COMMONWEALTH)(?:\s+(?:OF|FOR)\s+[A-Za-z .,'’-]+)?[,.:;]?$",
    re.I,
)
NOISE_RES = [
    re.compile(p, re.I)
    for p in (
        r"^page\s+\d+(\s+of\s+\d+)?$",
        r"^\d{1,4}$",
        r"^[\W_]*$",
        r"^case\s+[\d:]+",
        r"^\d+:\d+-[a-z]{2}-\d+",
        r"^(doc(?:ument)?\.?\s*(type|no|#)|date filed|filed\s|entered\s|rev(ised)?\.?\s|\(rev)",
        r"^(ao|aoc|cc|dr|jv|jd|form|mc|fl|sc|cv|ca)[-\s]?[\w-]*\d[\w./-]*(\s*\(rev.*\))?$",
        r"^https?://",
        r"^www\.",
        r"^#:\s*\d+",
        r"^\d{1,2}/\d{1,2}/\d{2,4}$",
        r"^(page|pg\.?)\s*\d+",
        r"^official\s+form\s+\d",
        r"^fill in this information",
        r"^(filed|e-?filed|received|lodged|entered|recorded)[\s:.]*(\d.*)?$",
        r"^(exhibit|attachment)\s+[a-z0-9]+$",
    )
]
DATE_ONLY_RE = re.compile(
    r"^(?:(?:mon|tues|wednes|thurs|fri|satur|sun)day,?\s+)?(?:january|february|march|april|may|june|july|august|"
    r"september|october|november|december)\s+\d{1,2},?\s+\d{4}$",
    re.I,
)
DOC_TYPE_HEADING_RE = re.compile(
    r"^(?:(?:AMENDED|SUPPLEMENTAL|PROPOSED|FINAL|STANDING|GENERAL|ADMINISTRATIVE|SCHEDULING|PROTECTIVE|CASE MANAGEMENT|"
    r"AGREED|STIPULATED|JOINT|EMERGENCY|SECOND|THIRD)\s+)*"
    r"(?:ORDER|JUDGMENT|OPINION|MEMORANDUM OPINION|MEMORANDUM DECISION|MEMORANDUM|COMPLAINT|PETITION|MOTION|NOTICE|"
    r"SUMMONS|SUBPOENA|ANSWER|AFFIDAVIT|DECLARATION|STIPULATION|AGENDA|MINUTES|APPLICATION|"
    r"MOTION (?:TO|FOR) [A-Z ,’'-]{3,80}|ORDER (?:ON|REGARDING|RE|GRANTING|DENYING|TO|FOR) [A-Z ,’'-]{3,80}|"
    r"(?:GENERAL|STANDING|ADMINISTRATIVE) ORDER (?:NO\.?|NUMBER|#)\s*[\w.-]+)"
    r"[.:]?$",
)
TITLE_VOCAB = set("""
act advisory agenda analysis announcement answer appendix application applications appointment assignment authorization
budget bulletin calendar caseload certificate certification charge checklist circular code commission committee complaint compliance
consent cover declaration designation disclosure discovery docket document employment evidence exhibit filing financial form forms
general glossary guide guidelines guidance handbook hearing index indicators information instructions interpreter jurors jury
judgment letter list manual measures meeting memorandum minutes motion news newsletter notice opinion order orders plan petition
policy practice press probation procedure procedures proceedings program proposal questionnaire recommendations registration
release report reports request requirements response rule rules schedule scheduling section settlement standards standing
statement statistics statistical statute subpoena summary summons table tables testing transcript trial vacancy verdict waiver
warrant worksheet writ
""".split())
STATE_ONLY_RE = re.compile(
    r"^(alabama|alaska|arizona|arkansas|california|colorado|connecticut|delaware|florida|georgia|hawaii|idaho|illinois|indiana|iowa|kansas|"
    r"kentucky|louisiana|maine|maryland|massachusetts|michigan|minnesota|mississippi|missouri|montana|nebraska|nevada|new hampshire|"
    r"new jersey|new mexico|new york|north carolina|north dakota|ohio|oklahoma|oregon|pennsylvania|rhode island|south carolina|"
    r"south dakota|tennessee|texas|utah|vermont|virginia|washington|west virginia|wisconsin|wyoming|puerto rico|guam)$",
    re.I,
)
STAMP_RE = re.compile(
    r"^(decision dated and filed|done this\b.*|for informational purposes only.*|not an official.*|non-?precedential decision.*|"
    r"(?:mon|tues|wednes|thurs|fri|satur|sun)day|(?:january|february|march|april|may|june|july|august|september|october|november|december)(?:\s+\d{4})?|"
    r"memorandum to|office of court administration|attendance and introductions|solamente para.*|sealed|draft|confidential)[.:]?$",
    re.I,
)
BLANK_RE = re.compile(r"_{3,}|\.{5,}")
VOWEL_RE = re.compile(r"[aeiouyAEIOUY]")


def clean(text):
    text = unicodedata.normalize("NFKC", text).replace("\u00ad", "")
    return re.sub(r"\s+", " ", text).strip()


def is_noise(text):
    t = clean(text)
    return any(r.match(t) for r in NOISE_RES) or bool(DATE_ONLY_RE.match(t))


def garbled(text):
    toks = re.findall(r"\S+", text)
    if not toks:
        return True
    letters = sum(c.isalpha() for c in text)
    if letters < 3 or letters / max(len(text.replace(" ", "")), 1) < 0.6:
        return True
    bad = sum(1 for t in toks if len(t) > 2 and re.search(r"[A-Za-z]", t) and not VOWEL_RE.search(t) and not re.match(r"^[A-Z.\-/&]+\d*$", t))
    if bad / len(toks) > 0.2:
        return True
    if re.search(r"[A-Za-z][^\w\s.,'’&/:;()\-–—§$%\"“”?!][A-Za-z]", text):
        return True
    if any(re.search(r"[a-z][A-Z]{2,}", t) or re.match(r"^[.,;:]+\d", t) or re.search(r"[^aeiouyAEIOUY\W\d_]{7,}", t) for t in toks):
        return True
    return False


def single_letter_spacing(text):
    toks = text.split()
    return len(toks) >= 5 and sum(len(t) == 1 for t in toks) / len(toks) > 0.6


GENERIC_TYPE_RE = re.compile(
    r"^(?:(?:AMENDED|SUPPLEMENTAL|PROPOSED|FINAL|STANDING|GENERAL|ADMINISTRATIVE)\s+)*"
    r"(?:ORDER|JUDGMENT|OPINION|MEMORANDUM(?: OPINION| DECISION)?|COMPLAINT|PETITION|MOTION|NOTICE|SUMMONS|SUBPOENA|ANSWER|"
    r"AFFIDAVIT|DECLARATION|STIPULATION|APPLICATION|ORDER AND NOTICE)[.:]?$",
    re.I,
)
NON_LATIN_RE = re.compile(r"[^\W\d_]", re.UNICODE)


def has_non_latin(text):
    return any(c.isalpha() and "LATIN" not in unicodedata.name(c, "") for c in text)


FUNCTION_WORDS = {
    "of", "the", "and", "for", "to", "in", "on", "a", "an", "or", "by", "with", "from", "at", "as", "per", "under", "through",
    "during", "between", "into", "vs", "v", "re", "et", "al", "de", "la", "el", "y", "para", "del", "no", "not", "if", "is",
}
CONTENTS_RE = re.compile(r"^(?:table of contents|contents|index|table of authorities)\b", re.I)


def body_text_like(title):
    words = re.findall(r"[A-Za-z][A-Za-z'’-]*", title)
    if title.startswith("Table "):
        return False
    lower = [w for w in words if w[0].islower() and w.lower() not in FUNCTION_WORDS]
    return len(lower) >= 3 or "[ ]" in title or title.count(",") >= 3


def quality_reason(title, require_vocab=False):
    if has_non_latin(title):
        return "non_latin_script"
    if title.endswith(":") or title.endswith(","):
        return "ends_with_colon_or_comma"
    if any(len(t) > 24 and "-" not in t and "/" not in t and "." not in t for t in title.split()) or re.search(r"[A-Z]{2,}[a-z][A-Z]{2,}", title):
        return "garbled_or_ocr_noise"
    if re.search(r"[A-Za-z]:[A-Za-z]", title) or any(t.isalpha() and t.isupper() and len(t) >= 16 for t in title.split()):
        return "garbled_or_ocr_noise"
    if body_text_like(title):
        return "body_text_not_title"
    if CONTENTS_RE.match(title):
        return "contents_or_index_heading"
    if STAMP_RE.match(title) or STATE_ONLY_RE.match(title):
        return "header_stamp_or_letterhead"
    if require_vocab and not any(re.sub(r"[^a-z]", "", w.lower()) in TITLE_VOCAB for w in title.split()):
        return "no_document_type_word"
    if len(title) < MIN_TITLE_CHARS:
        return "too_short"
    if len(title) > MAX_TITLE_CHARS:
        return "too_long"
    if BLANK_RE.search(title):
        return "form_blanks"
    if garbled(title) or single_letter_spacing(title):
        return "garbled_or_ocr_noise"
    if title[0].islower():
        return "starts_mid_sentence"
    words = title.split()
    if len(words) > 14 and title.endswith(".") and not title.isupper():
        return "body_sentence"
    if re.search(r"\b(?:no|nos|in re)$", title, re.I) or (re.search(r"\b(?:and|of|the|to|for|in|on|a|an|or|by|with|ending|ended|through|from|during|between|under|per|at)$", title, re.I) and len(words) > 3):
        return "ends_mid_phrase"
    if re.match(r"^(?:THIS PAGE|INTENTIONALLY|BLANK|ATTACHMENT|EXHIBIT)\b", title, re.I) and len(words) < 5:
        return "blank_page_marker"
    return None


def is_caption(text):
    t = clean(text)
    return bool(COURT_ONLY_RE.match(t)) and not re.search(r"\b(order|notice|rules?|form|report|plan|policy|agenda)\b", t, re.I)


def body_size(lines):
    weight = {}
    for l in lines:
        weight[l["s"]] = weight.get(l["s"], 0) + len(l["t"])
    return max(weight.items(), key=lambda kv: (kv[1], kv[0]))[0]


def join_lines(texts):
    out = ""
    for t in texts:
        t = clean(t)
        if out.endswith("-") and out[-2:-1].isalpha() and t[:1].islower():
            out = out[:-1] + t
        else:
            out = (out + " " + t).strip()
    return out


STRICT_CAPTION_RE = re.compile(
    r"^(?:(?:IN|FOR|BEFORE) THE\s+.*(?:COURT|DISTRICT|CIRCUIT|COUNTY|STATE|JUDGES?)\b.*|(?:UNITED STATES|U\.S\.)\s+(?:DISTRICT|BANKRUPTCY|BANKRUPTCY APPELLATE)\s+COURT\b.*|"
    r"(?:SUPREME|SUPERIOR|CIRCUIT|DISTRICT|COUNTY|MUNICIPAL|PROBATE|FAMILY|JUVENILE|APPELLATE) COURT\s+(?:OF|FOR)\b.*|STATE OF [A-Z ]+|"
    r"(?:SOUTHERN|NORTHERN|EASTERN|WESTERN|CENTRAL|MIDDLE) DISTRICT OF [A-Z ]+|DISTRICT OF [A-Z ]+)$",
    re.I,
)


def caption_above(lines, idx_of_title_first):
    """Court-caption lines printed directly above the title (dates, stamps and other noise lines in between are skipped)."""
    caps, i, skipped = [], idx_of_title_first - 1, 0
    while i >= 0 and len(caps) < 3 and skipped < 4:
        t = lines[i]["t"]
        if STRICT_CAPTION_RE.match(clean(t)) and not re.search(r"\b(order|notice|rules?|report)\b", t, re.I):
            caps.insert(0, t)
        elif is_noise(t) or DATE_ONLY_RE.match(clean(t)):
            skipped += 1
        else:
            break
        i -= 1
    return join_lines(caps) if caps else None


def finish(title, method, lines, first_line, source=None):
    """Generic one-word document types ("ORDER") gain the court caption printed directly above them; without a caption they are rejected."""
    title = clean(title).rstrip(":.").strip()
    if GENERIC_TYPE_RE.match(title):
        try:
            idx = lines.index(first_line)
        except ValueError:
            idx = 0
        cap = caption_above(lines, idx)
        if not cap:
            return None, None, "generic_type_without_caption"
        title = f"{title} — {cap}"
    why = quality_reason(title, require_vocab=True)
    if why:
        return None, None, why
    return title, method, None


MAX_LEADING_LINES = 6


def _lines_before(lines, first_line):
    idx = lines.index(first_line)
    return sum(1 for l in lines[:idx] if not is_noise(l["t"]))


def _after_slip_opinion_caption(lines, first_line):
    idx = lines.index(first_line)
    return idx > 0 and bool(re.search(r"\bOpinion by\b|\b(?:September|January|April|term) Term,? \d{4}", lines[idx - 1]["t"], re.I))


POLICY_WITHHELD_RE = re.compile(r"\b(?:sealed|under seal|restricted|in camera|ex parte|redact(?:ed|ion|ions))\b", re.I)


def policy_withheld(lines, title=None):
    """Sealed, restricted, in camera, ex parte or redacted wording in the title or on the first page withholds the title."""
    text = " ".join([title or ""] + [l["t"] for l in lines[:60]])
    return bool(POLICY_WITHHELD_RE.search(text))


def title_from_first_page(lines, page_h):
    """Return (title, method, reason). reason explains a None title."""
    if not lines:
        return None, None, "no_text_layer"
    lines = [dict(l, t=clean(l["t"])) for l in lines if clean(l["t"])]
    top = [l for l in lines if l["y"] <= (page_h or 792) * TOP_FRACTION]
    if len(top) < 1:
        return None, None, "no_text_in_top_region"
    sizes = {l["s"] for l in lines}
    bodysz = body_size(lines)
    body_bold = sum(len(l["t"]) for l in lines if l["b"] and abs(l["s"] - bodysz) < 0.6) > 0.5 * sum(
        len(l["t"]) for l in lines if abs(l["s"] - bodysz) < 0.6
    )
    cand = [l for l in top if not is_noise(l["t"]) and l["s"] >= 6.5 and len(l["t"]) > 1]
    cand = [l for l in cand if not re.search(r"(?:\.{4,}|_{4,})", l["t"])]
    if not cand:
        return None, None, "only_noise_lines"

    distinct = (len(sizes) > 1) or any(l["b"] for l in lines)
    method_reason = None
    if distinct:
        def emphasis(l):
            return (l["s"], 1 if l["b"] else 0)

        best = max(emphasis(l) for l in cand)
        is_dist = best[0] >= bodysz + 0.9 or (best[0] >= bodysz - 0.3 and best[1] == 1 and not body_bold)
        if is_dist:
            runs, cur, prev_idx = [], [], None
            for i, l in enumerate(lines):
                ok = l in cand and emphasis(l) == best
                if ok and (prev_idx is None or i == prev_idx + 1):
                    cur.append(l)
                elif ok:
                    runs.append(cur)
                    cur = [l]
                else:
                    if cur:
                        runs.append(cur)
                    cur = []
                prev_idx = i if ok else None
            if cur:
                runs.append(cur)
            runs = [r for r in runs if r]
            non_caption = [r for r in runs if not (all(is_caption(x["t"]) for x in r) or is_caption(join_lines([x["t"] for x in r])))]
            if len(non_caption) == 1 and len(runs) <= 2 and len(non_caption[0]) <= MAX_BLOCK_LINES and _after_slip_opinion_caption(lines, non_caption[0][0]):
                method_reason = "opinion_headnote_ambiguous"
            elif len(non_caption) == 1 and len(runs) <= 2 and len(non_caption[0]) <= MAX_BLOCK_LINES and _lines_before(lines, non_caption[0][0]) > MAX_LEADING_LINES:
                method_reason = "title_block_not_at_page_top"
            elif len(non_caption) == 1 and len(runs) <= 2 and len(non_caption[0]) <= MAX_BLOCK_LINES:
                title = join_lines([x["t"] for x in non_caption[0]])
                t2, m2, why = finish(title, METHOD_BLOCK, lines, non_caption[0][0])
                if t2:
                    return t2, m2, None
                method_reason = why
            elif len(runs) == 0:
                method_reason = "no_title_block"
            elif len(non_caption) == 0:
                method_reason = "caption_only"
            elif len(non_caption) > 1 or len(runs) > 2:
                method_reason = "multiple_title_blocks"
            else:
                method_reason = "title_block_too_long"
        else:
            method_reason = "no_distinct_typography"
    else:
        method_reason = "uniform_typography"

    heads = [l for l in top[:18] if DOC_TYPE_HEADING_RE.match(l["t"].upper().strip())]
    if len(heads) == 1:
        head = heads[0]
        base = head["t"].rstrip(":.").strip()
        if not quality_reason(base, True) or GENERIC_TYPE_RE.match(base):
            t2, m2, why = finish(base, METHOD_DOCTYPE, lines, head)
            if t2:
                return t2, m2, None
            method_reason = why or method_reason
    return None, None, method_reason or "no_title_found"


H1_RE = re.compile(r"^#[ \t]+(.+?)[ \t#]*$")
HEADING_RE = re.compile(r"^#{1,6}[ \t]+\S")
H1_BOILERPLATE_RE = re.compile(r"^(?:THIS PAGE INTENTIONALLY (?:LEFT )?BLANK|PLEASE DON.T CITE THIS!?|PAGE \d+)$", re.I)


def title_from_markdown(text):
    """First H1 of stored Markdown text, accepted only when it is also the first heading of any level."""
    first_heading = None
    for raw in (text or "").split("\n"):
        if HEADING_RE.match(raw):
            first_heading = raw
            break
    if first_heading is None:
        return None, None, "no_heading"
    m = H1_RE.match(first_heading)
    if not m:
        return None, None, "first_heading_is_not_h1"
    title = re.sub(r"[*_`]+", "", clean(m.group(1)))
    title = clean(title)
    why = quality_reason(title, require_vocab=True)
    if why:
        return None, None, why
    if len(title) > 100 or re.match(r"^COMMITTEE ON RULES OF PRACTICE AND PROCEDURE\b", title, re.I):
        return None, None, "letterhead_or_court_caption"
    if re.search(r"WASHINGTON,? D\.? ?C\.?", title, re.I) or re.search(r"\b\d{5}(?:-\d{4})?$", title) or re.match(r"^(?:STATE OF|IN THE|FOR THE|CIRCUIT COURT|[A-Z0-9 ]+ JUDICIAL CIRCUIT)\b", title, re.I):
        return None, None, "letterhead_or_court_caption"
    if H1_BOILERPLATE_RE.match(title) or DATE_ONLY_RE.match(title):
        return None, None, "boilerplate_or_date_only"
    if is_caption(title):
        return None, None, "court_caption_only"
    return title, METHOD_H1, None


def is_placeholder_title(title):
    return (title or "").strip().lower() in ("(untitled)", "untitled")


METHOD_OCR_BLOCK = "first_page_ocr_title_block"
METHOD_OCR_DOCTYPE = "first_page_ocr_doctype_heading"
OCR_MIN_CONFIDENCE = 0.93
OCR_EMPHASIS_RATIO = 1.3
_OCR_MIXED_TOKEN_RE = re.compile(r"[A-Za-z]+\d+[A-Za-z]+|\d+[A-Za-z]{4,}|[A-Za-z]{4,}\d+")
_OCR_ALLOWED_ALNUM_RE = re.compile(r"^(?:\d+(?:st|nd|rd|th)|[A-Za-z]{1,3}-?\d+[A-Za-z]?(?:\.|,)?)$", re.I)


def ocr_gate(title, lines):
    """Extra gates for OCR text: recognition confidence, run-together words, letter/digit confusions, stray symbols."""
    for w in title.split():
        letters = re.sub(r"[^A-Za-z]", "", w)
        if len(letters) >= 16 or re.search(r"[a-z][A-Z][a-z]", w) or (len(letters) >= 15 and letters.islower()):
            return "ocr_run_together_words"
        if _OCR_MIXED_TOKEN_RE.search(w) and not _OCR_ALLOWED_ALNUM_RE.match(w.strip(".,;:()")):
            return "ocr_letter_digit_confusion"
    if re.search(r"[|{}\[\]<>~^_*=\\\\]", title):
        return "ocr_stray_symbols"
    flat = clean(title)
    for l in lines:
        t = clean(l["t"])
        if len(t) >= 3 and t in flat and l.get("c", 1.0) < OCR_MIN_CONFIDENCE:
            return "ocr_low_confidence"
    return None


def title_from_ocr_first_page(lines, page_h):
    """OCR lines have box heights, no bold: heights are quantised to body / emphasised, then the text-layer rules and OCR gates apply."""
    lines = [dict(l) for l in lines if clean(l["t"])]
    if not lines:
        return None, None, "ocr_no_text"
    body = body_size(lines)
    q = [dict(l, s=20.0 if l["s"] >= body * OCR_EMPHASIS_RATIO else 10.0, b=False) for l in lines]
    title, method, reason = title_from_first_page(q, page_h)
    if not title:
        return None, None, "ocr_" + (reason or "no_title_found")
    if policy_withheld(lines, title):
        return None, None, "ocr_policy_withheld"
    why = ocr_gate(title, lines)
    if why:
        return None, None, why
    return title, (METHOD_OCR_BLOCK if method == METHOD_BLOCK else METHOD_OCR_DOCTYPE), None
