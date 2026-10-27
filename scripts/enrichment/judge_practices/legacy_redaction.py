"""The contact redaction that extract_text.py applied to judge practice documents until 2026-10-27, kept verbatim for one purpose:
release_contact_text.py re-extracts each published document from its stored original, applies these rules, and releases the
document only when the result reproduces the published text byte for byte (same SHA-256). That proves the released text comes from
the same bytes and the same extractor, and that the only change is the contact text these rules removed.

Do not use this module to build data: owner decision 2026-10-27 ("dont withhold any data") released chambers e-mail addresses,
telephone numbers and courtroom staff named by the court itself (AGENTS.md 2026-10-22 (3)). extract_text.redact() is the current rule.
"""
from __future__ import annotations

import re

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


def redact_page(text: str) -> tuple[str, dict]:
    """redact() for the text of a web page: staff blocks of the header first, then the line rules."""
    text, blocks = drop_staff_blocks(text)
    out, counts = redact(text)
    counts["staff_blocks"] = blocks
    return out, counts


def redact(text: str) -> tuple[str, dict]:
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
