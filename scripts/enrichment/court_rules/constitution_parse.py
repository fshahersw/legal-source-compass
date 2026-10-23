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
# "ARTICLE.&#8194;1. - Declaration of Rights." (leg.state.nv.us) prints a point after the word
ARTICLE = re.compile(rf"^(?:ARTICLE\.?|Article\.?|ART\.|Art\.)\s+([IVXLC]+|\d+[A-Z]?|{ORDINALS}|{ORDINALS.title()})\b\.?\s*[-–—:.]?\s*(.*)$")
SECTION = re.compile(r"^(?:SECTION|Section|SEC\.|Sec\.|§+)\s*(\d+[A-Za-z]?(?:[.\-](?:\d+[A-Za-z]?|[A-Z]\b))*)\b\.?\s*[-–—:.]?\s*(.*)$")
CATCHWORD = re.compile(r"^([A-Z][A-Za-z ,;'’()-]{1,80}\.)\s+(?:SECTION|Section|SEC\.|Sec\.)\s*(\d+[a-z]?)\.\s+(?=[A-Z(\[])(.*)$")
# "Section 44. 1. Commission composition" (crs title 00): a decimal section number printed with a space after the point
SPACED_DECIMAL = re.compile(r"^(\d{1,2})\.\s+(?=[A-Z])")
TOC = re.compile(r"(?:\.\s?){4,}\s*\d*\s*$|\s\.{2,}\s*\d+\s*$")
# "Article I, Section 1 | Inalienable Rights" (codes.ohio.gov) names both levels on one line
COMBINED = re.compile(r"^(?:Article|ARTICLE)\s+([IVXLC]+|\d+[A-Z]?),\s*(?:Section|SECTION)\s+(\d+[A-Za-z]?(?:[.\-]\d+[A-Za-z]?)*)\s*[|.:\-–—]?\s*(.*)$")


def _title(rest: str, max_len: int = 160) -> str:
    rest = rest.strip()
    m = re.match(r"^\[([^\]]{2,150})\]\.?\s*", rest)  # "[Equality of men.]" style catchlines
    if m:
        return m.group(1).strip()
    # A capitals catchline runs to its first period, semicolons included: "FREEDOM OF SPEECH AND PRESS; LIBEL.  Every
    # person shall ..." is "FREEDOM OF SPEECH AND PRESS; LIBEL", not "FREEDOM OF SPEECH AND PRESS;".
    caps = re.match(r"^([^a-z]*?[A-Z]{3}[^a-z]*?)\.(?:\s|$)", rest)
    if caps and len(caps.group(1)) <= max_len:
        return caps.group(1).strip(" .")
    head = re.split(r"(?<=[.;:])\s", rest, maxsplit=1)[0]
    # Longer than a catchline: body text, not a heading; never cut a heading mid-word.
    return head.strip(" .") if len(head) <= max_len else ""


def _heading_line(rest: str, max_len: int = 220) -> str:
    """The rest of a combined "Article I, Section 4 | Bearing arms; standing armies; military power" line: the
    publisher's whole heading (the line holds nothing else)."""
    rest = rest.strip().strip(" .")
    return rest if len(rest) <= max_len else ""


def _shape(line: str) -> str:
    s = re.sub(r"\b[IVXLC]+\b", "R", line.strip())
    s = re.sub(r"\d+", "#", s)
    s = re.sub(r"\(([a-z])\)", "(x)", s)
    return re.sub(r"\s+", " ", s).lower()


