"""Deterministic plain-text rendering of CourtListener opinion markup (HTML and Harvard XML).

    render(markup) -> Rendered(text, citations, stats)

Rules (version RENDERER below; any change to these rules must bump it):

* Every character outside markup is kept: text nodes, CDATA, and the text inside inline elements (citations, page
  numbers such as ``*232``, footnote markers, emphasis). Only comments, ``<script>``/``<style>`` content, processing
  instructions/doctypes and attribute values are not text. The one attribute rendered as text is the footnote
  label of Harvard ``<footnote label="N">``, which begins its footnote block ("N " + footnote text).
* Entities are decoded with the HTML5 rules (``html.unescape``); CDATA is literal.
* Block elements (p, div, blockquote, headings, list items, tables, Harvard/Columbia/Lawbox structural elements such
  as opinion, author, footnote, judges) separate paragraphs with one blank line; ``<br>`` is a line break; table rows
  end a line and table cells are separated by a space.
* Whitespace outside ``<pre>``: every run of whitespace (space, tab, CR, LF, FF, VT, NBSP and the Unicode space
  separators) becomes one space. Inside ``<pre>`` line breaks are kept and runs of horizontal whitespace become one
  space. Lines are stripped, at most one blank line is kept between paragraphs, and the text has no leading or
  trailing whitespace. ``<pre class="inline">`` (CourtListener's wrapper around plain-text opinions) is inline;
  any other ``<pre>`` is also a block.
* Unknown elements are inline (no separator) and are counted in ``stats["unknown_tags"]`` so they can be reviewed.
* A ``<`` that does not start well-formed markup is text, as in a browser.

Citation anchors: for every ``<span class="citation" data-id="N">`` (CourtListener's citation-link markup in
html_with_citations) the cited opinion id N, the cluster id taken from its ``<a href="/opinion/<cluster>/...">``
link when present, and the [start, end) code-point offsets of the anchor text in the rendered text.
``class="citation no-link"`` spans (citations CourtListener could not resolve) carry no id and are only counted.

Page markers: Harvard ``<page-number citation-index="1" label="232">*232</page-number>`` and Columbia
``<span class="star-pagination" citation-index="1" label="274">*274</span>`` are inline text and are also reported
with the offset of their marker text. ``paginate()`` decides, per opinion, where the xml_harvard page breaks sit in
the chosen text (see its docstring).
"""
from __future__ import annotations

import html
import re

RENDERER = "html_text/1"

# whitespace collapsed outside <pre>; \x1c-\x1f (str.isspace() but control characters) are deliberately not included
WS_CHARS = " \t\n\r\f\v\xa0                　\x85"
WS_RUN = re.compile("[" + re.escape(WS_CHARS) + "]+")
HWS = WS_CHARS.replace("\n", "")
HWS_RUN = re.compile("[" + re.escape(HWS) + "]+")

_S = r"[\t\n\f\r ]"
# One markup token at a '<'. Attributes follow the HTML5 tokenizer: a quote only delimits a value right after '='.
TOKEN = re.compile(
    r"<!--.*?(?:-->|\Z)"
    r"|<!\[CDATA\[(?P<cdata>.*?)(?:\]\]>|\Z)"
    r"|<![^>]*>"
    r"|<\?.*?(?:\?>|\Z)"
    r"|<(?P<close>/?)(?P<name>[A-Za-z][^\t\n\f\r />]*+)"
    r"(?P<attrs>(?>" + _S + r"++|/|[^\t\n\f\r />=][^\t\n\f\r />=]*+(?>" + _S + r"*+=" + _S + r"*+(?>\"[^\"]*+\"|'[^']*+'|[^\t\n\f\r >]++))?|=[^\t\n\f\r />]*+)*+)>",
    re.S,
)
ATTR = re.compile(r"([^\t\n\f\r />=]+)(?:" + _S + r"*=" + _S + r"*(?:\"([^\"]*)\"|'([^']*)'|([^\t\n\f\r >]+)))?")
OPINION_HREF = re.compile(r"^/opinion/(\d+)/")

