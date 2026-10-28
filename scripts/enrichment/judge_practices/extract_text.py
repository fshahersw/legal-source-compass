"""Plain text of acquired practice documents, with the method stated for every document.

Methods (recorded on each document record as `text_method`):
  pdf   - poppler `pdftotext -layout -enc UTF-8` (a PDF with no text layer, i.e. a scanned image, yields no text; OCR is not available here and
          none is attempted: the record says so);
  docx  - python-docx paragraphs and table cells in document order;
  doc / rtf / wpd / odt - LibreOffice headless conversion to plain text (the only converter available for these formats here);
  html  - the visible text of the page's main content (scripts, styles and site navigation removed).
Whitespace is collapsed; no word is rewritten. The original bytes are stored unchanged in the bucket, so these renderings are search aids.

Contact details: the text is kept as the court published it, including chambers e-mail addresses, telephone numbers and the names of
courtroom staff (owner decision 2026-10-27, "dont withhold any data"; owner rule 2026-10-22 (3): named individuals the official publisher makes
public are shown as published). Only the length cap (TEXT_CAP, recorded on the record) shortens a text.

redact(), redact_page() and drop_staff_blocks() are kept only to reproduce the text stored before 2026-10-27 (they replaced e-mails, telephone
numbers and staff lines with "[... omitted]" markers): release_contact_text.py uses them to prove that a fresh extraction is the same text the
published record was made from before it replaces that record's text. No build path applies them.
"""
from __future__ import annotations

import os
import re
import shutil
import subprocess
import tempfile
import zipfile
from dataclasses import dataclass

TEXT_CAP = 100_000  # characters kept per document

# the dataset summary's privacy line (owner decision 2026-10-27, "dont withhold any data", with owner rule 2026-10-22 (3))
PRIVACY = ("Document text is shown as the court published it, including chambers e-mail addresses, telephone numbers and the names of courtroom staff "
           "the court prints; nothing is inferred about a person. Judge page records do not parse contact details into fields. Originals are stored unchanged.")

MAGIC = [
    (b"%PDF", "pdf"),
    (b"{\\rtf", "rtf"),
    (b"\xd0\xcf\x11\xe0\xa1\xb1\x1a\xe1", "ole"),   # legacy Word / Excel / PowerPoint
    (b"\xff\x57\x50\x43", "wpd"),
]


def detect_type(head: bytes, url_ext: str | None = None, content_type: str = "") -> str:
    """The document's real format from its first bytes (a URL ending .pdf can return an HTML error page)."""
    for sig, kind in MAGIC:
        if head.startswith(sig):
            if kind == "ole":
                return {"xls": "xls", "xlsx": "xls", "ppt": "ppt", "pptx": "ppt"}.get((url_ext or "").lower(), "doc")
            return kind
    if head.startswith(b"PK\x03\x04"):
        e = (url_ext or "").lower()
        return e if e in ("docx", "xlsx", "pptx", "odt") else "zip"
    low = head[:2048].lower()
    if b"<html" in low or b"<!doctype html" in low or b"<head" in low or b"<body" in low:
        return "html"
    if "pdf" in content_type and not head:
        return "pdf"
    if head[:2000].decode("utf-8", "ignore").isprintable() and head.strip():
        return "txt"
    return "unknown"


@dataclass
class Extracted:
    text: str
    method: str
    pages: int | None = None
    error: str | None = None


def tidy(raw: str) -> str:
    out: list[str] = []
    blank = 0
    for line in raw.replace("\r", "\n").split("\n"):
        line = re.sub(r"[ \t   ]+", " ", line).strip()
        if not line:
            blank += 1
            if blank > 1:
                continue
        else:
            blank = 0
        out.append(line)
    return "\n".join(out).replace("­", "").replace("﻿", "").strip("\n")


def pdf_text(path: str) -> Extracted:
    try:
        proc = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", path, "-"], capture_output=True, timeout=180)
    except subprocess.TimeoutExpired:
        return Extracted("", "pdftotext -layout", None, "pdftotext timed out")
    if proc.returncode != 0:
        return Extracted("", "pdftotext -layout", None, "pdftotext failed: " + proc.stderr.decode("utf-8", "replace")[:160])
    raw = proc.stdout.decode("utf-8", "replace")
    pages = raw.count("\f") or None
    text = tidy(raw.replace("\f", "\n"))
    if len(re.sub(r"\s", "", text)) < 20:
        return Extracted("", "pdftotext -layout", pages, "no text layer (scanned image); OCR not available")
    return Extracted(text, "pdftotext -layout (poppler), whitespace collapsed", pages)


