"""Network-free parser for eCFR XML: GovInfo bulk `ECFR-title{n}.xml` and eCFR Versioner `full` responses.

One section (`DIV8 TYPE="SECTION"`) or appendix (`DIV9 TYPE="APPENDIX"`) becomes:
  lines   the body as plain text, one block per line (paragraph, heading, table row with cells joined by TAB,
          empty line for a graphic). Joined with "\n" this is the stored `text`.
  layout  one entry per block, in order, describing how to render its line(s):
            ["p", depth]                 paragraph; depth from its (a)/(1)/(i)/(A)/(1)/(i) marker sequence
            ["p", depth, "x"]            paragraph inside a note/example/extract box ("f" = footnote)
            ["h", level] / ["h", level, "x"]   heading inside the body (HD1-HD6, captions, box headings)
            ["t", rows]                  table; `rows` lines follow, one per row. rows is a list per row of
                                         either an int (that many plain cells) or a list of [colspan, rowspan,
                                         header] per cell
            ["g", src]                   graphic (empty line); src is the publisher's graphics path
  notes   [[kind, text], ...] notes kept apart from the body: source (CITA), authority (SECAUTH/PARAUTH),
          omb (APPRO), editorial (EDNOTE), effective_date (EFFDNOT), amendment (XREF "Link to an amendment
          published at ..."), cross_reference (CROSSREF)
Formatting that carries meaning in plain text is kept as text: superscripts/subscripts become Unicode
super/subscript characters (or ^(..)/_(..) when no such character exists), fractions inside a number get a
space ("8 1/2"), accent codes become combining diacritics. Nothing in the body is dropped; unknown elements
are kept as paragraphs and counted.
"""
from __future__ import annotations

import collections
import html
import re
import unicodedata
import urllib.parse
import xml.etree.ElementTree as ET

SUP = dict(zip("0123456789+-−=()abcdefghijklmnoprstuvwxyzABDEGHIJKLMNOPRTUVW*.,",
               "⁰¹²³⁴⁵⁶⁷⁸⁹⁺⁻⁻⁼⁽⁾"
               "ᵃᵇᶜᵈᵉᶠᵍʰⁱʲᵏˡᵐⁿᵒᵖʳˢᵗᵘᵛʷˣʸᶻ"
               "ᴬᴮᴰᴱᴳᴴᴵᴶᴷᴸᴹᴺᴼᴾᴿᵀᵁⱽᵂ*·,"))
SUB = dict(zip("0123456789+-−=()aehijklmnoprstuvx",
               "₀₁₂₃₄₅₆₇₈₉₊₋₋₌₍₎"
               "ₐₑₕᵢⱼₖₗₘₙₒₚᵣₛₜᵤᵥₓ"))
# Accent codes: combining marks applied to the preceding letter. Digits from the GPO eCFR XML User Guide (3.3 AC;
# 8 = macron, as the guide's sample-mean example and the eCFR's own rendering show). Letters b, g, i, j as the eCFR
# renders them (40 CFR 1065.650 and 10 CFR 429.35, checked 2026-10-22): b dot above (ṁ), g macron below (ṯ),
# i dot above + overline (ṁ̅), j dot above + tilde (ṅ̃). Codes with no documented rendering (0, 5, I) are not
# reproduced and are counted in Stats.accents.
ACCENTS = {"1": "́", "2": "̀", "3": "̂", "4": "̈", "6": "̃", "7": "̊", "8": "̄", "9": "̧",
           "b": "̇", "g": "̱", "i": "̇̅", "j": "̇̃"}
FRACTIONS = {"1/2": "½", "1/4": "¼", "3/4": "¾", "1/3": "⅓", "2/3": "⅔", "1/8": "⅛",
             "3/8": "⅜", "5/8": "⅝", "7/8": "⅞", "1/5": "⅕", "1/6": "⅙", "1/16": None}

NOTE_KINDS = {"CITA": "source", "SECAUTH": "authority", "PARAUTH": "authority", "APPRO": "omb", "EDNOTE": "editorial",
              "EFFDNOT": "effective_date", "XREF": "amendment", "CROSSREF": "cross_reference", "AUTH": "authority",
              "SOURCE": "source"}
