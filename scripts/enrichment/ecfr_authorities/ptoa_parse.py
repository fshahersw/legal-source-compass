"""Deterministic parser for the Parallel Table of Authorities and Rules (CFR Index and Finding Aids, GovInfo text rendition).

The table is typeset in fixed-width text inside one <pre> block:

  5 U.S.C.                                          <- section heading (a category and a U.S. Code title)
    301 et seq.....................20 Part 658      <- entry: authority, leader dots, "<CFR title> Part(s) <list>"
                                   29 Part 290      <- continuation: another "<CFR title> Part(s) <list>" group
        547, 548, 549, 550          <- continuation of the previous parts list (also across a [[Page N]] marker)

Rules (all deterministic; nothing is guessed):
  * An entry line has an authority, a leader (a run of at least two dots) and then "<title> Part" or "<title> Parts".
    Continuation lines never contain a leader. One typesetting defect is joined structurally and counted: a bare
    authority line with no leader immediately followed by a line that starts "<title> Part(s)" (129 Stat. 457).
  * Any other indented line is a continuation of the previous entry. It either starts a new group ("<title> Part(s)")
    or continues the previous group's list of parts. A hyphen at the end of a wrapped line joins without a space.
  * Authority text is kept as printed with runs of whitespace collapsed to one space. The leader's first dot may be the
    authority's own period ("et seq.", "App."); it is restored only for those two abbreviations.
  * A parts token must look like a CFR part designation (digits, optional letters, optional hyphenated suffix) or a range
    of such designations ("1301--1309"). Every other token is kept in `unparsed_tokens` and counted, never dropped.
  * U.S. Code authorities are classified: exact (one section), et_seq ("N et seq."), range ("A--B"), note ("N note"),
    appendix_whole ("App."), other. Only exact/note carry a section key; a range carries both end keys and an et seq. its
    start key, and none of them is expanded.
"""
from __future__ import annotations

import html
import re
from dataclasses import dataclass, field

PAGE_RE = re.compile(r"^\[\[Page (\d+)\]\]\s*$")
USC_HEAD_RE = re.compile(r"^(\d{1,2}) U\.S\.C\.( Appendix)?$")
USC_VARIANT_HEAD_RE = re.compile(r"^(\d{1,2}) U\.S\.C\. \((\d{4}) I\.R\.C\.\)$")
STAT_HEAD_RE = re.compile(r"^(\d{1,3}[A-Z]?) Stat\.$")
ENTRY_RE = re.compile(r"^ {2,80}(?P<auth>\S.*?)(?P<dots>\.{2,})(?P<rest>\d{1,2}\s+Parts?\b.*)$")
BARE_AUTH_RE = re.compile(r"^  (?P<auth>\d[\dA-Za-z.,\- ]{0,40})$")
GROUP_LINE_RE = re.compile(r"^  \d{1,2}\s+Parts?\b")
GROUP_START_RE = re.compile(r"(?<![\w-])(\d{1,2})\s+(Parts?)\s+")
_PART = r"\d+[A-Za-z]{0,2}(?:-\d+[A-Za-z]{0,2})?"
PART_TOKEN_RE = re.compile(rf"^{_PART}$")
PART_RANGE_RE = re.compile(rf"^{_PART}--{_PART}$")
USC_KEY = r"\d+[A-Za-z]{0,3}(?:-\d+[A-Za-z]{0,3}){0,2}"
EXACT_RE = re.compile(rf"^(?P<key>{USC_KEY})$")
ETSEQ_RE = re.compile(rf"^(?P<key>{USC_KEY})\s*et seq\.$")
RANGE_RE = re.compile(rf"^(?P<a>{USC_KEY})--(?P<b>{USC_KEY})$")
NOTE_RE = re.compile(rf"^(?P<key>{USC_KEY})\s*note$")
ABBREV_AFTER_AUTH = ("seq", "App")  # a period that belongs to the authority and is absorbed by the leader

# Category headings that are not "N U.S.C." / "N Stat."
CATEGORY_HEADS = {
    "United States Statutes at Large": ("stat", None),
    "Public Laws": ("publaw", None),
    "Presidential Documents:": ("presidential", "Presidential Documents"),
    "Notices:": ("presidential", "Notices"),
    "Proclamations:": ("presidential", "Proclamations"),
    "Executive Orders:": ("presidential", "Executive Orders"),
    "Reorganization Plans:": ("presidential", "Reorganization Plans"),
    "Determinations:": ("presidential", "Determinations"),
    "Directives:": ("presidential", "Directives"),
    "Memorandums:": ("presidential", "Memorandums"),
}


