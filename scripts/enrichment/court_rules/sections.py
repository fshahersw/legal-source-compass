"""Split a rule document's text rendering into rule-level sections (pure functions, no I/O).

A heading is a line that starts with a rule label (e.g. "Rule 7.1.", "LR 7.1", "Civil L.R. 7-4", "RULE 1.110.", "7-3. Opposition")
followed by a title on the same line or on the next short line. Table-of-contents lines (dot leaders or a trailing page
number) are never headings; a label followed by a comma, a parenthesis or a lower-case word is a cross-reference, not a
heading. Several label families are tried and the one that yields the most distinct rules wins. When no family yields at
least MIN_SECTIONS sections, the document falls back to page-level sections ("Page 12"), which keeps every word searchable.
"""
from __future__ import annotations

import re
from collections import Counter
from dataclasses import dataclass, field

from textlib import PAGE_BREAK, page_of

NUM = r"(\d{1,4}[A-Za-z]?(?:[.\-:]\d{1,4}[A-Za-z]?){0,3})"
FAMILIES: dict[str, str] = {
    "local_rule": r"(?:LOCAL\s+(?:CIVIL\s+|CRIMINAL\s+|PATENT\s+|ADMIRALTY\s+|APPELLATE\s+|BANKRUPTCY\s+)?RULES?|"
                  r"Local\s+(?:Civil\s+|Criminal\s+|Patent\s+|Admiralty\s+|Appellate\s+)?Rules?)",
    "rule": r"(?:RULE|Rule|FRAP)",
    "abbrev": r"(?:LR|L\.\s?R\.|LCvR|LCrR|LCiv\.?\s?R\.?|LCrim\.?\s?R\.?|L\.\s?Civ\.\s?R\.|L\.\s?Cr\.\s?R\.|L\.\s?Cv\.\s?R\.|LCR|LRCiv|LRCrim|"
              r"LPR|L\.?\s?Pat\.?\s?R\.|P\.\s?R\.|Patent\s+L\.\s?R\.|ADR\s+L\.\s?R\.|NECivR|NECrimR|Civil\s+L\.\s?R\.|Crim\.\s+L\.\s?R\.|"
              r"Civ\.\s?L\.\s?R\.|Cr\.\s?L\.\s?R\.|CvR|CrR|Cir(?:cuit)?\.?\s+R(?:ule)?\.?|CIRCUIT\s+RULE|LAR|L\.\s?A\.\s?R\.|Misc\.\s+LAR|"
              r"Fed\.\s+Cir\.\s+R\.|I\.?O\.?P\.?|D\.C\.\s+Cir\.\s+R\.|L\.\s?Crim\.\s?R\.|LCrimR|LCivR|L\.\s?Civ\.\s?R|"
              r"Federal\s+Circuit\s+Rule|Civ\.\s+RULE|Crim\.\s+RULE|Cr\.\s+RULE|\d{1,2}(?:st|nd|rd|th)?\s+Cir\.\s+R\.)",
    "bare": r"",
}
MIN_SECTIONS = 5
# applied to the text after the rule number: dot leaders, or a title followed by a page number
TOC_TAIL = re.compile(r"(?:\.\s?){4,}\s*[\divxlc]*\s*$|\s\.{2,}\s*\d+\s*$|[A-Za-z][^.]*\s\d{1,3}$", re.I)
TITLE_OK = re.compile(r"^[A-Z\"'“(\[§]")


@dataclass
class Section:
    label: str
    number: str
    title: str
    start: int
    end: int
    page: int
    text: str = ""
    family: str = ""
    extra: dict = field(default_factory=dict)


def _heading_regex(family: str) -> re.Pattern:
    prefix = FAMILIES[family]
    if family == "bare":
        # bare numbers need a separator inside ("7-1.", "1.110", "26.1") so paragraph numbers ("1.") are not headings
        num = r"(\d{1,3}[A-Za-z]?(?:[.\-]\d{1,3}[A-Za-z]?){1,3})"
        return re.compile(rf"^{num}[.:]?(?=\s|$)(.*)$")
    # abbreviations may carry the court's own prefix, e.g. "D.C.COLO.LCivR 7.1" or "N.D. Ind. L.R. 7-1"
    court = r"(?:(?:[A-Z][A-Za-z]{0,5}\.\s?){1,4})?" if family == "abbrev" else ""
    return re.compile(rf"^{court}({prefix})\s*{NUM}\b[.:]?(.*)$")