FLUSH = {"FP": 0, "FP-1": 1, "FP-2": 2, "FP1": 1, "FP2": 2, "FP1-2": 1, "FP-3": 3, "FP3": 3, "FP-DASH": 0, "FRP": 0,
         "FP1-1": 1, "FP2-2": 2, "FP-4": 4, "PSPACE": 0, "FL-1": 1, "FL-2": 2, "LDRFIG": 0, "P-1": 1, "P1": 1, "P-2": 2,
         "P2": 2, "P-3": 3, "P3": 3, "FP2-3": 2, "FRP0": 0, "P-DASH": 0, "HALFDASH": 0, "NAME": 0, "LI": 1}
HEADINGS = {"HD1": 1, "HD2": 2, "HD3": 3, "HD4": 4, "HD5": 5, "HD6": 6, "HED": 2, "TCAP": 3, "BCAP": 3, "TTITLE": 3,
            "APP": 1, "SUBJECT": 3, "HED1": 1, "SECHD": 2, "PARTHD": 1, "SUBCHIND": 3, "DOCKETHD": 3, "CHAPNO": 1}
BOXES = {"NOTE": "x", "EXAMPLE": "x", "EXTRACT": "x", "NOTES": "x", "FTNT": "f", "EFTNT": "f", "APPENDIX": "x",
         "BOXTXT": "x"}
CONTAINERS = {"DIV", "TBODY", "THEAD", "TFOOT", "LDRWK", "MATH", "GPH", "SCOL2"}
SKIP = {"HEAD", "PRTPAGE", "FTREF", "GID"}

_WS = re.compile(r"\s+")
_NL_TAIL = re.compile(r"\n\s*$")
# Emphasis codes printed as subscripts: 52/54 (eCFR XML User Guide 3.33) and 0732, which the eCFR API renders as
# <sub> in tables (5 of 5 cells in the verification sample). Other four-digit typesetting codes have no published
# rendering and stay plain text (no character is lost).
SUB_CODES = ("52", "54", "0732")
_DASHES = str.maketrans({"‐": "-", "‑": "-", "‒": "-", "–": "-", "—": "-", "−": "-"})


def collapse(text: str | None) -> str:
    return _WS.sub(" ", text or "").strip()


def _script(text: str, table: dict, mark: str, letters_plain: bool) -> str:
    t = collapse(text)
    if not t:
        return ""
    if all(c in table for c in t):
        return "".join(table[c] for c in t)
    if letters_plain and t.isalpha():
        return t
    return f"{mark}({t})"


class Stats:
    def __init__(self) -> None:
        self.unknown = collections.Counter()
        self.accents = collections.Counter()
        self.graphics = 0
        self.tables = 0


