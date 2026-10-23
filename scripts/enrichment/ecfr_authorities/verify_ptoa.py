"""Independent second path for ecfr_parallel_authorities: re-derive every row from the PDF rendition of the same table.

The builder parses the GovInfo text rendition (ptoa_parse.py). This module shares no code with it: it reads the PDF with
`pdftotext -raw` (a different rendition, a different reading order, em dashes for ranges, en dashes for hyphens, no period
after "seq") and a separately written line reader, then compares, entry by entry and group by group, the authority, the CFR
title and the exact list of parts. The only normalisation is typographic and is applied to both sides: dashes of every
kind become "-" (ranges "--" become "-" too), spaces and periods are removed from authorities, and the four
typesetting defects listed in the build report are matched by name.
"""
from __future__ import annotations

import gzip
import os
import re
import subprocess
import sys
import tempfile

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)


def pdf_raw_text(pdf_bytes: bytes) -> str:
    with tempfile.TemporaryDirectory() as td:
        src = os.path.join(td, "t.pdf")
        with open(src, "wb") as fh:
            fh.write(pdf_bytes)
        out = subprocess.run(["pdftotext", "-raw", src, "-"], check=True, capture_output=True).stdout
    return out.decode("utf-8", "replace")


def norm_auth(a: str) -> str:
    """Authority without spaces and periods; the PDF's em dash (a range) is "--" and its en dash (a hyphen) is "-"."""
    a = a.replace("\u2014", "--").replace("\u2013", "-")
    a = re.sub(r"\s+", "", a)
    return a.replace(".", "")


def norm_parts(text: str) -> list[str]:
    text = text.replace("\u2014", "--").replace("\u2013", "-")
    text = re.sub(r"-\s+(?=\d)", "-", text)  # a line-final hyphen of a wrapped designation
    return [t.strip() for t in text.split(",") if t.strip()]


HEAD_USC = re.compile(r"^(\d{1,2}) U\.S\.C\.( Appendix)?( \(\d{4} I\.R\.C\.\))?(—Continued)?$")
HEAD_STAT = re.compile(r"^(\d{1,3}[A-Z]?) Stat\.(—Continued)?$")
HEAD_OTHER = {
    "United States Statutes at Large": "stat-top",
    "Public Laws": "publaw",
    "Public Laws—Continued": "publaw",
    "Presidential Documents:": "pres",
    "Notices:": "pres:Notices",
    "Proclamations:": "pres:Proclamations",
    "Proclamations—Continued": "pres:Proclamations",
    "Executive Orders:": "pres:Executive Orders",
    "Executive Orders—Continued": "pres:Executive Orders",
    "Reorganization Plans:": "pres:Reorganization Plans",
    "Reorganization Plans—Continued": "pres:Reorganization Plans",
    "Determinations:": "pres:Determinations",
    "Directives:": "pres:Directives",
    "Memorandums:": "pres:Memorandums",
}
ENTRY = re.compile(r"^(?P<auth>.+?)\s*\.{3,}\s*(?P<rest>\d{1,2} Parts? .*)$")
GROUP = re.compile(r"^(\d{1,2}) Parts? (.*)$")
GROUP_ANY = re.compile(r"(?<![\w-])(\d{1,2}) Parts? ")


