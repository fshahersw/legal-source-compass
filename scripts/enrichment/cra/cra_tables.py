"""Layout-text table parser for the class action research reports.

A table is located by its caption (a regex on one line of a page of `pdftotext -layout` output). Its region runs from
the caption to the first end marker ("Note:", "Source:", a running footer, or the next caption). Inside the region a
data row is a line whose cells (split on runs of two or more spaces) are an optional text label followed only by value
cells: counts, dollar amounts, percentages, or a dash for a value the table does not report. Numeric-only lines take
their label from single-cell text lines directly above and below (multi-line labels such as "Average" / "1997-2024").

Nothing is read from charts: a table spec names the caption of a printed table, and every row must have exactly the
number of value cells the spec's columns declare; a table whose rows do not fit is reported as held, never guessed.
"""
from __future__ import annotations

import re
from dataclasses import dataclass, field

DASH = {"-", "–", "—", "−"}
VALUE = re.compile(r"^(?:\(?[-−]?\$?\d[\d,]*(?:\.\d+)?[BMK]?%?\)?(?:\(\d\))?|\$\d[\d,]*(?:\.\d+)? (?:million|billion)|[-–—−]|N/?A|n/?a)$")
YEAR = re.compile(r"^(19[89]\d|20[0-4]\d)$")
YEAR_LABEL = re.compile(r"^(19[89]\d|20[0-4]\d)(?:\s*(H[12]|Q[1-4]))?$")
END = re.compile(r"^\s*(Notes?\s*:|Source[s]?\s*:|Sources?\s+of\s+data|Note\s+\d)|(Year in Review|Midyear Assessment|Review and Analysis|Review & Analysis|Midyear Review)\s*(\||\s{2,})|\|\s*Securities Class Action|cornerstone\.com\s+\d+\s*$|©", re.I)
CAPTION = re.compile(r"^\s{0,16}(Figure|FIGURE|Appendix|APPENDIX|Table|TABLE|Exhibit)\s+\d+[A-Z]?\s*[:.]")
# A line that is only a piece of a period label: "(1997–2014)", "(1997–", "2016)", "1997–2024", "1997 H1–2022 H2".
PERIOD_FRAGMENT = re.compile(r"^\(?\d{4}(?:\s*H[12])?\s*[–-]\s*(?:\d{4}(?:\s*H[12])?)?\)?$|^\d{4}(?:\s*H[12])?\)$")
TOC_LINE = re.compile(r"\S\s{2,}\d{1,3}\s*$")


@dataclass
class Row:
    label: str
    cells: list[str]
    line: int
    raw: str = ""


@dataclass
class Region:
    page: int  # 1-based PDF page index
    caption: str
    header: str
    rows: list[Row]
    notes: str
    rejected: list[str] = field(default_factory=list)
    header_lines: list[str] = field(default_factory=list)


def split_cells(line: str) -> list[str]:
    s = line.strip()
    if not s:
        return []
    out: list[str] = []
    for c in re.split(r"\s{2,}", s):
        parts = c.split(" ")
        if len(parts) > 1 and all(VALUE.match(p) for p in parts):
            out.extend(parts)
        else:
            out.append(c)
    return out


def parse_line(line: str, year_rows: bool = False) -> tuple[str, list[str]] | None:
    """(label, value cells) for a data line, or None when the line is not a pure data row."""
    cells = split_cells(line)
    if not cells:
        return None
    if len(cells) == 1 and PERIOD_FRAGMENT.match(cells[0]):
        return None
    labels: list[str] = []
    i = 0
    while i < len(cells) and not VALUE.match(cells[i]):
        labels.append(cells[i])
        i += 1
    vals = cells[i:]
    if not vals or any(not VALUE.match(v) for v in vals):
        return None
    label = " ".join(labels).strip()
    if year_rows and not label and YEAR.match(vals[0]):
        label = vals.pop(0)
        if not vals:
            return None
    if all(YEAR.match(v) for v in vals):
        return None  # a header line of years ("Annual (1997-2016)  2016  2017"), not data
    return label, vals


def scale_suffix(cell: str) -> str:
    """'B', 'M' or 'K' when a dollar cell carries its own scale ("$44.8B"), else ''."""
    c = cell.strip()
    if c.endswith(" million"):
        return "M"
    if c.endswith(" billion"):
        return "B"
    m = re.search(r"\d([BMK])%?\)?(?:\(\d\))?$", c)
    return m.group(1) if m else ""


def value_of(cell: str) -> tuple[float | None, str]:
    """Number and printed form of a value cell; a dash or N/A is None (not reported), never zero."""
    c = cell.strip()
    if c in DASH or c.upper().replace("/", "") == "NA":
        return None, c
    c = re.sub(r"\(\d\)$", "", c)  # trailing footnote marker such as "$12.2(1)"
    neg = c.startswith("(") and c.endswith(")") or c.startswith("-") or c.startswith("−")
    num = re.sub(r"[^\d.]", "", c)
    if not num or num.count(".") > 1:
        return None, c
    v = float(num)
    return (-v if neg else v), c