def inline(elem: ET.Element, stats: Stats | None = None, images: list | None = None) -> str:
    """Inline text of an element with formatting kept as plain text (see module docstring)."""
    parts: list[str] = []
    scripts: set[int] = set()

    def add_script(s: str) -> None:
        # Line breaks of the XML export before a super/subscript: between two of them ("10<sup>−</sup>\n<sup>6</sup>")
        # or after an opening bracket ("(\n<sup>2</sup>)") they are layout and read "10⁻⁶" and "(²)", as the eCFR API
        # prints them; elsewhere ("applicable\n<SU>1</SU>") they stay a space, as the API prints "applicable ¹".
        if parts:
            last = parts[-1]
            m = _NL_TAIL.search(last)
            if m:
                head = last[:m.start()]
                if not head.strip():
                    if len(parts) >= 2 and (len(parts) - 2) in scripts:
                        parts.pop()
                elif head.rstrip()[-1:] in ("(", "["):
                    parts[-1] = head.rstrip()
        scripts.add(len(parts))
        parts.append(s)

    def walk(e: ET.Element, include_tail: bool) -> None:
        tag = e.tag
        if tag in ("SU", "sup") or (tag == "E" and e.get("T") in ("51", "53")):
            add_script(_script("".join(e.itertext()), SUP, "^", True))
        elif tag in ("SUB", "sub") or (tag == "E" and e.get("T") in SUB_CODES):
            add_script(_script("".join(e.itertext()), SUB, "_", False))
        elif tag in ("FR", "fr"):
            frac = collapse("".join(e.itertext()))
            sym = FRACTIONS.get(frac)
            prev = "".join(parts)[-1:]
            if sym:
                parts.append(sym)
            else:
                parts.append((" " if prev.isdigit() else "") + frac)
        elif tag == "AC":
            code = e.get("T") or ""
            mark = ACCENTS.get(code)
            if stats is not None:
                stats.accents[code if mark else f"unmapped:{code}"] += 1
            if mark:
                # The mark follows its letter; the XML often has a line break between them.
                while parts and not parts[-1].strip():
                    parts.pop()
                if parts:
                    parts[-1] = parts[-1].rstrip()
                parts.append(mark)
        elif tag in ("br", "BR"):
            parts.append(" ")
        elif tag in ("img", "IMG"):
            if images is not None and e.get("src"):
                images.append(e.get("src"))
            if stats is not None:
                stats.graphics += 1
        elif tag == "FTREF":
            pass
        else:
            if e.text:
                parts.append(e.text)
            for c in e:
                walk(c, True)
        if include_tail and e.tail:
            parts.append(e.tail)

    if elem.text:
        parts.append(elem.text)
    for child in elem:
        walk(child, True)
    return collapse("".join(parts))


# ----------------------------------------------------------------------------------------------- paragraph levels
ORDER = {"L": 0, "N": 1, "R": 2, "U": 3, "IN": 4, "IR": 5, "IL": 6, "IU": 7}
_ROMAN = [(1000, "m"), (900, "cm"), (500, "d"), (400, "cd"), (100, "c"), (90, "xc"), (50, "l"), (40, "xl"), (10, "x"),
          (9, "ix"), (5, "v"), (4, "iv"), (1, "i")]


def to_roman(n: int) -> str:
    out = ""
    for v, s in _ROMAN:
        while n >= v:
            out += s
            n -= v
    return out


def roman_value(s: str) -> int | None:
    if not s or not re.fullmatch(r"[ivxlcdm]+", s):
        return None
    vals = {"i": 1, "v": 5, "x": 10, "l": 50, "c": 100, "d": 500, "m": 1000}
    total = 0
    for a, b in zip(s, s[1:] + " "):
        v = vals[a]
        total += -v if b != " " and vals.get(b, 0) > v else v
    return total if to_roman(total) == s else None


def letter_next(s: str) -> str:
    """a->b, z->aa, aa->bb, zz->aaa (CFR doubled-letter paragraphs)."""
    if s and len(set(s)) == 1 and s[0].isalpha():
        c = s[0]
        if c in "zZ":
            return ("a" if c == "z" else "A") * (len(s) + 1)
        return chr(ord(c) + 1) * len(s)
    return ""


def is_letter_seq(s: str) -> bool:
    return bool(s) and len(set(s)) == 1 and s.isalpha() and len(s) <= 3


def candidates(token: str, italic: bool) -> list[str]:
    if token.isdigit():
        return ["IN" if italic else "N"]
    if token.isalpha() and token.isupper() and is_letter_seq(token):
        return ["IU" if italic else "U"]
    if token.isalpha() and token.islower():
        out = []
        if roman_value(token) is not None:
            out.append("IR" if italic else "R")
        if is_letter_seq(token):
            out.append("IL" if italic else "L")
        return out
    return []


def successor(kind: str, value: str) -> str:
    if kind in ("N", "IN"):
        return str(int(value) + 1)
    if kind in ("R", "IR"):
        v = roman_value(value)
        return to_roman(v + 1) if v else ""
    return letter_next(value)


_MARK = re.compile(r"\(([0-9]{1,3}|[a-z]{1,4}|[A-Z]{1,3})\)")