def running_lines(lines: list[str]) -> set[int]:
    """Indexes of running page headers and footers in a paged rendering (pages end with a form feed): lines among the
    first or last three of a page whose exact text recurs at the edge of three or more pages ("Article IV – Legislative
    Department"), or that name an article and a section and whose shape recurs at the edge of three or more pages
    ("Article IV Section 8", "Art. III § 38(d)"). They stay in the text but never open an article or section."""
    pages: list[list[int]] = [[]]
    for i, line in enumerate(lines):
        if "\f" in line:
            pages.append([])
        if line.strip(" \f"):
            pages[-1].append(i)
    if len(pages) < 4:
        return set()
    edge: list[int] = []
    for page in pages:
        edge.extend(page[:3] + page[-3:])
    exact: dict[str, set] = {}
    shape: dict[str, set] = {}
    for n, page in enumerate(pages):
        for i in set(page[:3] + page[-3:]):
            exact.setdefault(lines[i].strip(" \f"), set()).add(n)
            shape.setdefault(_shape(lines[i].strip(" \f")), set()).add(n)
    both = re.compile(r"^(?:ARTICLE|Article|ART\.|Art\.)\s+\S+.*(?:SECTION|Section|SEC\.|Sec\.|§)\s*\d", re.I)
    # how often each text / shape occurs anywhere: a running line sits at a page edge (almost) every time it is printed,
    # while a real heading such as "Article 1, Section 1" (one per section) mostly falls inside pages
    exact_all: dict[str, int] = {}
    shape_all: dict[str, int] = {}
    for line in lines:
        s = line.strip(" \f")
        if s:
            exact_all[s] = exact_all.get(s, 0) + 1
            shape_all[_shape(s)] = shape_all.get(_shape(s), 0) + 1
    edge_set = set(edge)
    exact_edge: dict[str, int] = {}
    shape_edge: dict[str, int] = {}
    for i in edge_set:
        s = lines[i].strip(" \f")
        exact_edge[s] = exact_edge.get(s, 0) + 1
        shape_edge[_shape(s)] = shape_edge.get(_shape(s), 0) + 1
    out = set()
    for i in edge_set:
        s = lines[i].strip(" \f")
        sh = _shape(s)
        # a bare repeated "Section 1." or "ARTICLE I" is a real heading that often starts a page, never furniture
        repeated_text = (len(exact.get(s, ())) >= 3 and not SECTION.match(s) and len(s.split()) >= 3
                         and exact_edge[s] >= 0.75 * exact_all[s])
        repeated_shape = both.match(s) and len(shape.get(sh, ())) >= 3 and shape_edge[sh] >= 0.75 * shape_all[sh]
        if repeated_text or repeated_shape:
            out.add(i)
    return out


