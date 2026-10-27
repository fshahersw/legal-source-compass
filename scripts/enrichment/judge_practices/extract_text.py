"""Plain text of acquired practice documents, with the redactions this stream applies and the method stated for every document.

Methods (recorded on each document record as `text_method`):
  pdf   - poppler `pdftotext -layout -enc UTF-8` (a PDF with no text layer, i.e. a scanned image, yields no text; OCR is not available here and
          none is attempted: the record says so);
  docx  - python-docx paragraphs and table cells in document order;
  doc / rtf / wpd / odt - LibreOffice headless conversion to plain text (the only converter available for these formats here);
  html  - the visible text of the page's main content (scripts, styles and site navigation removed).
Whitespace is collapsed; no word is rewritten. The original bytes are stored unchanged in the bucket, so these renderings are search aids.

Redactions (the stored text only, never the original file): access credentials only (hearing passcodes, passwords and access codes, and
the pwd= parameter of meeting links). Since the owner decision of 2026-10-27 the e-mail addresses, telephone numbers and courtroom staff the
court itself prints are kept as published; the earlier rules are in legacy_redaction.py. Counts are recorded on the record as `redactions`.
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
# redaction

# Owner decision 2026-10-27 ("dont withhold any data. If its accurate and valuable, USE IT"): the chambers e-mail addresses, telephone numbers
# and courtroom staff that a court prints in its own practice documents and judge pages are kept exactly as the court publishes them (named
# people as the official publisher shows them: AGENTS.md 2026-10-22 (3)). The rules that replaced them with "[email omitted]",
# "[phone omitted]", "[line naming courtroom staff omitted]" and "[staff contact block omitted]" are kept verbatim in legacy_redaction.py,
# used only to verify the re-extraction that released them (release_contact_text.py).
#
# What is still removed: access credentials, which are keys to a hearing line or meeting rather than data about the court. The value printed
# after a passcode / password / access-code / participant-code label (when it contains a digit, so "enter the passcode when prompted" and
# "password-protected exhibits" are untouched) and the pwd= parameter of a meeting link. Meeting IDs, dial-in numbers and links stay.

ACCESS_LABEL = (r"(?:meeting\s+|conference\s+|hearing\s+)?(?:passcode|pass\s?code|password|access\s+code|participant\s+(?:code|passcode)|attendee\s+code|"
                r"security\s+code|(?-i:PIN))")
ACCESS_CODE = re.compile(
    rf"(?i)(\b{ACCESS_LABEL}\b(?:\s+(?:is|number|no\.?))?\s*[:#\-–]?\s*)"
    r"(\d[\d \-]{1,22}\d#*|(?=[A-Za-z0-9!@$%^&*]*\d)[A-Za-z0-9!@$%^&*]{4,24}(?![A-Za-z0-9]))")
MEETING_PWD = re.compile(r"(?i)([?&]pwd=)[A-Za-z0-9._\-]+")
ACCESS_MARK = "[access code omitted]"


def redact(text: str) -> tuple[str, dict]:
    """Remove access credentials only (see above); every other word is kept as the court printed it."""
    text, n1 = ACCESS_CODE.subn(lambda m: m.group(1) + ACCESS_MARK, text)
    text, n2 = MEETING_PWD.subn(lambda m: m.group(1) + "[omitted]", text)
    return text, {"access_codes": n1 + n2}


def redact_page(text: str) -> tuple[str, dict]:
    """The same rule for the text of a judge's web page (staff blocks in the page header are kept since 2026-10-27)."""
    return redact(text)


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


def cap(text: str, limit: int = TEXT_CAP) -> tuple[str, bool, int]:
    total = len(text)
    if total <= limit:
        return text, False, total
    cut = text[:limit]
    nl = cut.rfind("\n")
    return (cut[:nl] if nl > limit * 0.9 else cut), True, total