def docx_text(path: str) -> Extracted:
    try:
        import docx  # python-docx

        d = docx.Document(path)
        parts: list[str] = []
        body = d.element.body
        for child in body.iterchildren():
            tag = child.tag.rsplit("}", 1)[-1]
            if tag == "p":
                parts.append("".join(t.text or "" for t in child.iter() if t.tag.rsplit("}", 1)[-1] == "t"))
            elif tag == "tbl":
                for row in child.iter():
                    if row.tag.rsplit("}", 1)[-1] == "tr":
                        cells = []
                        for cell in row.iterchildren():
                            if cell.tag.rsplit("}", 1)[-1] == "tc":
                                cells.append(" ".join("".join(t.text or "" for t in p.iter() if t.tag.rsplit("}", 1)[-1] == "t")
                                                      for p in cell.iter() if p.tag.rsplit("}", 1)[-1] == "p"))
                        parts.append(" | ".join(c.strip() for c in cells))
        return Extracted(tidy("\n".join(parts)), "python-docx paragraphs and table cells, whitespace collapsed")
    except (zipfile.BadZipFile, KeyError, ValueError, Exception) as e:  # noqa: BLE001
        return Extracted("", "python-docx", None, f"docx unreadable: {type(e).__name__}")


def office_text(path: str, kind: str) -> Extracted:
    """LibreOffice headless text export for legacy Word, RTF, WordPerfect and ODT files."""
    soffice = shutil.which("soffice") or shutil.which("libreoffice")
    if not soffice:
        return Extracted("", "LibreOffice", None, "no converter available")
    with tempfile.TemporaryDirectory(prefix="lo_", dir=os.environ.get("JP_TMP")) as tmp:
        profile = os.path.join(tmp, "profile")
        src = os.path.join(tmp, "in." + kind)
        shutil.copyfile(path, src)
        try:
            proc = subprocess.run([soffice, f"-env:UserInstallation=file://{profile}", "--headless", "--convert-to", "txt:Text", "--outdir", tmp, src],
                                  capture_output=True, timeout=180, cwd=tmp)
        except subprocess.TimeoutExpired:
            return Extracted("", "LibreOffice headless text export", None, "converter timed out")
        out = os.path.join(tmp, "in.txt")
        if proc.returncode != 0 or not os.path.exists(out):
            return Extracted("", "LibreOffice headless text export", None, "converter failed")
        raw = open(out, "rb").read().decode("utf-8", "replace")
    return Extracted(tidy(raw), "LibreOffice headless text export, whitespace collapsed")


def html_text(body: bytes) -> Extracted:
    from bs4 import BeautifulSoup

    import parse_lib as pl

    soup = pl.soup_of(body)
    root = pl.main_root(soup)
    for t in root.find_all(["nav", "footer", "aside", "form"]):
        t.decompose()
    for t in list(root.find_all(True)):
        if t.decomposed if hasattr(t, "decomposed") else False:
            continue
        try:
            if any(pl.CHROME_TOKEN.search(x) for x in pl._class_tokens(t)):
                t.decompose()
        except Exception:  # noqa: BLE001
            pass
    for br in root.find_all("br"):
        br.replace_with("\n")
    text = root.get_text("\n")
    return Extracted(tidy(text), "visible text of the main content (bs4), whitespace collapsed")


def extract(path: str, kind: str) -> Extracted:
    if kind == "pdf":
        return pdf_text(path)
    if kind == "docx":
        return docx_text(path)
    if kind in ("doc", "rtf", "wpd", "odt"):
        return office_text(path, kind)
    if kind == "html":
        return html_text(open(path, "rb").read())
    if kind == "txt":
        return Extracted(tidy(open(path, "rb").read().decode("utf-8", "replace")), "plain text file, whitespace collapsed")
    return Extracted("", "none", None, f"no text extraction for {kind} files")


# --------------------------------------------------------------------------------------------------------------------------
# legacy redaction: reproduces the text stored before 2026-10-27 (release check only; never applied by a build)

LEGACY_MARKERS = ("[email omitted]", "[phone omitted]", "[line naming courtroom staff omitted]", "[staff contact block omitted]")

EMAIL = re.compile(r"[A-Za-z0-9._%+\-]+@[A-Za-z0-9\-]+(?:\.[A-Za-z0-9\-]+)+")
PHONE = re.compile(r"(?<![\d\-])(?:\+?1[\s.\-]?)?\(?\b\d{3}\)?[\s.\-]\s?\d{3}[\s.\-]\d{4}\b(?:\s*(?:x|ext\.?|extension)\s*\d{1,6})?")
STAFF = re.compile(r"\b(courtroom deputy|deputy clerk|courtroom clerk|calendar clerk|case manager|judicial assistant|courtroom administrator|law clerk)\b", re.I)
NAME_AFTER = re.compile(r"(?:\b[A-Z][a-z]+(?:[\-'][A-Z][a-z]+)?\b\s+(?:[A-Z]\.?\s+)?\b[A-Z][a-zA-Z'\-]{2,}\b)")
STAFF_WORDS = {"Courtroom", "Deputy", "Clerk", "Calendar", "Case", "Manager", "Judicial", "Assistant", "Administrator", "Law", "United", "States",
               "District", "Court", "Southern", "Northern", "Eastern", "Western", "Middle", "Central", "Federal", "Rule", "Local", "Civil", "Criminal",
               "Chambers", "Judge", "Magistrate", "Bankruptcy", "Please", "Contact", "Email", "Phone", "Telephone", "Room", "Floor", "Suite", "Street",
               "Avenue", "Building", "Courthouse", "Honorable", "Hon", "Mr", "Ms", "Mrs", "Dr"}