BLOCK = frozenset(
    """
    address article aside blockquote body caption center col colgroup dd details dialog dir div dl dt fieldset figcaption
    figure footer form h1 h2 h3 h4 h5 h6 head header hgroup hr html legend li main menu nav ol p section summary table
    tbody tfoot thead title ul tgroup colspec
    opinion author footnote judges attorneys headnotes otherdate decisiondate docketnumber parties court citation
    casebody syllabus disposition seealso correction summary
    bodytext content counselor courtname jurisdiction jurissystem excerpt casehistory priorhistory appealhistory history
    footnote_body h
    """.split()
)
INLINE = frozenset(
    """
    a abbr acronym b bdi bdo big cite code data del dfn em font i img ins kbd label mark q s samp small span strike strong
    sub sup time tt u var wbr
    page-number footnotemark bracketnum cross_reference extracted-citation emphasis footnotereference footnote_reference
    historycite
    """.split()
)
SKIP_CONTENT = frozenset(("script", "style"))


def attrs_of(s: str) -> dict[str, str]:
    out: dict[str, str] = {}
    for m in ATTR.finditer(s):
        k = m.group(1).lower()
        if k not in out:
            v = m.group(2) if m.group(2) is not None else m.group(3) if m.group(3) is not None else m.group(4)
            out[k] = html.unescape(v) if v else ""
    return out


class _Out:
    """Text builder that normalises whitespace as it goes, so offsets refer to the final text."""

    __slots__ = ("parts", "n", "nl", "sp", "started", "glue")

    def __init__(self) -> None:
        self.parts: list[str] = []
        self.n = 0
        self.nl = 0  # pending line breaks (0, 1 or 2)
        self.sp = False  # pending space
        self.started = False
        self.glue = False  # right after a footnote label: the next break becomes a space

    def _flush(self) -> None:
        if self.started:
            if self.nl:
                sep = "\n" * self.nl
            elif self.sp:
                sep = " "
            else:
                sep = ""
            if sep:
                self.parts.append(sep)
                self.n += len(sep)
        self.nl = 0
        self.sp = False

    def word_run(self, core: str) -> int:
        """Append a non-empty run that has no leading/trailing whitespace; returns its start offset."""
        self._flush()
        start = self.n
        self.parts.append(core)
        self.n += len(core)
        self.started = True
        self.glue = False
        return start

    def text(self, t: str) -> int | None:
        """Append flowing text (whitespace collapsed). Returns the offset of the first appended character or None."""
        core = WS_RUN.sub(" ", t)
        if core[:1] == " ":
            self.sp = True
            core = core[1:]
        trail = core[-1:] == " "
        if trail:
            core = core[:-1]
        start = None
        if core:
            start = self.word_run(core)
        if trail:
            self.sp = True
        return start

    def pre(self, t: str) -> int | None:
        """Append preformatted text: line breaks kept, horizontal whitespace collapsed, lines stripped."""
        t = t.replace("\r\n", "\n").replace("\r", "\n")
        start = None
        for i, line in enumerate(t.split("\n")):
            if i:
                self.br()
                self.sp = False
            core = HWS_RUN.sub(" ", line)
            if core[:1] == " ":
                self.sp = True
                core = core[1:]
            trail = core[-1:] == " "
            if trail:
                core = core[:-1]
            if core:
                s = self.word_run(core)
                if start is None:
                    start = s
            if trail:
                self.sp = True
        return start

    def br(self) -> None:
        if self.glue:
            self.sp = True
            return
        self.nl = min(self.nl + 1, 2)

    def line(self) -> None:
        if self.glue:
            self.sp = True
            return
        self.nl = max(self.nl, 1)

    def block(self) -> None:
        if self.glue:
            self.sp = True
            return
        self.nl = 2

    def space(self) -> None:
        self.sp = True

    def value(self) -> str:
        return "".join(self.parts)


class Rendered:
    __slots__ = ("text", "citations", "pages", "stats")

    def __init__(self, text: str, citations: list[dict], pages: list[dict], stats: dict):
        self.text = text
        self.citations = citations
        self.pages = pages
        self.stats = stats


def _page_attrs(attrs: str) -> tuple[str, int | None]:
    at = attrs_of(attrs)
    idx = at.get("citation-index", "").strip()
    return at.get("label", "").strip(), int(idx) if idx.isdigit() else None