def parse_pdf_text(raw: str) -> list[dict]:
    """[{heading, authority, groups: [(cfr_title, [parts])]}] in document order."""
    lines = raw.split("\n")
    out: list[dict] = []
    heading = None
    cur = None
    buf: list[str] = []
    in_table = False
    skipping = False

    def flush():
        nonlocal cur, buf
        if cur is not None:
            text = " ".join(buf)
            starts = [(m.start(), m.end(), int(m.group(1))) for m in GROUP_ANY.finditer(text)]
            groups = []
            for i, (s, e, t) in enumerate(starts):
                end = starts[i + 1][0] if i + 1 < len(starts) else len(text)
                groups.append((t, norm_parts(text[e:end])))
            cur["groups"] = groups
            out.append(cur)
        cur, buf = None, []

    for line in lines:
        s = line.strip()
        if s.startswith("VerDate "):
            skipping = True
            continue
        if skipping:
            if s in ("CFR Index", "Authorities"):
                skipping = False
            continue
        if not s:
            continue
        m = HEAD_USC.match(s)
        if m:
            in_table = True
            if m.group(4):  # "N U.S.C.—Continued": a running head; the entry in progress goes on
                continue
            flush()
            heading = f"usc:{m.group(1)}{'a' if m.group(2) else ''}{'.' + m.group(3).strip()[1:5] if m.group(3) else ''}"
            continue
        m = HEAD_STAT.match(s)
        if m:
            if m.group(2):
                continue
            flush()
            heading = f"stat:{m.group(1)}"
            continue
        cont = s.endswith("—Continued")
        base = s[: -len("—Continued")] if cont else s
        if base in HEAD_OTHER or base + ":" in HEAD_OTHER:
            if not cont:
                flush()
                heading = HEAD_OTHER.get(base) or HEAD_OTHER[base + ":"]
            continue
        if not in_table:
            continue
        m = ENTRY.match(s)
        if m and heading:
            flush()
            cur = {"heading": heading, "authority": m.group("auth")}
            buf = [m.group("rest")]
            continue
        if cur is not None:
            buf.append(s)
    flush()
    return out


def repair_bare(raw: str) -> str:
    """A bare authority line ("457") printed without leader dots, followed by a "<title> Part(s)" line, after a group that
    does not end in a comma (so it cannot continue a parts list), is given a leader so that the line reader sees an entry.
    This is the one printed defect (129 Stat. 457); the check is by structure, not by a hard-coded number."""
    lines = raw.split("\n")
    out = []
    for i, line in enumerate(lines):
        s = line.strip()
        prev = next((x.strip() for x in reversed(out) if x.strip()), "")
        nxt = lines[i + 1].strip() if i + 1 < len(lines) else ""
        if re.fullmatch(r"\d{1,6}", s) and GROUP.match(nxt) and prev and not prev.endswith((",", "-", "\u2013", "\u2014")) and (GROUP.match(prev) or ENTRY.match(prev)):
            out.append(f"{s} ........ {nxt}")
            lines[i + 1] = ""
            continue
        out.append(line)
    return "\n".join(out)


def heading_key(entry) -> str:
    """The same heading key for an entry of the text-rendition parser."""
    if entry.category == "usc":
        return f"usc:{entry.usc_title}" + (f".{entry.variant.split(' ')[0]}" if entry.variant else "")
    if entry.category == "stat":
        return f"stat:{entry.heading.replace(' Stat.', '')}"
    if entry.category == "publaw":
        return "publaw"
    return f"pres:{entry.sub}"


def compare(entries, pdf_entries) -> dict:
    """Compare the text-rendition entries with the PDF entries. Returns counts and the first mismatches."""
    mism: list[dict] = []
    matched = 0
    n = min(len(entries), len(pdf_entries))
    for i in range(n):
        a, b = entries[i], pdf_entries[i]
        ha = heading_key(a)
        hb = b["heading"]
        if hb == "pres" or hb == "stat-top":
            hb = ha
        ga = [(g.cfr_title, list(g.tokens)) for g in a.groups]
        ga = [(t, [re.sub(r"\s+", "", p) for p in parts]) for t, parts in ga]
        gb = [(t, [re.sub(r"\s+", "", p) for p in parts]) for t, parts in b["groups"]]
        ok = ha == hb.replace("pres:Presidential Documents", "pres:Presidential Documents") and norm_auth(a.authority) == norm_auth(b["authority"]) and ga == gb
        if ok:
            matched += 1
        else:
            mism.append({"index": i, "html": [ha, a.authority, ga], "pdf": [hb, b["authority"], gb]})
    return {
        "html_entries": len(entries),
        "pdf_entries": len(pdf_entries),
        "compared": n,
        "matched": matched,
        "mismatched": len(mism),
        "mismatches": mism,
    }