def leading_markers(elem: ET.Element) -> list[tuple[str, bool]]:
    """Markers at the start of a paragraph, e.g. "(b)(1)" or "(<I>1</I>)", with their italic flag."""
    chars: list[tuple[str, bool]] = []

    def add(text: str | None, italic: bool) -> bool:
        for ch in text or "":
            chars.append((ch, italic))
            if len(chars) > 600:
                return False
        return True

    def walk(e: ET.Element, italic: bool) -> bool:
        it = italic or e.tag in ("I", "i") or (e.tag == "E" and e.get("T") in ("03", "7462"))
        if not add(e.text, it):
            return False
        for c in e:
            if not walk(c, it) or not add(c.tail, it):
                return False
        return True

    add(elem.text, False)
    for c in elem:
        if not walk(c, False) or not add(c.tail, False):
            break
    s = "".join(c for c, _ in chars)
    out: list[tuple[str, bool]] = []

    def take(pos: int) -> int:
        while True:
            m = _MARK.match(s, pos)
            if not m:
                return pos
            tok = m.group(1)
            italic = all(chars[i][1] for i in range(m.start(1), m.end(1)))
            out.append((tok, italic))
            pos = m.end()

    pos = take(len(s) - len(s.lstrip()))
    if out:
        # "(a) <I>Heading.</I> (1)(i) text": markers right after an italic paragraph heading open child paragraphs
        # inside the same XML paragraph. They update the numbering state but not this paragraph's depth.
        while pos < len(s) and s[pos] == " ":
            pos += 1
        start = pos
        while pos < len(s) and chars[pos][1]:
            pos += 1
        if pos - start >= 2 and s[start:pos].rstrip()[-1:] in (".", "—", ":", "-"):
            while pos < len(s) and s[pos] in " .—":
                pos += 1
            take(pos)
    return out


def assign_depths(markers_per_par: list[list[tuple[str, bool]]]) -> list[int | None]:
    """Depth per marked paragraph (None for unmarked), resolving (i)/(v)/(x) letter-vs-roman by context and lookahead."""
    stack: list[tuple[str, str]] = []
    last: dict[str, str] = {}
    base: int | None = None
    out: list[int | None] = []
    firsts = [m[0] if m else None for m in markers_per_par]

    def next_first(i: int):
        for j in range(i + 1, len(firsts)):
            if firsts[j]:
                return firsts[j]
        return None

    def choose(tok: str, italic: bool, i: int, floor: int) -> str | None:
        cands = [c for c in candidates(tok, italic) if ORDER[c] > floor]
        if not cands:
            return None
        if len(cands) == 1:
            return cands[0]
        rom = "IR" if italic else "R"
        let = "IL" if italic else "L"
        parent_of_roman = "IN" if italic else "N"
        kinds = [k for k, _ in stack]
        rom_ok = (tok in ("i",) and (parent_of_roman in kinds or (kinds and ORDER[kinds[-1]] >= ORDER[parent_of_roman]))) or \
                 (rom in last and successor(rom, last[rom]) == tok)
        let_ok = tok in ("a",) or (let in last and successor(let, last[let]) == tok)
        if rom_ok and not let_ok:
            return rom
        if let_ok and not rom_ok:
            return let
        nxt = next_first(i)
        if nxt:
            ntok, nital = nxt
            if ntok == successor(rom, tok) and nital == italic:
                return rom
            if ntok == successor(let, tok) and nital == italic:
                return let
            if ntok.isdigit():
                return let
            if ntok.isupper():
                return rom
        if kinds and ORDER[kinds[-1]] >= ORDER[parent_of_roman]:
            return rom
        return let

    for i, markers in enumerate(markers_per_par):
        if not markers:
            out.append(None)
            continue
        depth = None
        floor = -1
        for k, (tok, italic) in enumerate(markers):
            kind = choose(tok, italic, i, floor if k else -1)
            if kind is None:
                break
            idx = ORDER[kind]
            stack = [(kk, vv) for kk, vv in stack if ORDER[kk] < idx]
            stack.append((kind, tok))
            last[kind] = tok
            for kk in list(last):
                if ORDER[kk] > idx:
                    del last[kk]
            if k == 0:
                if base is None:
                    base = idx
                depth = max(0, idx - base)
            floor = idx
        out.append(depth)
    return out