@dataclass
class Group:
    cfr_title: int
    label: str  # "Part" or "Parts", as printed
    parts: list[str] = field(default_factory=list)  # tokens that look like one part designation
    part_ranges: list[str] = field(default_factory=list)  # "1301--1309", never expanded
    unparsed_tokens: list[str] = field(default_factory=list)
    tokens: list[str] = field(default_factory=list)  # every comma-separated token, in printed order
    text: str = ""  # the group's parts text with wraps joined, as printed


@dataclass
class Entry:
    category: str  # usc | stat | publaw | presidential
    heading: str  # the heading in force ("5 U.S.C.", "5 U.S.C. Appendix", "106 Stat.", "Public Laws", "Proclamations:")
    usc_title: str | None  # "5", or "5a" for an appendix; None outside the U.S. Code
    variant: str | None  # "1939 I.R.C." / "1986 I.R.C." under the two Title 26 headings
    sub: str | None  # presidential sub-category
    authority: str  # as printed (leader removed, whitespace collapsed)
    page: int | None
    line_no: int  # 1-based line in the rendition's <pre> block
    seq: int  # order of entries in the document
    leader_missing: bool = False
    groups: list[Group] = field(default_factory=list)


@dataclass
class ParseResult:
    entries: list[Entry]
    anomalies: list[dict]
    revised_as_of: str | None
    pages: tuple[int | None, int | None]
    lines_total: int


def extract_pre(raw: str) -> list[str]:
    m = re.search(r"<pre>(.*?)</pre>", raw, flags=re.S)
    body = m.group(1) if m else raw
    body = re.sub(r"<a [^>]*>(.*?)</a>", r"\1", body)
    body = html.unescape(body)
    return body.split("\n")


def classify_usc(authority: str) -> dict:
    """Classify a U.S. Code authority string. Keys are the printed section designations, unchanged."""
    a = re.sub(r"\s+", " ", authority).strip()
    if a == "App.":
        return {"kind": "appendix_whole", "keys": [], "start": None, "end": None}
    m = EXACT_RE.match(a)
    if m:
        return {"kind": "exact", "keys": [m["key"]], "start": None, "end": None}
    m = NOTE_RE.match(a)
    if m:
        return {"kind": "note", "keys": [m["key"]], "start": None, "end": None}
    m = ETSEQ_RE.match(a)
    if m:
        return {"kind": "et_seq", "keys": [], "start": m["key"], "end": None}
    m = RANGE_RE.match(a)
    if m:
        return {"kind": "range", "keys": [], "start": m["a"], "end": m["b"]}
    return {"kind": "other", "keys": [], "start": None, "end": None}


def join_lines(parts: list[str]) -> str:
    """Join wrapped right-column lines with one space, except after a line-final hyphen ("101-" + "19" -> "101-19")."""
    out = ""
    for p in parts:
        p = p.strip()
        if not p:
            continue
        out = out + p if out.endswith("-") and p[:1].isdigit() else (out + " " + p if out else p)
    return out


def split_groups(text: str) -> list[Group]:
    """'31 Parts 510, 525 32 Part 719' -> two groups. The text is one entry's right-hand column with wraps joined."""
    flat = re.sub(r"\s+", " ", text).strip()
    starts = [(m.start(), m.end(), int(m.group(1)), m.group(2)) for m in GROUP_START_RE.finditer(flat)]
    groups: list[Group] = []
    for i, (s, e, title, label) in enumerate(starts):
        end = starts[i + 1][0] if i + 1 < len(starts) else len(flat)
        body = flat[e:end].strip().rstrip(",").strip()
        g = Group(cfr_title=title, label=label, text=body)
        for tok in [t.strip() for t in body.split(",")]:
            if not tok:
                continue
            g.tokens.append(tok)
            if PART_TOKEN_RE.match(tok):
                g.parts.append(tok)
            elif PART_RANGE_RE.match(tok):
                g.part_ranges.append(tok)
            else:
                g.unparsed_tokens.append(tok)
        groups.append(g)
    lead = flat[: starts[0][0]].strip() if starts else flat
    if lead:
        groups.insert(0, Group(cfr_title=0, label="", unparsed_tokens=[lead], text=lead))
    return groups