def render(markup: str) -> Rendered:
    out = _Out()
    stats: dict = {"tags": 0, "unknown_tags": {}, "skipped_comments": 0, "skipped_script_style": 0, "no_link_citations": 0, "img": 0, "stray_lt": 0}
    unknown = stats["unknown_tags"]
    cites: list[dict] = []
    pages: list[dict] = []
    # open captures: {"kind": "cite"|"page", "start": offset of first text or None, "depth": span depth or None, ...}
    waiting: list[dict] = []  # captures whose first character has not been emitted yet
    open_spans: list[dict] = []  # captures closed by a </span> at their recorded depth
    open_pagenum: list[dict] = []  # Harvard <page-number> captures
    span_depth = 0
    pre_stack: list[bool] = []  # one entry per open <pre>: True when class="inline"
    pre_depth = 0
    pos = 0
    n = len(markup)
    find = markup.find

    def started(s: int | None) -> None:
        if s is not None and waiting:
            for c in waiting:
                c["start"] = s
            waiting.clear()

    def close_capture(c: dict) -> None:
        if c in waiting:
            waiting.remove(c)
        if c["kind"] == "cite":
            if c["start"] is not None and out.n > c["start"]:
                cites.append({"opinion_id": c["opinion_id"], "cluster_id": c["cluster_id"], "start": c["start"], "end": out.n})
        else:
            # a page break is at its marker text (e.g. "*232"); an empty marker sits where the next text will start
            s = c["start"]
            pages.append({"page": c["label"], "citation_index": c["index"], "offset": s if s is not None else out.n,
                          "marker_end": out.n if s is not None else None})

    while pos < n:
        lt = find("<", pos)
        if lt < 0:
            lt = n
        if lt > pos:
            seg = markup[pos:lt]
            if "&" in seg:
                seg = html.unescape(seg)
            started(out.pre(seg) if pre_depth else out.text(seg))
        if lt >= n:
            break
        m = TOKEN.match(markup, lt)
        if m is None:
            # a '<' that starts no markup is text
            stats["stray_lt"] += 1
            started(out.pre("<") if pre_depth else out.text("<"))
            pos = lt + 1
            continue
        pos = m.end()
        name = m.group("name")
        if name is None:
            cdata = m.group("cdata")
            if cdata is not None:
                started(out.pre(cdata) if pre_depth else out.text(cdata))
            elif markup.startswith("<!--", lt):
                stats["skipped_comments"] += 1
            continue
        stats["tags"] += 1
        tag = name.lower()
        closing = bool(m.group("close"))
        if tag in SKIP_CONTENT and not closing:
            end = re.compile(r"</" + tag + r"\s*>", re.I).search(markup, pos)
            pos = end.end() if end else n
            stats["skipped_script_style"] += 1
            continue
        if tag == "span":
            if closing:
                if open_spans and open_spans[-1]["depth"] == span_depth:
                    close_capture(open_spans.pop())
                span_depth = max(span_depth - 1, 0)
            else:
                span_depth += 1
                a = m.group("attrs")
                if "citation" in a or "pagination" in a:
                    at = attrs_of(a)
                    classes = at.get("class", "").split()
                    if "citation" in classes:
                        did = at.get("data-id", "")
                        if did.isdigit() and "no-link" not in classes:
                            c = {"kind": "cite", "opinion_id": int(did), "cluster_id": None, "start": None, "depth": span_depth}
                            open_spans.append(c)
                            waiting.append(c)
                        else:
                            stats["no_link_citations"] += 1
                    elif "star-pagination" in classes:
                        label, idx = _page_attrs(a)
                        c = {"kind": "page", "label": label, "index": idx, "start": None, "depth": span_depth}
                        open_spans.append(c)
                        waiting.append(c)
            continue
        if tag == "page-number":
            if closing:
                if open_pagenum:
                    close_capture(open_pagenum.pop())
            else:
                label, idx = _page_attrs(m.group("attrs"))
                c = {"kind": "page", "label": label, "index": idx, "start": None, "depth": None}
                open_pagenum.append(c)
                waiting.append(c)
            continue
        if tag == "a":
            if not closing:
                cite = next((c for c in reversed(open_spans) if c["kind"] == "cite"), None)
                if cite is not None and cite["cluster_id"] is None:
                    hm = OPINION_HREF.match(attrs_of(m.group("attrs")).get("href", ""))
                    if hm:
                        cite["cluster_id"] = int(hm.group(1))
            continue
        if tag == "br":
            out.br()
            continue
        if tag == "pre":
            if closing:
                inline = pre_stack.pop() if pre_stack else False
            else:
                inline = "inline" in attrs_of(m.group("attrs")).get("class", "").split()
                pre_stack.append(inline)
            pre_depth = len(pre_stack)
            if not inline:
                out.block()
            continue
        if tag in ("td", "th"):
            out.space()
            continue
        if tag == "tr":
            out.line()
            continue
        if tag in BLOCK:
            out.block()
            if tag == "footnote" and not closing:
                label = attrs_of(m.group("attrs")).get("label", "").strip()
                if label:
                    started(out.text(label))
                    out.space()
                    out.glue = True
            continue
        if tag in INLINE:
            if tag == "img":
                stats["img"] += 1
            continue
        unknown[tag] = unknown.get(tag, 0) + 1
    # captures left open at the end of the markup still cover the text they wrapped
    while open_spans:
        close_capture(open_spans.pop())
    while open_pagenum:
        close_capture(open_pagenum.pop())
    cites.sort(key=lambda c: (c["start"], c["end"]))
    pages.sort(key=lambda p: p["offset"])
    return Rendered(out.value(), cites, pages, stats)