# ----------------------------------------------------------------------------------------------- body blocks
class Body:
    def __init__(self, stats: Stats) -> None:
        self.lines: list[str] = []
        self.layout: list[list] = []
        self.notes: list[list[str]] = []
        self.stats = stats
        self._pars: list[tuple[int, list]] = []  # (layout index, markers) of top-level P paragraphs

    def par(self, text: str, depth: int = 0, flag: str = "", markers: list | None = None) -> None:
        if not text:
            return  # an empty element in the source (e.g. <P> </P>) prints nothing
        self.lines.append(text)
        self.layout.append(["p", depth, flag] if flag else ["p", depth])
        if markers is not None:
            self._pars.append((len(self.layout) - 1, markers))

    def head(self, text: str, level: int, flag: str = "") -> None:
        if not text:
            return
        self.lines.append(text)
        self.layout.append(["h", level, flag] if flag else ["h", level])

    def graphic(self, src: str) -> None:
        self.lines.append("")
        self.layout.append(["g", src])

    def finish(self) -> None:
        depths = assign_depths([m for _, m in self._pars])
        prev = 0
        positions = {li: d for (li, _), d in zip(self._pars, depths)}
        for li, entry in enumerate(self.layout):
            if entry[0] != "p" or len(entry) > 2:
                continue
            if li in positions:
                d = positions[li]
                if d is None:
                    d = prev
                entry[1] = d
                prev = d
        # Unmarked paragraphs keep the depth of the paragraph before them (set above); flush paragraphs keep theirs.


def note_text(elem: ET.Element, stats: Stats) -> str:
    """Note content: its HED label and paragraphs joined by spaces (e.g. "Editorial Note: 89 FR 101463, ...")."""
    if not len(elem):
        return inline(elem, stats)
    bits = []
    lead = collapse(elem.text)
    if lead:
        bits.append(lead)
    for c in elem:
        t = inline(c, stats)
        if t:
            bits.append(t)
        tail = collapse(c.tail)
        if tail:
            bits.append(tail)
    return " ".join(bits)


TABLE_TEXT_CLASSES = {"gpotbl_title": 3, "title": 3, "gpotbl_description": 4, "description": 4}


def _table_rows(elem: ET.Element, rows: list, foot: list) -> None:
    """Rows of a table in order; TFOOT rows (table notes) apart. Tables nested in a cell stay in that cell's text."""
    for c in elem:
        if c.tag in ("TR", "ROW"):
            rows.append(c)
        elif c.tag == "TFOOT":
            foot.extend(r for r in c if r.tag in ("TR", "ROW"))
        elif c.tag in ("THEAD", "TBODY", "TGROUP", "BOXHD"):
            _table_rows(c, rows, foot)


def table(elem: ET.Element, body: Body) -> None:
    """Caption lines become headings, rows one TAB-joined line each, TFOOT rows footnote paragraphs, so the eCFR API
    form (CAPTION/THEAD/TBODY/TFOOT) and the GovInfo form (title paragraphs, rows, note paragraphs) read the same."""
    for cap in (c for c in elem if c.tag == "CAPTION"):
        ps = [p for p in cap if p.tag == "P"]
        if not ps:
            body.head(inline(cap, body.stats), 3)
        for p in ps:
            body.head(inline(p, body.stats), TABLE_TEXT_CLASSES.get(p.get("class") or "", 4))
    rows: list = []
    foot: list = []
    _table_rows(elem, rows, foot)
    spec: list = []
    for r in rows:
        cells = [c for c in r if c.tag in ("TD", "TH", "ENT")]
        texts, cspec, plain = [], [], True
        for c in cells:
            images: list[str] = []
            t = inline(c, body.stats, images)
            if images:
                t = (t + " " if t else "") + " ".join(f"[graphic {s.rsplit('/', 1)[-1]}]" for s in images)
            texts.append(t.replace("\t", " "))
            cs = int(c.get("colspan") or c.get("COLSPAN") or 1)
            rs = int(c.get("rowspan") or c.get("ROWSPAN") or 1)
            hd = 1 if c.tag == "TH" or "colhed" in (c.get("class") or "") else 0
            if cs != 1 or rs != 1 or hd:
                plain = False
            cspec.append([cs, rs, hd])
        if not cells:
            continue
        body.lines.append("\t".join(texts))
        spec.append(len(cells) if plain else cspec)
    if spec:
        body.layout.append(["t", spec])
        body.stats.tables += 1
    for r in foot:
        body.par(" ".join(t for t in (inline(c, body.stats) for c in r) if t), 0, "f")