def split_constitution(text: str) -> list[dict]:
    lines = text.split("\n")
    furniture = running_lines(lines)
    units: list[dict] = []
    article = None
    article_title = None
    current = None
    pos = 0
    for n_line, line in enumerate(lines):
        start = pos
        pos += len(line) + 1
        s = line.strip()
        if not s or s == "\f" or n_line in furniture:
            if current is not None:
                current["lines"].append(line)
            elif s:
                current = {"article": None, "article_title": None, "section": None, "section_title": None, "start": start, "lines": [line]}
            continue
        cm = COMBINED.match(s)
        if cm and len(s) < 220 and not TOC.search(s):
            article = cm.group(1)
            if current is not None:
                units.append(current)
            current = {"article": article, "article_title": article_title if article == (current or {}).get("article") else None,
                       "section": cm.group(2), "section_title": (_heading_line(cm.group(3)) if "|" in s else _title(cm.group(3))) or None,
                       "start": start, "lines": [line]}
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
            number = sm.group(1)
            spaced = SPACED_DECIMAL.match(rest or "") if re.fullmatch(r"\d+", number) and re.match(r"^\S+\s*\d+\.\s", s) else None
            if spaced:
                number, rest = f"{number}.{spaced.group(1)}", rest[spaced.end():]
            if rest and (rest[:1].islower() or rest[:1] in ",;)"):
                pass  # "Section 4 of this article ..." wrapped inside a sentence: not a heading
            else:
                if current is not None:
                    units.append(current)
                current = {"article": article, "article_title": article_title, "section": number, "section_title": _title(rest) or None,
                           "start": start, "lines": [line]}
                continue
        cw = CATCHWORD.match(s)
        if cw and not TOC.search(s):
            # "Courts. SECTION 1. The Judicial power ..." (Iowa, Wisconsin): the catchword printed before the number
            if current is not None:
                units.append(current)
            current = {"article": article, "article_title": article_title, "section": cw.group(2), "section_title": cw.group(1).strip(" ."),
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


PROVISION_VERB = re.compile(r"\b(?:shall|may|must|is|are|be|been|was|were|has|have|will|hereby)\b", re.I)


def heading_only(u: dict) -> bool:
    """A unit holding headings and catchlines but no provision text: none of the verbs a provision states its rule with
    (shall, may, must, is, are, be, ...). Line length is no guide: two-column publications print provisions in short lines."""
    return bool(u["text"].strip()) and len(u["text"]) < 1500 and not PROVISION_VERB.search(u["text"])


NUMBERED_LINE = re.compile(r"^(?:(?:SECTION|Section|SEC\.|Sec\.)\s*|§+\s*)?\d+[A-Za-z]?(?:[.\-][A-Za-z0-9]+)*\.?(?:\s|$)")


def contents_like(u: dict) -> bool:
    """Headings without provision text: heading-only, or a list of numbered lines such as an article's table of sections."""
    lines = [ln.strip() for ln in u["text"].split("\n") if ln.strip()]
    if heading_only(u):
        return True
    if PROVISION_VERB.search(u["text"][:300]):
        return False  # a provision states its rule at once; a table of sections does not
    numbered = sum(1 for ln in lines if NUMBERED_LINE.match(ln))
    if numbered >= 3 and numbered >= 0.3 * len(lines):
        return True
    # a table of sections run together on lines: "... judges. 17. Town, village and city courts; jurisdiction. 18. Trial ..."
    return len(re.findall(r"(?:^|[.;]\s)(?:§\s*)?\d{1,3}[a-z-]*\.\s+[A-Z]", u["text"], re.M)) >= 4


def clean_units(units: list[dict]) -> tuple[list[dict], dict]:
    """Remove units that are page furniture rather than provisions, without changing any provision's words:
      * a contents-like section unit (contents_like) whose article and section number recur LATER in a unit with
        provision text is a contents entry (dropped) or, when it comes right before that unit, a margin heading (its
        words are kept at the start of the section);
      * a heading-only article unit in an article that has sections is its heading (kept as the article title);
      * a heading-only unit outside any article (a document title or running header) is dropped.
    Returns the kept units and the counts of each change."""
    stats: dict[str, int] = {}

    def bump(k: str) -> None:
        stats[k] = stats.get(k, 0) + 1

    last_body: dict = {}
    for i, u in enumerate(units):
        if u.get("section") and not contents_like(u):
            last_body[(u.get("article"), u.get("section"))] = i
    has_body = set(last_body)
    with_sections = {u.get("article") for u in units if u.get("section")}
    titles: dict = {}
    out: list[dict] = []
    for i, u in enumerate(units):
        key = (u.get("article"), u.get("section"))
        nxt = units[i + 1] if i + 1 < len(units) else None
        # contents-like units are dropped when the provision follows them (a table of contents precedes the text);
        # strictly heading-only units also when it precedes them (an index printed after the text)
        if u.get("section") and ((last_body.get(key, -1) > i and contents_like(u)) or (key in has_body and heading_only(u))):
            if nxt is not None and (nxt.get("article"), nxt.get("section")) == key and not contents_like(nxt):
                nxt["text"] = u["text"].rstrip() + "\n" + nxt["text"]
                nxt["start"] = u.get("start", nxt.get("start"))
                nxt["section_title"] = nxt.get("section_title") or u.get("section_title")
                bump("margin_heading_kept_with_section")
            else:
                bump("contents_entry_dropped")
            continue
        if not u.get("section") and heading_only(u) and len(u["text"]) < 300:
            if u.get("article") and u.get("article") in with_sections:
                lines = [ln.strip() for ln in u["text"].split("\n") if ln.strip()]
                second = lines[1].strip(" .") if len(lines) > 1 else ""
                # the line under "ARTICLE VI" is its title unless it is a section heading or a page number
                title = u.get("article_title") or (second if second and not SECTION.match(second) and re.search(r"[A-Za-z]{3}", second) else None)
                titles.setdefault(u["article"], title)
                bump("article_heading_kept_as_title")
                continue
            if not u.get("article") and len(u["text"]) < 200:
                bump("title_or_running_header_dropped")
                continue
        out.append(u)
    # a table of contents printed before the text: units of later articles that come before the first article
    # (e.g. II, VI, XIII ... before Article I) and whose article recurs in the text are contents, not provisions
    nums = [article_number(u.get("article")) for u in out]
    known = [n for n in nums if n is not None]
    if known:
        first = nums.index(min(known))
        later = {u.get("article") for u in out[first:]}
        kept = []
        for i, u in enumerate(out):
            if i < first and nums[i] is not None and nums[i] > min(known) and u.get("article") in later:
                bump("leading_contents_entry_dropped")
                continue
            kept.append(u)
        out = kept
    for u in out:
        if not u.get("article_title") and titles.get(u.get("article")):
            u["article_title"] = titles[u["article"]]
    return out, stats


def article_number(label: str | None) -> int | None:
    if not label:
        return None
    m = re.match(r"^(\d+)", label)
    if m:
        return int(m.group(1))
    return roman_to_int(label) if re.fullmatch(r"[IVXLC]+", label) else None


def repeated_share(units: list[dict]) -> float:
    """Share of section units that hold headings only (contents_like) and repeat another unit's article and section
    number: contents entries that could not be told apart from the provision, i.e. a mis-read structure. (Two
    provisions with text under one number, such as an original and an amended article, are the publisher's own.)"""
    secs = [u for u in units if u.get("section")]
    if not secs:
        return 0.0
    seen: dict = {}
    for u in secs:
        k = (u.get("article"), u.get("section"))
        seen[k] = seen.get(k, 0) + 1
    return sum(1 for u in secs if seen[(u.get("article"), u.get("section"))] > 1 and contents_like(u)) / len(secs)


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