def render_field(field: str, value: str) -> Rendered:
    """plain_text is kept exactly as stored; every other field is markup."""
    if field == "plain_text":
        return Rendered(value, [], [], {})
    return render(value)


# ------------------------------------------------------------------------------------------------ star pagination
HARVARD_PAGE = re.compile(r"<page-number\b([^>]*)>", re.I)


def harvard_page_labels(xml: str) -> list[tuple[str, int | None]]:
    """(label, citation-index) of every <page-number> marker in xml_harvard, in document order (cheap regex scan)."""
    return [_page_attrs(m.group(1)) for m in HARVARD_PAGE.finditer(xml)]


def _content_index(text: str, markers: list[dict]) -> tuple[str, list[int]]:
    """Text with the marker spans and all whitespace removed, plus the text offset of each kept character."""
    keep: list[str] = []
    offs: list[int] = []
    spans = sorted((p["offset"], p["marker_end"]) for p in markers if p.get("marker_end") is not None)
    pos = 0
    for a, b in spans + [(len(text), len(text))]:
        if a < pos:
            a = pos
        for m in re.finditer(r"\S+", text[pos:a]):
            keep.append(m.group(0))
            base = pos + m.start()
            offs.extend(range(base, base + len(m.group(0))))
        pos = max(pos, b)
    return "".join(keep), offs


def paginate(chosen_field: str, chosen: Rendered, xml_harvard: str | None) -> dict:
    """Reporter page breaks for an opinion, from xml_harvard when it has any.

    Returns {"pages_source": ..., "pages": [...], "text_paginated": str | None}:
      chosen_markup     the chosen field carries the same page markers as xml_harvard, in the same order; offsets point
                        at the marker text (e.g. "*232") in `text`
      aligned           xml_harvard's markers placed in `text`: both texts are identical once marker text and whitespace
                        are removed, so each break goes before the same character; offset = start of the next page's text
      xml_harvard_text  no exact alignment: offsets point into `text_paginated`, xml_harvard's own rendering
      no_markers        xml_harvard has no page markers
      None              the opinion has no xml_harvard
    """
    if not xml_harvard:
        return {"pages_source": None, "pages": [], "text_paginated": None}
    labels = harvard_page_labels(xml_harvard)
    if not labels:
        return {"pages_source": "no_markers", "pages": [], "text_paginated": None}
    if chosen_field != "plain_text" and [(p["page"], p["citation_index"]) for p in chosen.pages] == labels:
        return {"pages_source": "chosen_markup", "pages": [_page_out(p) for p in chosen.pages], "text_paginated": None}
    rx = render(xml_harvard)
    xc, xo = _content_index(rx.text, rx.pages)
    cc, co = _content_index(chosen.text, chosen.pages)
    if xc == cc and [(p["page"], p["citation_index"]) for p in rx.pages] == labels:
        placed = []
        for p in rx.pages:
            # number of content characters of xml_harvard before this break -> same character in the chosen text
            k = _bisect(xo, p["offset"])
            off = co[k] if k < len(co) else len(chosen.text)
            placed.append({"page": p["page"], "citation_index": p["citation_index"], "offset": off})
        return {"pages_source": "aligned", "pages": placed, "text_paginated": None}
    return {"pages_source": "xml_harvard_text", "pages": [_page_out(p) for p in rx.pages], "text_paginated": rx.text}


def _page_out(p: dict) -> dict:
    return {"page": p["page"], "citation_index": p["citation_index"], "offset": p["offset"]}


def _bisect(a: list[int], x: int) -> int:
    lo, hi = 0, len(a)
    while lo < hi:
        mid = (lo + hi) // 2
        if a[mid] < x:
            lo = mid + 1
        else:
            hi = mid
    return lo
