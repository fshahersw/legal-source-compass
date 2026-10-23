"""Parser for the CFR "Subject/Agency Index" (CFR Index and Finding Aids, GovInfo PDF rendition).

Why the PDF and not the text rendition: the index prints subject headings in a bold face and everything under them in a
roman face at the same left margin, so the text rendition cannot tell a heading from a first-level entry. The PDF carries
the face of every word and the exact left edge of every line; the text rendition also drops diacritics ("Papahanaumokuakea")
and breaks "See also" ("See al"). The PDF is the primary source; the text rendition is only a cross-check
(verify_ecfr_authorities.py).

Layout (verified over all 959 pages): two columns per page, left margin 128 pt and 308 pt; body text between 175 and 718 pt
from the top; one level of nesting is 9 pt; a wrapped line is indented 18 pt more than the entry it continues. Cross
references ("See ...", "See also ...") start with an italic "See" and wrap at their own hanging indents (not multiples of
9). Letter dividers ("A", "B", ...) are centred far from the margin and are skipped.

Output: a list of headings, each with its cross references and its entries in print order. An entry is
{level, text, refs: [{title, designation}], xref: bool}; `text` is the entry as printed (wraps joined, diacritics
recomposed). Nothing is guessed: text that carries no "<title> CFR <designation>" reference simply has refs == [].
"""
from __future__ import annotations

import collections
import io
import re
import unicodedata
from dataclasses import dataclass, field

ORIGINS = (128.0, 308.0)
COLUMN_SPLIT = 300.0
BODY_TOP, BODY_BOTTOM = 175.0, 718.0
STEP = 9
WRAP = 18
FIRST_CONTENT_PDF_PAGE = 2  # zero-based; pages 0 and 1 are the title page and the introduction


@dataclass
class Line:
    pdf_page: int  # zero-based
    col: int
    top: float
    x_rel: int
    bold: bool
    xref_first: bool
    text: str
    big: bool = False


@dataclass
class Entry:
    level: int
    text: str
    xref: bool
    pdf_page: int
    x_rel: int
    refs: list[dict] = field(default_factory=list)


@dataclass
class Heading:
    text: str
    pdf_page: int
    entries: list[Entry] = field(default_factory=list)


def _join(a: str, b: str) -> str:
    b = b.strip()
    if not a:
        return b
    return a + b if a.endswith(("-", "—")) else a + " " + b


def recompose(text: str) -> str:
    """'a¯' (letter + spacing macron, as the PDF encodes them) -> the precomposed letter; nothing else changes."""
    text = re.sub(r"([A-Za-z])¯", lambda m: m.group(1) + "̄", text)
    return unicodedata.normalize("NFC", text)


def pdf_lines(pdf_bytes: bytes, progress=None) -> list[Line]:
    import pdfplumber  # noqa: PLC0415

    pdf = pdfplumber.open(io.BytesIO(pdf_bytes))
    lines: list[Line] = []
    for pi in range(FIRST_CONTENT_PDF_PAGE, len(pdf.pages)):
        words = pdf.pages[pi].extract_words(extra_attrs=["fontname", "size"])
        body = [w for w in words if BODY_TOP < w["top"] < BODY_BOTTOM and w["size"] >= 8.5]  # italic words are sized 8.999999999999943
        for col in (0, 1):
            ws = [w for w in body if (w["x0"] < COLUMN_SPLIT) == (col == 0)]
            rows: dict[int, list] = collections.OrderedDict()
            for w in sorted(ws, key=lambda w: (round(w["top"]), w["x0"])):
                rows.setdefault(round(w["top"]), []).append(w)
            # fold rows whose tops differ by one point (mixed faces on one line) into the previous row
            keys = sorted(rows)
            merged: list[tuple[int, list]] = []
            for k in keys:
                if merged and k - merged[-1][0] <= 1:
                    merged[-1][1].extend(rows[k])
                else:
                    merged.append((k, list(rows[k])))
            for top, r in merged:
                r.sort(key=lambda w: w["x0"])
                text = recompose(" ".join(w["text"] for w in r))
                lines.append(
                    Line(
                        pdf_page=pi,
                        col=col,
                        top=float(top),
                        x_rel=int(round(r[0]["x0"] - ORIGINS[col])),
                        bold=all("Demi" in w["fontname"] for w in r),
                        xref_first=("Italic" in r[0]["fontname"] and r[0]["text"] == "See"),
                        text=text,
                        big=max(w["size"] for w in r) >= 12,
                    )
                )
        if progress and pi % 100 == 0:
            progress(pi)
    return lines


