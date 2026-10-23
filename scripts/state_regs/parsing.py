"""Parsing helpers shared by the state modules (lxml based; the exact-text check uses lib.html_text, a different parser)."""
from __future__ import annotations

import re
from urllib.parse import urljoin

import lxml.html

BLOCK = {"p", "div", "br", "li", "tr", "h1", "h2", "h3", "h4", "h5", "h6", "table", "section", "article", "ul", "ol", "dd",
         "dt", "blockquote", "pre", "hr", "td", "th", "center"}
SKIP = {"script", "style", "noscript", "template", "svg", "head"}


def doc(html: str | bytes, base_url: str | None = None):
    d = lxml.html.fromstring(html if isinstance(html, (bytes, str)) else str(html))
    if base_url:
        d.make_links_absolute(base_url, resolve_base_href=True)
    return d


def text(el, *, skip_classes: tuple[str, ...] = ()) -> str:
    """Element text with a line break at every block boundary; lines whitespace-collapsed, empty lines dropped."""
    out: list[str] = []

    def walk(e):
        tag = e.tag if isinstance(e.tag, str) else ""
        if tag in SKIP:
            if e.tail:
                out.append(_flat(e.tail))
            return
        cls = e.get("class") or ""
        if skip_classes and any(c in cls.split() for c in skip_classes):
            if e.tail:
                out.append(_flat(e.tail))
            return
        block = tag in BLOCK
        if block:
            out.append("\n")
        if e.text and tag:
            out.append(_flat(e.text))
        for c in e:
            walk(c)
        if block:
            out.append("\n")
        if e.tail:
            out.append(_flat(e.tail))

    walk(el)
    # the root's own tail is outside the element
    if el.tail and out and out[-1] == _flat(el.tail):
        out.pop()
    lines = [" ".join(line.replace("\xa0", " ").split()) for line in "".join(out).split("\n")]
    return "\n".join(line for line in lines if line)


def _flat(s: str) -> str:
    """Source line breaks inside running text are layout, not structure (a block boundary makes a line)."""
    return s.replace("\r", " ").replace("\n", " ")


def one_line(s: str | None) -> str | None:
    if s is None:
        return None
    s = " ".join(s.replace("\xa0", " ").split())
    return s or None


def links(d, pattern: str):
    """[(absolute href, link text)] of <a> elements whose href matches pattern, in page order, de-duplicated."""
    rx = re.compile(pattern)
    seen = set()
    out = []
    for a in d.iter("a"):
        h = a.get("href")
        if not h or not rx.search(h):
            continue
        if h in seen:
            continue
        seen.add(h)
        out.append((h, one_line(a.text_content()) or ""))
    return out


def absolute(base: str, href: str) -> str:
    return urljoin(base, href)