STAFF_LABEL = re.compile(r"^(?:staff information|courtroom deputy|courtroom clerk|deputy clerk|judicial assistant|court reporter|law clerks?|case manager|"
                         r"calendar clerk|secretary|chambers staff|courtroom technology)\b|^chambers:\s*$", re.I)


def drop_staff_blocks(text: str, header_lines: int = 90) -> tuple[str, int]:
    """Judge pages print their staff as a label on one line and the person's name, telephone number and e-mail on the lines after it
    ("Courtroom Deputy:" / "Jane Roe, Phone: ..."). In the header of the page a label line and the short lines that follow it (at most four,
    chained when another label follows) are replaced by one marker; prose lines are never dropped."""
    lines = text.split("\n")
    out: list[str] = []
    blocks = 0
    i = 0
    while i < len(lines):
        ln = lines[i]
        if i < header_lines and STAFF_LABEL.match(ln) and len(ln) <= 70:
            j, budget, steps = i + 1, 4, 0
            while j < len(lines) and budget > 0 and steps < 24 and 0 < len(lines[j]) <= 80 and not lines[j].endswith((".", "?", "!")):
                budget = 4 if STAFF_LABEL.match(lines[j]) else budget - 1
                j += 1
                steps += 1
            out.append("[staff contact block omitted]")
            blocks += 1
            i = j
            continue
        out.append(ln)
        i += 1
    return "\n".join(out), blocks


PRACTICE_PHRASES = [r"page limit", r"courtesy cop", r"chambers cop", r"proposed order", r"discovery dispute", r"motion practice", r"continuance",
                    r"pre-?trial", r"scheduling order", r"standing order", r"oral argument", r"in limine", r"jury instruction", r"settlement conference",
                    r"pre-?motion", r"meet and confer", r"status report", r"sealed? (?:filings?|documents?)", r"summary judgment",
                    r"(?:judge|chambers|courtroom|trial)[’']?s? (?:procedures|practices|rules|requirements|preferences)"]


def inline_practices(body: bytes) -> Extracted | None:
    """The text of a judge's page when the page itself carries the judge's practices (not only a biography or a list of links): at least 1,200
    characters of main content and at least four different practice phrases (page limits, courtesy copies, proposed orders, discovery
    disputes, ...). None otherwise."""
    ex = html_text(body)
    if len(ex.text) < 1200 or sum(1 for p in PRACTICE_PHRASES if re.search(p, ex.text, re.I)) < 4:
        return None
    return ex


def redact_page(text: str) -> tuple[str, dict]:
    """Legacy: redact() for the text of a web page: staff blocks of the header first, then the line rules."""
    text, blocks = drop_staff_blocks(text)
    out, counts = redact(text)
    counts["staff_blocks"] = blocks
    return out, counts


def redact(text: str) -> tuple[str, dict]:
    """Legacy: the line rules applied to document text before 2026-10-27."""
    counts = {"emails": 0, "phones": 0, "staff_lines": 0}
    out: list[str] = []
    for line in text.split("\n"):
        if STAFF.search(line):
            has_contact = bool(EMAIL.search(line) or PHONE.search(line))
            names = [m.group(0) for m in NAME_AFTER.finditer(line) if not set(m.group(0).replace(".", "").split()) & STAFF_WORDS]
            if has_contact or names:
                counts["staff_lines"] += 1
                out.append("[line naming courtroom staff omitted]")
                continue
        line, n = EMAIL.subn("[email omitted]", line)
        counts["emails"] += n
        line, n = PHONE.subn("[phone omitted]", line)
        counts["phones"] += n
        out.append(line)
    return "\n".join(out), counts


def has_legacy_marker(text: str) -> bool:
    return any(m in text for m in LEGACY_MARKERS)


def cap(text: str, limit: int = TEXT_CAP) -> tuple[str, bool, int]:
    total = len(text)
    if total <= limit:
        return text, False, total
    cut = text[:limit]
    nl = cut.rfind("\n")
    return (cut[:nl] if nl > limit * 0.9 else cut), True, total