def _clean_title(rest: str) -> str:
    rest = rest.strip()
    rest = re.sub(r"^[.:\-–—]+\s*", "", rest)
    return rest.strip()


LEADER_LINE = re.compile(r"(?:\.\s?){4,}\s*[\divxlc]*\s*$|\s\d{1,3}$", re.I)


def toc_pages(text: str) -> set[int]:
    """Pages that are tables of contents: at least eight lines and 40% of them end in dot leaders or a page number."""
    out = set()
    for n, page in enumerate(text.split(PAGE_BREAK), start=1):
        lines = [ln for ln in page.split("\n") if ln.strip()]
        if len(lines) >= 8 and sum(1 for ln in lines if LEADER_LINE.search(ln)) >= 0.4 * len(lines):
            out.add(n)
    return out


RUNNING_HEADER_PAGES = 3  # a line opening this many pages is a running header (two real rules may each open a page)


def _norm_top(line: str) -> str:
    return re.sub(r"\s+", " ", line.replace(PAGE_BREAK, "")).strip()


def page_tops(text: str) -> Counter:
    """How many pages each line opens (first line with content on the page, whitespace collapsed)."""
    tops: Counter = Counter()
    for page in text.split(PAGE_BREAK):
        first = next((ln for ln in page.split("\n") if ln.strip()), "")
        if first:
            tops[_norm_top(first)] += 1
    return tops


def _candidates(text: str, family: str) -> list[Section]:
    rx = _heading_regex(family)
    skip_pages = toc_pages(text)
    tops = page_tops(text)
    lines = text.split("\n")
    out: list[Section] = []
    offset = 0
    offsets = []
    for line in lines:
        offsets.append(offset)
        offset += len(line) + 1
    for i, line in enumerate(lines):
        if len(line) > 170 or not line or line == PAGE_BREAK:
            continue
        m = rx.match(line)
        if not m:
            continue
        if family == "bare":
            number, rest, label_prefix = m.group(1), m.group(2), ""
        else:
            label_prefix, number, rest = m.group(1), m.group(2), m.group(3)
        if TOC_TAIL.search(rest) or page_of(text, offsets[i]) in skip_pages:
            continue
        raw_rest = rest
        title = _clean_title(rest)
        if raw_rest[:1] in (",", "(", ";") or (title and not TITLE_OK.match(title)):
            continue  # cross-reference such as "Rule 7.1, a party" or "Rule 56(a)"
        if title and _sentence(title) and re.search(r"\b(shall|must|may|should|will|is|are|be|has|have|was|were)\b", title):
            continue  # a wrapped sentence that happens to start with a rule citation ("Rule 81. They should be construed")
        prev = lines[i - 1].rstrip() if i else ""
        if family != "bare" and title and _sentence(title) and prev and prev != PAGE_BREAK and re.search(r"[A-Za-z,]$", prev):
            continue  # the previous line runs on into this one ("... apply Circuit" / "Rule 30-1. Each reference in ...")
        no_title = False
        title_from_next = False
        if not title:
            nxt = next((lines[j] for j in range(i + 1, min(i + 4, len(lines))) if lines[j] and lines[j] != PAGE_BREAK), "")
            if nxt and len(nxt) <= 110 and TITLE_OK.match(nxt) and not nxt.startswith("(") and not TOC_TAIL.search(nxt) \
                    and not nxt.rstrip().endswith((",", ";")) and not _heading_regex(family).match(nxt) and not _sentence(nxt):
                title = nxt.strip()
                title_from_next = True
            elif family in ("local_rule", "abbrev") and line.strip() == m.group(0).strip():
                # a strong label alone on its line ("Federal Circuit Rule 28", "LR 7.1") is a heading even without a title
                no_title = True
            else:
                continue
        if family == "bare" and (len(title) > 120 or title.endswith(",")):
            continue
        label = re.sub(r"\s+", " ", (f"{label_prefix.strip()} {number}" if label_prefix else number).strip())
        sec = Section(label=label, number=number.rstrip("."), title=(title or label)[:200], start=offsets[i],
                      end=0, page=page_of(text, offsets[i]), family=family)
        if no_title:
            sec.extra["no_title"] = True
        if title_from_next:
            sec.extra["title_from_next"] = True
            # the nearest earlier line with content; a form feed counts ("\f".strip() is empty)
            back = next((lines[j] for j in range(i - 1, -1, -1) if lines[j].strip() or PAGE_BREAK in lines[j]), PAGE_BREAK)
            if (PAGE_BREAK in back or line.startswith(PAGE_BREAK)) and tops[_norm_top(line)] >= RUNNING_HEADER_PAGES:
                sec.extra["running_header"] = True  # the same line opens several pages: a running header
        out.append(sec)
    return out


