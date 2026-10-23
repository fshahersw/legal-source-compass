"""Pure text rules for 10-K legal-proceedings extraction (wave 1025, api-law). No network.

render(raw)            the visible text of an EDGAR HTML or plain-text document: hidden blocks (script, style, the inline
                       XBRL header) removed, HTML block elements and <br> as line breaks, tags removed, entities decoded,
                       runs of spaces collapsed, blank lines dropped. Characters are otherwise kept as published (no dash
                       or quote folding), so every extracted span is a verbatim slice of this rendering.
item3(text)            the Item 3 "Legal Proceedings" section: from a line-start heading to the next Item 4 / Item 3A /
                       Part II heading; of several candidates (a table of contents repeats the heading) the longest.
note_numbers(s)        note numbers an Item 3 section points to ("Note 19", "Notes 12 and 15").
note_section(text, l)  the financial-statement note labelled l (19, 12b, I): from its line-start heading ("19. Legal proceedings",
                       "NOTE 15 - COMMITMENTS AND CONTINGENCIES") to the next note's heading; the longest candidate.
titled_notes(text)     notes whose heading names contingencies, litigation or legal proceedings (when Item 3 names no
                       number).
mdl_mentions(s)        MDL numbers written in the text ("MDL No. 2738", "MDL 2846", "3:16-md-02738"): a mention, never
                       membership.
Every section is returned as (start, end) offsets into the rendering, with the heading as written.
"""
import html
import re

HIDDEN = re.compile(r"<(script|style|ix:header)\b[^>]*>.*?</\1\s*>", re.I | re.S)
COMMENT = re.compile(r"<!--.*?-->", re.S)
BLOCK = re.compile(r"</?(?:p|div|tr|li|h[1-6]|table|thead|tbody|ul|ol|blockquote|center|pre|section|article)\b[^>]*>|<br\s*/?>", re.I)
TAG = re.compile(r"<[^>]+>")
HTML_HINT = re.compile(r"<(?:p|div|td|font|html|body|table)\b", re.I)
SPACES = re.compile(r"[^\S\n]+")

RENDERING = "edgar_text.render v1: hidden blocks removed; block elements and <br> as line breaks; tags removed; HTML entities decoded; spaces collapsed; blank lines dropped; characters kept as published"


def render(raw: bytes) -> str:
    text = raw.decode("utf-8", "replace")
    if HTML_HINT.search(text[:400000]):
        text = COMMENT.sub(" ", text)
        text = HIDDEN.sub(" ", text)
        text = re.sub(r"\s+", " ", text)  # source line breaks are not structure in HTML
        text = BLOCK.sub("\n", text)
        text = TAG.sub(" ", text)
        text = html.unescape(text)
    else:
        text = text.replace("\r\n", "\n").replace("\r", "\n")
    lines = [SPACES.sub(" ", line).strip() for line in text.split("\n")]
    return "\n".join(line for line in lines if line)


ITEM3 = re.compile(r"(?im)^[ \t]*item[ \t]*3[ \t]*[.:\-–—]?[ \t]*(?:\n[ \t]*)?legal[ \t]+proceedings\b[^\n]*")
END = re.compile(r"(?im)^[ \t]*(?:item[ \t]*(?:4|3a)[ \t]*[.:\-–— \n]|part[ \t]+ii\b)")
SECTION_CAP = 200_000


def item3(text: str):
    """(heading, start, end) of the Item 3 section, or None. start is the heading's offset; end the next heading's."""
    best = None
    for m in ITEM3.finditer(text):
        e = END.search(text, m.end())
        end = e.start() if e else min(len(text), m.end() + SECTION_CAP)
        end = min(end, m.start() + SECTION_CAP)
        if best is None or end - m.start() > best[2] - best[1]:
            best = (m.group(0).replace("\n", " "), m.start(), end)
    return best


NOTE_REF = re.compile(r"\bNotes?[ \t]+(\d{1,2}[a-z]?|[A-Z])\b(?:[ \t]*(?:,|and|&)[ \t]*(\d{1,2}[a-z]?|[A-Z])\b)?(?:[ \t]*(?:,|and|&)[ \t]*(\d{1,2}[a-z]?|[A-Z])\b)?")