def _label_only(line: str) -> str | None:
    cells = split_cells(line)
    if len(cells) != 1 or VALUE.match(cells[0]):
        return None
    t = cells[0]
    if PERIOD_FRAGMENT.match(t):
        return t
    if t.startswith("(") or re.search(r"dollars|note|source|percentage of|continued", t, re.I) or len(t) > 48:
        return None
    return t


def regions(pages: list[str], caption: re.Pattern, *, year_rows: bool = False, max_lines: int = 90) -> list[Region]:
    """Every table region whose caption matches, with its data rows."""
    out: list[Region] = []
    for pi, page in enumerate(pages, 1):
        lines = page.splitlines()
        j = 0
        while j < len(lines):
            line = lines[j]
            if not caption.search(line) or re.search(r"\.{4,}\s*\d+\s*$", line) or TOC_LINE.search(line):
                j += 1
                continue
            cap = " ".join(line.split())
            k = j + 1
            body: list[tuple[int, str]] = []
            while k < len(lines) and k < j + max_lines:
                if END.search(lines[k]) or (CAPTION.match(lines[k]) and not caption.search(lines[k])):
                    break
                body.append((k, lines[k]))
                k += 1
            notes_lines = []
            m = k
            while m < len(lines) and m < k + 12 and not CAPTION.match(lines[m]):
                notes_lines.append(lines[m].strip())
                m += 1
            parsed = [(n, ln, parse_line(ln, year_rows)) for n, ln in body]
            first = next((i for i, (_, _, p) in enumerate(parsed) if p), None)
            header = " ".join(" ".join(ln.split()) for _, ln, _ in parsed[: first if first is not None else len(parsed)])
            rows: list[Row] = []
            rejected: list[str] = []
            claimed: set[int] = set()
            if first is not None:
                for i in range(first, len(parsed)):
                    n, ln, p = parsed[i]
                    if p is None:
                        if ln.strip() and _label_only(ln) is None and re.search(r"\d", ln):
                            rejected.append(" ".join(ln.split()))
                        continue
                    label, vals = p
                    squeezed = re.sub(r"\s+", "", label).lower()
                    incomplete = year_rows and label and not YEAR_LABEL.match(label) and ("average" in squeezed or squeezed.endswith(("–", "-", "(")))
                    if not label or incomplete:
                        above = below = None
                        for nb in (i - 1, i + 1):
                            if 0 <= nb < len(parsed) and parsed[nb][2] is None and nb not in claimed:
                                t = _label_only(parsed[nb][1])
                                if t:
                                    claimed.add(nb)
                                    if nb < i:
                                        above = t
                                    else:
                                        below = t
                        label = " ".join(x for x in (above, label, below) if x)
                    rows.append(Row(label=" ".join(label.split()), cells=vals, line=n, raw=ln))
            hl = [ln for _, ln, _ in parsed[: first if first is not None else len(parsed)]]
            out.append(Region(page=pi, caption=cap, header=header, rows=rows, notes=" ".join(notes_lines), rejected=rejected,
                              header_lines=hl))
            j = k
    return out


FOOTER_PATTERNS = [
    re.compile(r"^\s*(\d{1,3})\s+(?:www\.)?(?:nera\.com|ECONOMICS\.)", re.I),
    re.compile(r"(?:cornerstone\.com|nera\.com)\s+(\d{1,3})\s*$", re.I),
    re.compile(r"(?:Year in Review|Mid-?[Yy]ear (?:Assessment|Review|Update)|Review and Analysis|Review & Analysis|Settlement Outcomes|"
               r"Trends in Petitions and Opinions|Court of Chancery[^|]*|Update)\s*(?:\|[^|]{0,80})?\s{2,}(\d{1,3})\s*$"),
    re.compile(r"^\s*(?:Securities Class Action|Accounting Class Action|Shareholder Litigation|Cornerstone Research|Opt-Outs?|Tech Company|"
               r"M&A Litigation|Appraisal Litigation|Recent Trends|Parallel Derivative)[^\d|]*(?:\d{4}[^\d|]*)?\s{2,}(\d{1,3})\s*$"),
    re.compile(r"^\s*(\d{1,3})\s{2,}(?:Securities Class Action|Accounting Class Action|Cornerstone Research|Recent Trends|CORNERSTONE)"),
]
RUNNING = re.compile(r"Cornerstone Research\s*\||\|\s*(Securities|Accounting) Class Action", re.I)


def printed_page(page_text: str) -> str | None:
    """The page number in the report's running header or footer, if the page prints one in a recognised form."""
    lines = [ln for ln in page_text.splitlines() if ln.strip()]
    for ln in lines[:3] + lines[-4:]:
        for rx in FOOTER_PATTERNS:
            m = rx.search(ln)
            if m:
                return m.group(1)
    if len(lines) >= 2 and RUNNING.search(lines[-1]) and re.fullmatch(r"\s*\d{1,3}\s*", lines[-2]):
        return lines[-2].strip()
    last = lines[-1].strip() if lines else ""
    return last if re.fullmatch(r"\d{1,3}", last) else None