def _sentence(line: str) -> bool:
    """A body sentence rather than a heading: eight or more words, most of them lower-case."""
    words = [w for w in re.split(r"\s+", line.strip()) if w]
    return len(words) >= 8 and sum(1 for w in words if w[:1].isupper()) / len(words) < 0.5


def _key(s: Section) -> str:
    """Identity of a heading for de-duplication: its label with case and spacing folded ("LOCAL RULE 7.1" == "Local Rule 7.1")."""
    return re.sub(r"[\s.]+", "", s.label).lower()


def _resolve(cands: list[Section], text_len: int) -> list[Section]:
    cands = sorted(cands, key=lambda s: s.start)
    for i, s in enumerate(cands):
        s.end = cands[i + 1].start if i + 1 < len(cands) else text_len
    best_len: dict[str, int] = {}
    for s in cands:
        best_len[_key(s)] = max(best_len.get(_key(s), 0), s.end - s.start)
    def tocish(s: Section) -> bool:  # a short repeat of a label whose real section is far longer (contents lines)
        n = s.end - s.start
        return n < 120 and best_len[_key(s)] > n

    kept = [s for s in cands if not tocish(s)]
    # a title-less repeat of a label already seen (a running page header such as "LR 7.1") is not a new section, nor is a
    # repeat that is a running header, whatever line follows it ("FRAP 3" atop seven pages of FRAP 3)
    seen_keys: set[str] = set()
    deduped = []
    for s in sorted(kept, key=lambda s: s.start):
        key = _key(s)
        if key in seen_keys and (s.extra.get("no_title") or s.extra.get("running_header")):
            continue
        seen_keys.add(key)
        deduped.append(s)
    kept = deduped
    kept = sorted(kept, key=lambda s: s.start)
    for i, s in enumerate(kept):
        s.end = kept[i + 1].start if i + 1 < len(kept) else text_len
    return kept


NEST_RATIO = 0.8  # share of bare headings inside named sections that must number as their sub-rules
NEST_MIN = 3


def _nests(parent: str, child: str) -> bool:
    """child numbers a sub-rule of parent: "11-6.2" under "11-6", "3.1" under "3" (not "31" under "3")."""
    p = parent.rstrip(".")
    return bool(p) and child != p and child.startswith(p) and child[len(p):len(p) + 1] in ".-:("


def _with_nested(named: list[Section], bare: list[Section], text_len: int) -> list[Section] | None:
    """Named rule headings plus the bare-number headings that number their sub-rules, labelled with the parent's prefix
    ("CIRCUIT RULE 11-6" > "CIRCUIT RULE 11-6.2"). None unless at least NEST_RATIO of the bare headings that fall inside
    named sections (and at least NEST_MIN) are such sub-rules: then the two label sets describe one hierarchy rather than
    two unrelated numberings (definitions, form paragraphs)."""
    inside, children = 0, []
    for b in bare:
        parent = next((s for s in named if s.start <= b.start < s.end), None)
        if parent is None or b.start == parent.start:
            continue
        inside += 1
        if _nests(parent.number, b.number):
            prefix = parent.label[: len(parent.label) - len(parent.number)].strip() if parent.label.endswith(parent.number) else ""
            label = f"{prefix} {b.number}".strip()
            children.append(Section(label=label, number=b.number, title=b.title, start=b.start, end=0, page=b.page,
                                    family=f"{parent.family}+nested", extra=dict(b.extra)))
    if inside < NEST_MIN or len(children) < NEST_RATIO * inside:
        return None
    named_starts = {s.start for s in named}
    fresh = [Section(label=s.label, number=s.number, title=s.title, start=s.start, end=0, page=s.page, family=s.family,
                     extra=dict(s.extra)) for s in named]
    return _resolve(fresh + [c for c in children if c.start not in named_starts], text_len)