def note_numbers(section: str):
    """Note labels an Item 3 section names: numbers ("Note 19"), numbers with a letter ("Note 12b") or letters ("Note I")."""
    out = []
    for m in NOTE_REF.finditer(section):
        for g in m.groups():
            if g and g not in out:
                out.append(g)
    return out


def next_label(label: str):
    """The label of the following note: 19 → 20, 12b → 12c (or 13), I → J."""
    if label.isdigit():
        return [str(int(label) + 1)]
    if re.fullmatch(r"\d{1,2}[a-z]", label):
        return [label[:-1] + chr(ord(label[-1]) + 1), str(int(label[:-1]) + 1)]
    return [chr(ord(label) + 1)]


SEP = r"(?:[ \t]*[.:\-–—][ \t]*|[ \t]+)"


def _heading(label: str):
    lab = "0?" + re.escape(label) if label.isdigit() else re.escape(label)
    return re.compile(rf"(?m)^[ \t]*(?:(?i:note)[ \t]*)?{lab}{SEP}([A-Z][^\n]{{2,160}})$")


def _sub_heading(letter: str):
    return re.compile(rf"(?m)^[ \t]*\(?{letter}\)?[ \t]*[.:)][ \t]*(?:\n[ \t]*)?([A-Z][^\n]{{2,160}})$")


def note_section(text: str, label):
    """(heading, start, end) of the note with this label, or None. A heading counts only when its line starts with the
    label (or 'Note <label>') followed by a capitalised title; the section runs to the next note's heading, else at most
    SECTION_CAP characters. A label with a letter (12b) is the lettered sub-heading inside note 12."""
    label = str(label)
    m = re.fullmatch(r"(\d{1,2})([a-z])", label)
    if m:
        base = note_section(text, m.group(1))
        if not base:
            return None
        _, a, e = base
        sub = _sub_heading(m.group(2)).search(text, a, e)
        if not sub:
            return None
        nxt = _sub_heading(chr(ord(m.group(2)) + 1)).search(text, sub.end(), e)
        return (re.sub(r"\s+", " ", sub.group(0).strip()), sub.start(), nxt.start() if nxt else e)
    best = None
    nexts = [_heading(n) for n in next_label(label) if not re.fullmatch(r"\d{1,2}[a-z]", n)]
    for h in _heading(label).finditer(text):
        title = h.group(1)
        if re.match(r"(?i)^(?:and|to|of|the|in|percent|%|million|billion)\b", title):
            continue
        ends = [x.start() for x in (p.search(text, h.end()) for p in nexts) if x]
        end = min(ends) if ends else min(len(text), h.end() + SECTION_CAP)
        end = min(end, h.start() + SECTION_CAP)
        if best is None or end - h.start() > best[2] - best[1]:
            best = (h.group(0).strip(), h.start(), end)
    return best


TITLED = re.compile(r"(?m)^[ \t]*(?:(?i:note)[ \t]*)?(\d{1,2}|[A-Z])(?:[ \t]*[.:\-–—][ \t]*|[ \t]+)((?:[^\n]{0,60}\b)?(?i:contingenc|litigation|legal[ \t]+proceedings|legal[ \t]+matters)[^\n]{0,100})$")


def titled_notes(text: str):
    """[(label, heading, start, end)] of notes whose heading names contingencies, litigation or legal proceedings."""
    seen, out = set(), []
    for m in TITLED.finditer(text):
        label = m.group(1)
        if label in seen:
            continue
        sec = note_section(text, label)
        if sec and sec[2] - sec[1] > 300 and re.search(r"(?i)contingenc|litigation|legal", sec[0]):
            seen.add(label)
            out.append((label, *sec))
    return out


MDL = re.compile(r"\bMDL[ \t]*[-:]?[ \t]*(?:Docket[ \t]+)?(?:No\.?|Number|#)?[ \t]*[-:]?[ \t]*(\d{3,4})(?!\d)")
MASTER = re.compile(r"\b\d{1,2}[-:]?\d{0,2}-?md-0?(\d{3,4})(?!\d)", re.I)


def mdl_mentions(section: str):
    """[{as_written, mdl_number, offset}] in reading order (offsets relative to the section)."""
    out = []
    for pattern, form in ((MDL, "MDL number"), (MASTER, "MDL master docket")):
        for m in pattern.finditer(section):
            out.append({"as_written": m.group(0), "mdl_number": int(m.group(1)), "offset": m.start(), "form": form})
    out.sort(key=lambda x: x["offset"])
    return out