def leader(elem: ET.Element, body: Body) -> None:
    """LDRWK: label/figure pairs (FL-n then LDRFIG) as a two-column table."""
    rows: list[list[str]] = []
    for c in elem:
        t = inline(c, body.stats)
        if c.tag == "LDRFIG" and rows and len(rows[-1]) == 1:
            rows[-1].append(t)
        else:
            rows.append([t])
    if rows:
        for r in rows:
            body.lines.append("\t".join(x.replace("\t", " ") for x in r))
        body.layout.append(["t", [len(r) for r in rows]])
        body.stats.tables += 1


def blocks(elem: ET.Element, body: Body, flag: str = "", top: bool = True) -> None:
    """Walk the children of a section/appendix (or of a box inside it) and append blocks in document order."""
    lead = collapse(elem.text)
    if lead and not top:
        body.par(lead, 0, flag or "")
    elif lead:
        body.par(lead, 0, "", markers=[])
    for c in elem:
        tag = c.tag
        if tag in SKIP:
            pass
        elif tag in NOTE_KINDS and top:
            text = note_text(c, body.stats)
            if text:
                body.notes.append([NOTE_KINDS[tag], text])
        elif tag == "P" and (c.get("class") or "") in TABLE_TEXT_CLASSES:
            body.head(inline(c, body.stats), TABLE_TEXT_CLASSES[c.get("class") or ""], flag)
        elif tag == "P" and c.get("class") == "gpotbl_note":
            body.par(inline(c, body.stats), 0, "f")
        elif tag == "P":
            images: list[str] = []
            text = inline(c, body.stats, images)
            if text or not images:
                if top and not flag:
                    body.par(text, 0, "", markers=leading_markers(c))
                else:
                    body.par(text, 0, flag)
            for src in images:
                body.graphic(src)
        elif tag in FLUSH:
            images = []
            text = inline(c, body.stats, images)
            body.par(text, FLUSH[tag], flag or "i")
            for src in images:
                body.graphic(src)
        elif tag in HEADINGS:
            body.head(inline(c, body.stats), HEADINGS[tag], flag)
        elif tag in ("TABLE", "GPOTABLE"):
            table(c, body)
        elif tag == "LDRWK":
            leader(c, body)
        elif tag in ("img", "IMG"):
            if c.get("src"):
                body.graphic(c.get("src"))
                body.stats.graphics += 1
        elif tag in BOXES:
            blocks(c, body, BOXES[tag], top=False)
        elif tag in CONTAINERS:
            blocks(c, body, flag, top=False if flag else top)
        elif tag in NOTE_KINDS:
            text = note_text(c, body.stats)
            if text:
                body.par(text, 0, flag or "x")
        else:
            body.stats.unknown[tag] += 1
            text = inline(c, body.stats)
            if text:
                body.par(text, 0, flag or "i")
        tail = collapse(c.tail)
        if tail:
            body.par(tail, 0, flag or "i")


def parse_item(elem: ET.Element, stats: Stats) -> dict:
    """Parse one DIV8/DIV9 element into heading, lines, layout and notes."""
    head = elem.find("HEAD")
    body = Body(stats)
    blocks(elem, body)
    body.finish()
    return {
        "n": html.unescape(elem.get("N") or ""),
        "type": elem.get("TYPE") or "",
        "heading": inline(head, stats) if head is not None else "",
        "lines": body.lines,
        "layout": body.layout,
        "notes": body.notes,
    }


def norm_identifier(n: str) -> str:
    """Section N attribute ("§ 1.1", "§§ 13.21 -13.29", "§ 752.1.", "Sec. 1-1") -> structure identifier form."""
    s = (n or "").replace("thnsp;", " ").replace("&", "").strip()
    s = re.sub(r"^(§+|Sec\.|Section)\s*", "", s)
    return s.strip().rstrip(".").strip()