def split_sections(text: str, families: tuple[str, ...] = ("local_rule", "rule", "abbrev", "bare")) -> tuple[list[Section], str]:
    """Return (sections, method). method is the winning label family, or 'pages' for the page-level fallback.

    When named headings and bare-number headings form one hierarchy (see _with_nested), both are kept and method ends in
    "+nested"; otherwise the family yielding clearly more distinct rules wins."""
    best: list[Section] = []
    best_family = ""
    named = [f for f in families if f != "bare"]
    options: list[tuple[str, list[Section]]] = []
    named_secs: list[Section] = []
    if named:
        merged: list[Section] = []
        seen_starts: set[int] = set()
        for family in named:  # one heading line can match several families; keep the first family's reading
            for s in _candidates(text, family):
                if s.start not in seen_starts:
                    seen_starts.add(s.start)
                    merged.append(s)
        named_secs = _resolve(merged, len(text))
        options.append(("+".join(sorted({s.family for s in merged})) or "named", named_secs))
    if "bare" in families:
        bare_secs = _resolve(_candidates(text, "bare"), len(text))
        nested = None
        if len({_key(s) for s in named_secs}) >= MIN_SECTIONS:
            nested = _with_nested(named_secs, bare_secs, len(text))
        if nested is not None:
            options = [(options[0][0] + "+nested", nested)]
        else:
            options.append(("bare", bare_secs))
    for family, secs in options:
        distinct = len({_key(s) for s in secs})
        if distinct > len({_key(s) for s in best}) * 1.15 or (distinct and not best):
            best, best_family = secs, family
    if len({_key(s) for s in best}) >= MIN_SECTIONS:
        seen: dict[str, int] = {}
        for s in best:
            s.text = text[s.start:s.end].strip("\n" + PAGE_BREAK)
            seen[s.label] = seen.get(s.label, 0) + 1
            if seen[s.label] > 1:
                s.extra["occurrence"] = seen[s.label]
        front = text[: best[0].start].strip()
        if len(front) > 400:
            best.insert(0, Section(label="Front matter", number="0", title="Front matter and contents", start=0,
                                   end=best[0].start, page=1, text=front, family="front"))
        return split_oversized(best, text), best_family
    return page_sections(text), "pages"


MAX_SECTION = 40_000


def split_oversized(secs: list[Section], text: str, limit: int = MAX_SECTION) -> list[Section]:
    """Break a section longer than limit at page breaks into consecutive parts ("RULE 8.870 (part 2 of 5)").
    No text is dropped: the parts concatenate back to the original section."""
    out: list[Section] = []
    for s in secs:
        if len(s.text) <= limit or PAGE_BREAK not in s.text:
            out.append(s)
            continue
        pages = s.text.split(PAGE_BREAK)
        chunks: list[str] = []
        cur = ""
        for pg in pages:
            if cur and len(cur) + len(pg) > limit:
                chunks.append(cur)
                cur = pg
            else:
                cur = cur + PAGE_BREAK + pg if cur else pg
        if cur:
            chunks.append(cur)
        if len(chunks) == 1:
            out.append(s)
            continue
        page = s.page
        for k, chunk in enumerate(chunks, start=1):
            out.append(Section(label=f"{s.label} (part {k} of {len(chunks)})", number=s.number, title=s.title,
                               start=s.start, end=s.end, page=page, text=chunk.strip("\n" + PAGE_BREAK), family=s.family,
                               extra={**s.extra, "part": k, "parts": len(chunks)}))
            page += chunk.count(PAGE_BREAK) + 1  # chunks were cut at a page break
    return out


def page_sections(text: str) -> list[Section]:
    out: list[Section] = []
    pos = 0
    for n, page in enumerate(text.split(PAGE_BREAK), start=1):
        body = page.strip("\n")
        if len(body.strip()) >= 40:
            out.append(Section(label=f"Page {n}", number=str(n), title=f"Page {n}", start=pos, end=pos + len(page),
                               page=n, text=body, family="pages"))
        pos += len(page) + 1
    return out


def coverage(sections: list[Section], text: str) -> float:
    if not text.strip():
        return 0.0
    covered = sum(len(s.text) for s in sections)
    return round(min(1.0, covered / max(1, len(text.strip()))), 3)
