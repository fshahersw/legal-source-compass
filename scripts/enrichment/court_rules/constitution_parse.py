"""Article / section structure of state constitution texts (pure functions, no I/O).

split_constitution(text) walks the lines of a plain-text rendering: a line that starts with "ARTICLE <n>" (Roman or Arabic
numeral, or an ordinal word such as "ARTICLE FIRST") opens an article; a line that starts with "Section <n>", "SECTION <n>",
"Sec. <n>" or "§ <n>" opens a section. Section text runs to the next heading. When no sections are found, articles are
the units; when neither is found, the caller keeps the whole text as one unit. Headings in a table of contents are
skipped (dot leaders or a trailing page number).
"""
from __future__ import annotations

import re

ORDINALS = ("FIRST|SECOND|THIRD|FOURTH|FIFTH|SIXTH|SEVENTH|EIGHTH|NINTH|TENTH|ELEVENTH|TWELFTH|THIRTEENTH|FOURTEENTH|"
            "FIFTEENTH|SIXTEENTH|SEVENTEENTH|EIGHTEENTH|NINETEENTH|TWENTIETH|TWENTY-FIRST|TWENTY-SECOND|TWENTY-THIRD|"
            "TWENTY-FOURTH|TWENTY-FIFTH|TWENTY-SIXTH|TWENTY-SEVENTH|TWENTY-EIGHTH|TWENTY-NINTH|THIRTIETH")
ARTICLE = re.compile(rf"^(?:ARTICLE|Article|ART\.|Art\.)\s+([IVXLC]+|\d+[A-Z]?|{ORDINALS}|{ORDINALS.title()})\b\.?\s*[-–—:.]?\s*(.*)$")
SECTION = re.compile(r"^(?:SECTION|Section|SEC\.|Sec\.|§+)\s*(\d+[A-Za-z]?(?:[.\-]\d+[A-Za-z]?)*)\b\.?\s*[-–—:.]?\s*(.*)$")
TOC = re.compile(r"(?:\.\s?){4,}\s*\d*\s*$|\s\.{2,}\s*\d+\s*$")
# "Article I, Section 1 | Inalienable Rights" (codes.ohio.gov) names both levels on one line
COMBINED = re.compile(r"^(?:Article|ARTICLE)\s+([IVXLC]+|\d+[A-Z]?),\s*(?:Section|SECTION)\s+(\d+[A-Za-z]?(?:[.\-]\d+[A-Za-z]?)*)\s*[|.:\-–—]?\s*(.*)$")


def _title(rest: str, max_len: int = 160) -> str:
    rest = rest.strip()
    m = re.match(r"^\[([^\]]{2,150})\]\.?\s*", rest)  # "[Equality of men.]" style catchlines
    if m:
        return m.group(1).strip()
    head = re.split(r"(?<=[.;:])\s", rest, maxsplit=1)[0]
    return head[:max_len].strip(" .")


def split_constitution(text: str) -> list[dict]:
    lines = text.split("\n")
    units: list[dict] = []
    article = None
    article_title = None
    current = None
    pos = 0
    for line in lines:
        start = pos
        pos += len(line) + 1
        s = line.strip()
        if not s or s == "\f":
            if current is not None:
                current["lines"].append(line)
            continue
        cm = COMBINED.match(s)
        if cm and len(s) < 220 and not TOC.search(s):
            article = cm.group(1)
            if current is not None:
                units.append(current)
            current = {"article": article, "article_title": article_title if article == (current or {}).get("article") else None,
                       "section": cm.group(2), "section_title": _title(cm.group(3)) or None, "start": start, "lines": [line]}
            continue
        am = ARTICLE.match(s)
        if am and len(s) < 200 and not TOC.search(s):
            article = am.group(1)
            article_title = am.group(2).strip(" .") or None
            if current is not None:
                units.append(current)
            current = {"article": article, "article_title": article_title, "section": None, "section_title": None, "start": start, "lines": [line]}
            continue
        sm = SECTION.match(s)
        if sm and not TOC.search(s) and not re.match(r"^[,;)(]", sm.group(2) or ""):
            rest = sm.group(2)
            if rest and (rest[:1].islower() or rest[:1] in ",;)"):
                pass  # "Section 4 of this article ..." wrapped inside a sentence: not a heading
            else:
                if current is not None:
                    units.append(current)
                current = {"article": article, "article_title": article_title, "section": sm.group(1), "section_title": _title(rest) or None,
                           "start": start, "lines": [line]}
                continue
        if current is None:
            current = {"article": None, "article_title": None, "section": None, "section_title": None, "start": start, "lines": []}
        current["lines"].append(line)
    if current is not None:
        units.append(current)
    out = []
    carry = ""
    for u in units:
        body = "\n".join(u.pop("lines")).strip("\n\f ")
        if not body:
            continue
        if u.get("section") and len(body) < 25 and "\n" not in body:
            # a bare repeated heading ("SECTION 1." printed in a margin): keep its words with the next unit
            carry = (carry + "\n" + body).strip()
            continue
        u["text"] = (carry + "\n" + body).strip() if carry else body
        carry = ""
        out.append(u)
    if carry and out:
        out[-1]["text"] += "\n" + carry
    return out


def structure_level(units: list[dict]) -> str:
    secs = sum(1 for u in units if u.get("section"))
    arts = len({u.get("article") for u in units if u.get("article")})
    if secs >= 5:
        return "section"
    if arts >= 2:
        return "article"
    return "document"


def merge_to_articles(units: list[dict]) -> list[dict]:
    """Collapse units into one per article (used when sections were not found)."""
    out: list[dict] = []
    for u in units:
        if out and u.get("article") == out[-1].get("article"):
            out[-1]["text"] += "\n" + u["text"]
        else:
            out.append({**u, "section": None, "section_title": None})
    return out


ROMAN = {"I": 1, "V": 5, "X": 10, "L": 50, "C": 100}


def roman_to_int(s: str) -> int | None:
    s = s.upper()
    if not s or any(c not in ROMAN for c in s):
        return None
    total = 0
    for i, c in enumerate(s):
        v = ROMAN[c]
        total += -v if i + 1 < len(s) and ROMAN[s[i + 1]] > v else v
    return total