def revised_as_of(lines: list[str]) -> str | None:
    head = re.sub(r"\s+", " ", " ".join(lines[:120]))
    m = re.search(r"revised as of ([A-Z][a-z]+ \d{1,2}, \d{4})", head)
    return m.group(1) if m else None


def parse(raw: str) -> ParseResult:
    lines = extract_pre(raw)
    entries: list[Entry] = []
    anomalies: list[dict] = []
    category: str | None = None
    heading = ""
    usc_title: str | None = None
    variant: str | None = None
    sub: str | None = None
    page: int | None = None
    pages: list[int] = []
    started = False
    cur: Entry | None = None
    pending: list[str] = []  # right-hand column text of the current entry
    bare: tuple[int, str] | None = None  # (line, authority) of a line with no leader, waiting for its group line

    def flush() -> None:
        nonlocal cur, pending
        if cur is not None:
            cur.groups = split_groups(join_lines(pending))
            entries.append(cur)
        cur, pending = None, []

    def new_entry(i: int, auth: str, missing: bool) -> Entry:
        return Entry(
            category=category or "",
            heading=heading,
            usc_title=usc_title,
            variant=variant,
            sub=sub,
            authority=re.sub(r"\s+", " ", auth).strip(),
            page=page,
            line_no=i,
            seq=len(entries),
            leader_missing=missing,
        )

    for i, line in enumerate(lines, 1):
        stripped = line.strip()
        pm = PAGE_RE.match(stripped)
        if not started:
            if pm:
                started = True
                page = int(pm.group(1))
                pages.append(page)
            continue
        if pm:
            page = int(pm.group(1))
            pages.append(page)
            continue
        if not stripped:
            continue
        indent = len(line) - len(line.lstrip(" "))
        if bare is not None:
            b_line, b_auth = bare
            bare = None
            if GROUP_LINE_RE.match(line):
                flush()
                cur = new_entry(b_line, b_auth, True)
                pending = [stripped]
                anomalies.append(
                    {
                        "line": b_line,
                        "kind": "entry without leader joined to the next line",
                        "text": f"{b_auth} | {stripped}"[:160],
                    }
                )
                continue
            anomalies.append({"line": b_line, "kind": "entry line not understood", "text": b_auth})
        if indent == 0:
            flush()
            if stripped in CATEGORY_HEADS:
                category, sub = CATEGORY_HEADS[stripped]
                heading, usc_title, variant = stripped, None, None
                continue
            m = USC_HEAD_RE.match(stripped)
            if m:
                category, sub, variant = "usc", None, None
                heading = stripped
                usc_title = m.group(1) + ("a" if m.group(2) else "")
                continue
            m = USC_VARIANT_HEAD_RE.match(stripped)
            if m:
                category, sub = "usc", None
                heading, usc_title, variant = stripped, m.group(1), f"{m.group(2)} I.R.C."
                continue
            m = STAT_HEAD_RE.match(stripped)
            if m:
                category, sub, variant = "stat", None, None
                heading, usc_title = stripped, None
                continue
            anomalies.append({"line": i, "kind": "unrecognised heading", "text": stripped[:120]})
            continue
        if re.search(r"\.{3,}", line):
            flush()
            m = ENTRY_RE.match(line)
            if not m or category is None:
                anomalies.append({"line": i, "kind": "entry line not understood", "text": stripped[:160]})
                continue
            auth = m.group("auth").rstrip()
            if auth.endswith(ABBREV_AFTER_AUTH):
                auth += "."
            if indent != 2:
                anomalies.append(
                    {"line": i, "kind": f"entry indented {indent} spaces (parsed as an entry)", "text": stripped[:160]}
                )
            cur = new_entry(i, auth, False)
            pending = [m.group("rest")]
            continue
        if indent == 2:
            bm = BARE_AUTH_RE.match(line)
            if bm and not GROUP_LINE_RE.match(line):
                flush()
                bare = (i, bm.group("auth"))
                continue
            anomalies.append({"line": i, "kind": "entry line not understood", "text": stripped[:160]})
            continue
        # continuation line
        if cur is None:
            anomalies.append({"line": i, "kind": "continuation without an entry", "text": stripped[:160]})
            continue
        pending.append(stripped)
    if bare is not None:
        anomalies.append({"line": bare[0], "kind": "entry line not understood", "text": bare[1]})
    flush()
    return ParseResult(
        entries=entries,
        anomalies=anomalies,
        revised_as_of=revised_as_of(lines),
        pages=(pages[0] if pages else None, pages[-1] if pages else None),
        lines_total=len(lines),
    )