def printed_pages(pages: list[str]) -> list[str | None]:
    """Printed page numbers for every page: detected ones, plus pages lying between two detected pages that share the
    same offset from the PDF page index (no unnumbered insert can sit between them). Nothing is extended beyond them."""
    found = [None if re.search(r"Table of Contents|TABLE OF CONTENTS", p) else printed_page(p) for p in pages]
    offsets = [i - int(x) for i, x in enumerate(found) if x and x.isdigit()]
    # a detection is kept only when another page shares its offset (a lone match is likely a table value)
    found = [x if x and x.isdigit() and offsets.count(i - int(x)) >= 2 else None for i, x in enumerate(found)]
    out = list(found)
    known = [(i, int(x)) for i, x in enumerate(found) if x]
    for (i, a), (j, b) in zip(known, known[1:]):
        if b - a == j - i and j - i > 1:
            for k in range(i + 1, j):
                out[k] = str(a + (k - i))
    return out


def basis_of(text: str, unit: str) -> str:
    """Dollar basis as printed: 'adjusted to 2025 dollars' when the table or its note says so, else 'not stated'."""
    if not unit.startswith("usd"):
        return ""
    t = " ".join(text.split())
    for rx in (r"[Dd]ollars in (\d{4}) (?:billions|millions|thousands)", r"inflation[-\s]+adjusted to (\d{4}) dollars",
               r"(\d{4}) dollar equivalent", r"adjusted for inflation[^.]{0,60}?(\d{4}) dollar", r"in (\d{4}) dollars",
               r"\((\d{4}) dollars\)", r"constant (\d{4}) dollars"):
        m = re.search(rx, t)
        if m:
            return f"inflation-adjusted, {m.group(1)} dollars"
    if re.search(r"\bnominal\b", t, re.I):
        return "nominal"
    return "not stated"


SEG = re.compile(r"\S+(?: \S+)*")


def _value_spans(raw: str, n: int) -> list[tuple[int, int]] | None:
    """Character spans of the last n value cells of a raw data line."""
    spans: list[tuple[int, int]] = []
    for m in SEG.finditer(raw):
        parts = m.group().split(" ")
        if len(parts) > 1 and all(VALUE.match(p) for p in parts):
            pos = m.start()
            for p in parts:
                spans.append((pos, pos + len(p)))
                pos += len(p) + 1
        else:
            spans.append((m.start(), m.end()))
    return spans[-n:] if len(spans) >= n else None


def column_headers(region: Region, ncols: int) -> list[str] | None:
    """Header text above each value column, assembled from the header lines by position (nearest column centre).

    Used where a header wraps a period over two lines ("1997 H1-" above "2015 H2"); spanning group titles are not
    resolved here (callers take groups from their left-to-right order)."""
    centres: list[list[float]] = [[] for _ in range(ncols)]
    for r in region.rows:
        if len(r.cells) != ncols or not r.raw:
            continue
        spans = _value_spans(r.raw, ncols)
        if not spans:
            continue
        for i, (a, b) in enumerate(spans):
            centres[i].append((a + b) / 2)
    if any(not c for c in centres):
        return None
    mid = [sorted(c)[len(c) // 2] for c in centres]
    left_edge = mid[0] - (mid[1] - mid[0] if ncols > 1 else 8)
    out = ["" for _ in range(ncols)]
    for ln in region.header_lines:
        if re.search(r"dollars in|^\s*\(", ln, re.I):
            continue
        for m in SEG.finditer(ln):
            centre = (m.start() + m.end()) / 2
            if m.end() < left_edge:
                continue
            i = min(range(ncols), key=lambda k: abs(mid[k] - centre))
            out[i] = (out[i] + " " + m.group()).strip()
    return out


def stacked_headers(region: Region, ncols: int) -> list[str] | None:
    """Column headers from header lines that print exactly one token per value column (tokens separated by two or more
    spaces, the row-label column excluded), joined top to bottom: "1997 H1-" over "2015 H2" gives "1997 H1- 2015 H2"."""
    starts = []
    for r in region.rows:
        if len(r.cells) == ncols and r.raw:
            sp = _value_spans(r.raw, ncols)
            if sp:
                starts.append(sp[0][0])
    if not starts:
        return None
    left = min(starts) - 3
    lines = []
    for ln in region.header_lines:
        if re.search(r"dollars in|^\s*\(", ln, re.I):
            continue
        toks = [m.group() for m in SEG.finditer(ln) if m.end() > left]
        if len(toks) == ncols:
            lines.append(toks)
    if not lines:
        return None
    return [" ".join(t[i] for t in lines) for i in range(ncols)]
