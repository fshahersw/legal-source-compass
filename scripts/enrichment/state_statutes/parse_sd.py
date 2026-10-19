"""Parse the South Dakota Legislature's whole-title SDCL documents (api/Statutes/{title}.html?all=true).

A whole-title response is a run of complete HTML documents separated by <br /><hr><br />: the title contents,
each chapter's contents, then one document per section. Each document names itself in its og:url meta
(https://sdlegislature.gov/Statutes/<number>). A section document holds a heading paragraph (number in a SENU
span, catchline in CL spans), the section text paragraphs, and a "Source:" paragraph (the history note).

Parsing approach informed by open-us-law scripts/statutes/sd_bulk/parse.py (Apache-2.0, Vaquill AI): heading
paragraphs carry the SENU span, "Source:" paragraphs are the amendment history, contents rows end in class "B".
This parser keeps each printed paragraph as its own line (open-us-law flattens them) and splits documents by
og:url instead of CSS hashes. Text is the publisher's own words: tags removed, non-breaking spaces as spaces,
runs of spaces inside a paragraph collapsed to one; nothing is added.
"""
import re

import lxml.html

SITE = "https://sdlegislature.gov"
# Documents are usually separated by <br /><hr><br />, but an "Effective <date>" banner document can be followed
# directly by the dated section's own <html> document, so split at every <html start.
DOC_SPLIT = re.compile(r"(?=<html\b)")
OG_URL = re.compile(r'<meta property="og:url" content="https://sdlegislature\.gov/Statutes/([^"]+)"')
TITLE_TAG = re.compile(r"<title>([^<]*)</title>")
SECTION_NO = re.compile(r"^\d+[A-Z]?-\d+[A-Z]*-[0-9A-Za-z.]+$")
CHAPTER_NO = re.compile(r"^\d+[A-Z]?-\d+[A-Z]*$")
TITLE_NO = re.compile(r"^\d+[A-Z]?$")
WS = re.compile(r"[ \t\r\n    ]+")
EFFECTIVE_BANNER = re.compile(r"^Effective [A-Z][a-z]+ \d{1,2}, \d{4}$")
STATUS = re.compile(r"\b(Repealed|Transferred|Superseded|Omitted|Obsolete|Executed|Expired|Reserved|Rejected)\b", re.I)


def decode(raw):
    """SDLRC serves UTF-16 LE without a BOM (second byte 0x00); fall back to UTF-8."""
    if len(raw) > 1 and raw[1] == 0:
        return raw.decode("utf-16-le")
    return raw.decode("utf-8")


def clean(text):
    return WS.sub(" ", text or "").strip()


NUMBER = r"\d+[A-Z]?-\d+[A-Z]*-\d+[A-Za-z]*(?:\.\d+[A-Za-z]*)*(?:\([0-9A-Za-z]{1,4}\))*"
SECTION_LEAD = re.compile(r"^(" + NUMBER + r")(?=$|[.,\s])")
HEAD_LINE = re.compile(r"^(TITLE|CHAPTER)\s+(\d+[A-Z]?(?:-\d+[A-Z]*)?)\.?$", re.I)
APPENDIX = re.compile(r"^(APPENDIX\b|\d+[A-Z]?-\d+[A-Z]*-A\b)")


def classify(html):
    """(number, kind) from the document's own first printed line; og:url, when present, must agree."""
    first = next((p["text"] for p in _paragraphs(html) if p["text"]), "")
    og = OG_URL.search(html)
    og_number = og.group(1) if og else None
    head = HEAD_LINE.match(first)
    if APPENDIX.match(first):
        return og_number, "appendix"
    if head:
        kind, number = head.group(1).lower(), head.group(2)
    elif (lead := SECTION_LEAD.match(first)) :
        kind, number = "section", lead.group(1)
    else:
        return og_number, "other"
    if og_number and og_number != number:
        return number, "mismatch"
    return number, kind


def split_documents(text):
    """[(number or None, kind, html)] in publisher order; kind is title|chapter|section|other|mismatch."""
    docs = []
    for part in DOC_SPLIT.split(text):
        if "<html" not in part:
            continue
        number, kind = classify(part)
        docs.append((number, kind, part))
    return docs


def _paragraphs(html):
    tree = lxml.html.fromstring(html)
    out = []
    for p in tree.iter("p"):
        classes = p.get("class", "")
        spans = [s.get("class", "") for s in p.iter("span")]
        out.append({"cls": classes, "spans": spans, "text": clean(p.text_content()), "anchors": [a.get("href", "") for a in p.iter("a")]})
    return out


def doc_title(html):
    match = TITLE_TAG.search(html)
    return clean(match.group(1)) if match else ""