def loose(s: str) -> str:
    """Comparison key: NFKC (superscript digits become digits), dashes folded, section signs, parentheses, brackets
    and whitespace removed, case folded."""
    return re.sub(r"[\s§()\[\]]+", "", unicodedata.normalize("NFKC", s or "").translate(_DASHES)).lower()


def native_segment(kind: str, identifier: str) -> str:
    return f"{kind}-{urllib.parse.quote(identifier, safe='')}"


# ----------------------------------------------------------------------------------------------- streaming over a title
DIV_TYPES = {"TITLE", "SUBTITLE", "CHAPTER", "SUBCHAP", "PART", "SUBPART", "SUBJGRP", "SECTION", "APPENDIX"}


STRUCTURAL = ("PART", "SUBPART", "SUBJGRP", "CHAPTER", "SUBCHAP", "TITLE", "SUBTITLE")
TOC_TAGS = {"CFRTOC", "PTHD", "CHAPTI", "SUBJECT", "PG", "RESERVED", "AMDDATE", "SUBTI", "PARTTOC", "SECTNO"}


def _ancestors(stack: list[ET.Element], stats: Stats) -> list[tuple[str, str, str, str]]:
    """[(TYPE, N, heading, NODE), ...]; NODE (GovInfo) tells apart two XML elements of one part split across volumes."""
    out = []
    for e in stack:
        if e.tag.startswith("DIV") and e.get("TYPE") in DIV_TYPES:
            h = e.find("HEAD")
            out.append((e.get("TYPE"), html.unescape(e.get("N") or ""), inline(h, stats) if h is not None else "",
                        e.get("NODE") or f"@{id(e)}"))
    return out


def iter_title(fileobj, stats: Stats):
    """Stream one title in document order. Yields
      ("item", parsed, ancestors)      each section/appendix (parse_item output)
      ("note", (kind, text), ancestors) a note attached to a part, subpart, subject group, chapter, subchapter or title
      ("body", parsed, ancestors)      other content placed directly in a part/subpart/subject group (not a section)
    ancestors = [(TYPE, N, heading), ...] from the title down to the parent of the yielded element."""
    stack: list[ET.Element] = []
    for event, elem in ET.iterparse(fileobj, events=("start", "end")):
        if event == "start":
            stack.append(elem)
            continue
        stack.pop()
        typ = elem.get("TYPE") if elem.tag.startswith("DIV") else None
        parent = stack[-1] if stack else None
        ptype = parent.get("TYPE") if parent is not None and parent.tag.startswith("DIV") else None
        if typ in ("SECTION", "APPENDIX"):
            yield "item", parse_item(elem, stats), _ancestors(stack, stats)
            elem.clear()
        elif ptype in STRUCTURAL and elem.tag in NOTE_KINDS:
            text = note_text(elem, stats)
            if text:
                yield "note", (NOTE_KINDS[elem.tag], text), _ancestors(stack, stats)
            elem.clear()
        elif ptype in STRUCTURAL and elem.tag != "HEAD" and not elem.tag.startswith("DIV"):
            if elem.tag in TOC_TAGS:
                stats.unknown["toc:" + elem.tag] += 1
            else:
                wrapper = ET.Element("WRAP")
                wrapper.append(elem)
                body = Body(stats)
                blocks(wrapper, body)
                body.finish()
                if body.lines:
                    yield "body", {"lines": body.lines, "layout": body.layout, "notes": body.notes, "tag": elem.tag}, _ancestors(stack, stats)
            elem.clear()
        elif typ in STRUCTURAL:
            elem.clear()


FR_CITE = re.compile(r"\b(\d{1,3})\s+FR\s+(\d{1,6})\b")


def fr_citations(text: str) -> list[tuple[int, int]]:
    """(volume, page) pairs cited in a note, in order, without duplicates."""
    seen, out = set(), []
    for m in FR_CITE.finditer(text or ""):
        key = (int(m.group(1)), int(m.group(2)))
        if key not in seen:
            seen.add(key)
            out.append(key)
    return out