DANGLING_CFR = re.compile(r"\b\d{1,2} CFR$")
REF_RE = re.compile(r"(?<![\w.])(\d{1,2}) CFR (\d+[A-Za-z]{0,2}(?:[-\u2013]\d+[A-Za-z]{0,2})?)((?: \((?![^)]*[A-Za-z]{3})[^),]{1,60}\))?)")


def extract_refs(text: str) -> list[dict]:
    """Every 'T CFR D' in an entry: {title, part, sections}. `part` is the part designation with an en dash written as
    a hyphen ('101\u20138' -> '101-8', the eCFR form); `sections` is the parenthesised section range that follows
    ('1 (1.1\u20131.11)' -> '1.1\u20131.11') or None. Lists such as '40 CFR 52, 81' keep their first designation here and
    leave the rest in the printed text; text with no 'T CFR D' (a missing number, 'Part 200', 'Chapter 1') gives []."""
    out = []
    for m in REF_RE.finditer(text):
        sections = m.group(3).strip()
        out.append(
            {
                "title": int(m.group(1)),
                "part": m.group(2).replace("\u2013", "-"),
                "sections": sections[1:-1] if sections else None,
            }
        )
    return out


def build(lines: list[Line]) -> tuple[list[Heading], list[dict]]:
    headings: list[Heading] = []
    anomalies: list[dict] = []
    head: Heading | None = None
    cur: Entry | None = None
    last_was_heading_line = False
    started = False

    for ln in lines:
        if ln.big:  # title lines of the index
            continue
        if ln.x_rel > 60:  # letter divider or title lines
            if re.fullmatch(r"[A-Z]", ln.text.strip()):
                started = True
            continue
        if not started:
            continue
        if ln.bold and ln.x_rel == 0:
            head = Heading(text=ln.text.strip(), pdf_page=ln.pdf_page)
            headings.append(head)
            cur = None
            last_was_heading_line = True
            continue
        if ln.bold and last_was_heading_line and head is not None and not head.entries and ln.x_rel in (WRAP, STEP):
            head.text = _join(head.text, ln.text)  # a long heading wrapped onto a second line
            continue
        last_was_heading_line = False
        if head is None:
            anomalies.append({"page": ln.pdf_page + 1, "kind": "text before the first heading", "text": ln.text[:100]})
            continue
        if ln.bold:
            anomalies.append({"page": ln.pdf_page + 1, "kind": f"bold line at indent {ln.x_rel} (kept as an entry)", "text": ln.text[:100]})
        if ln.xref_first:
            cur = Entry(level=ln.x_rel // STEP, text=ln.text.strip(), xref=True, pdf_page=ln.pdf_page, x_rel=ln.x_rel)
            head.entries.append(cur)
            continue
        if cur is not None and cur.xref and ln.x_rel % STEP != 0:
            cur.text = _join(cur.text, ln.text)
            continue
        if cur is not None and not cur.xref and ln.x_rel == cur.x_rel + WRAP:
            cur.text = _join(cur.text, ln.text)
            continue
        if cur is not None and not cur.xref and DANGLING_CFR.search(cur.text) and re.match(r"\d", ln.text):
            cur.text = _join(cur.text, ln.text)
            continue
        if cur is not None and cur.xref and ln.x_rel == cur.x_rel + WRAP:
            cur.text = _join(cur.text, ln.text)
            continue
        if ln.x_rel % STEP != 0:
            anomalies.append({"page": ln.pdf_page + 1, "kind": f"line at indent {ln.x_rel}, not a multiple of {STEP}", "text": ln.text[:100]})
            if cur is not None:
                cur.text = _join(cur.text, ln.text)
                continue
        cur = Entry(level=ln.x_rel // STEP, text=ln.text.strip(), xref=False, pdf_page=ln.pdf_page, x_rel=ln.x_rel)
        head.entries.append(cur)
    for h in headings:
        for e in h.entries:
            if not e.xref:
                e.refs = extract_refs(e.text)
    return headings, anomalies