def parse_contents(html):
    """Rows of a title or chapter contents document: [(first linked number, printed row text)]."""
    rows = []
    for para in _paragraphs(html):
        if not para["cls"].endswith("B") or not para["text"]:
            continue
        number = None
        for href in para["anchors"]:
            m = re.search(r"[?&]Statute=([^&#]+)", href)
            if m:
                number = m.group(1)
                break
        rows.append((number, para["text"]))
    return rows


def parse_heading_rows(html):
    """Centered heading lines of a title/chapter document (e.g. 'TITLE 2', 'LEGISLATURE AND STATUTES')."""
    return [p["text"] for p in _paragraphs(html) if p["text"] and not p["cls"].endswith("B")]


def split_heading(number, heading_line):
    """'2-1-2, 2-1-2.1. Repealed by SL 2012...' -> ('2-1-2, 2-1-2.1', 'Repealed by SL 2012...').

    The label is the printed number or run of numbers ('A, B', 'A to B') the line starts with; the heading is the
    printed rest after the separating period. heading_line must start with number."""
    heading_line = clean(heading_line)
    tail = heading_line[len(number) :]
    m = re.match(r"^((?:\s*(?:,|to|and)\s*" + NUMBER + r")*)\.?\s*(.*)$", tail)
    if m:
        label_extra, heading = m.group(1), m.group(2)
    else:
        label_extra, heading = "", tail.lstrip(". ").strip()
    return clean(number + re.sub(r"^(?=to\b)", " ", label_extra)), heading


def label_numbers(label):
    """Explicit numbers in a printed label ('A, B to C' -> ['A', 'B', 'C']) and whether it holds a 'to' range."""
    return re.findall(NUMBER, label), " to " in f" {label} "


def parse_section(number, html):
    """One section document -> dict(number, label, heading, paragraphs, source, notes, status)."""
    paras = [p for p in _paragraphs(html) if p["text"]]
    if not paras:
        return None
    lines = list(paras)
    # Some stubs print the number alone, then "number.", then the status line: drop the bare repeats.
    while len(lines) > 1 and re.fullmatch(re.escape(number) + r"\.?", lines[0]["text"]) and lines[1]["text"].startswith(number):
        lines.pop(0)
    heading_line = lines[0]["text"]
    rest = lines[1:]
    if not heading_line.startswith(number):
        return {"number": number, "error": f"heading does not start with its number: {heading_line[:80]!r}"}
    label, heading = split_heading(number, heading_line)
    if not heading and rest and not rest[0]["text"].startswith("Source:"):
        heading, rest = rest[0]["text"], rest[1:]
    body, source, notes = [], [], []
    seen_source = False
    for para in rest:
        text = para["text"]
        if text.startswith("Source:"):
            seen_source = True
            source.append(text)
        elif seen_source:
            notes.append(text)
        else:
            body.append(text)
    status_match = STATUS.match(heading or "")
    return {
        "number": number,
        "label": label,
        "heading": heading,
        "paragraphs": body,
        "source": " ".join(source),
        "notes": notes,
        "status": status_match.group(1).capitalize() if status_match and len(body) == 0 else None,
    }


def parse_title(raw):
    """All documents of one whole-title response."""
    text = decode(raw)
    out = {"title": None, "chapters": [], "sections": [], "appendices": [], "errors": []}
    banner = None
    for number, kind, html in split_documents(text):
        if kind == "appendix":
            # Court rules, forms and regulations the publisher appends to a chapter: not codified sections.
            first = next((p["text"] for p in _paragraphs(html) if p["text"]), "")
            out["appendices"].append({"number": number, "first": first[:160]})
            banner = None
            continue
        if kind == "other":
            lines = [p["text"] for p in _paragraphs(html) if p["text"]]
            if len(lines) == 1 and EFFECTIVE_BANNER.match(lines[0]):
                # A one-line "Effective <date>" document precedes the section (or chapter) it dates.
                banner = lines[0]
                continue
        if kind == "title":
            out["title"] = {"number": number, "lines": parse_heading_rows(html), "rows": parse_contents(html), "doc_title": doc_title(html)}
        elif kind == "chapter":
            out["chapters"].append({"number": number, "lines": parse_heading_rows(html), "rows": parse_contents(html), "effective": banner})
        elif kind == "section":
            section = parse_section(number, html)
            if section is None:
                out["errors"].append({"number": number, "error": "empty document"})
            elif "error" in section:
                out["errors"].append(section)
            else:
                section["effective"] = banner
                out["sections"].append(section)
        else:
            first = next((p["text"] for p in _paragraphs(html) if p["text"]), "")
            out["errors"].append({"number": number, "error": f"{kind} document", "first": first[:120]})
        banner = None
    if banner:
        out["errors"].append({"number": None, "error": "effective banner with no following document", "first": banner})
    return out
