"""Shared library for the in-force state-law layer (state-law/1). Contract: scripts/state_law/MODEL.md.

Stable API (STAT-A owns it; STAT-B imports it): StateMeta, Code, Pattern, RunContext, Fetched, Fetcher, Blocked,
html_text, norm_ws, norm_number, norm_cite, classify_status, render_text, node_id, section_id, template_regex,
apply_patterns, iter_zip_members. Standard library only, plus lxml/certifi when importable (both are on this machine).

Politeness: one request at a time per host, interval = max(state min_interval_s, robots Crawl-delay); robots.txt is
read once per host and obeyed; 403/401 and browser checks stop the run (Blocked) instead of being retried.
"""
from __future__ import annotations

import contextlib
import dataclasses
import datetime as _dt
import gzip
import hashlib
import html as _html
import io
import json
import os
import pathlib
import re
import ssl
import struct
import subprocess
import tempfile
import time
import unicodedata
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
import zlib
from typing import Any, Callable, Iterable, Iterator

LIB_VERSION = "state-law-lib/1"
SECTION_SCHEMA = "state-law-section/1"
NODE_SCHEMA = "state-law-node/1"
EDITION_SCHEMA = "state-law-edition/1"
SOURCE_SCHEMA = "state-law-source/1"
USER_AGENT = "LegalSourceAtlas research contact@legal-source-atlas.example"

STATUSES = (
    "in_force",
    "repealed",
    "reserved",
    "expired",
    "renumbered",
    "transferred",
    "future_effective",
    "not_recorded",
)
STATUS_BASES = ("publisher_marker", "current_compilation", "not_recorded")
LEVELS = (
    "code",
    "title",
    "subtitle",
    "division",
    "subdivision",
    "part",
    "subpart",
    "chapter",
    "subchapter",
    "article",
    "subarticle",
    "act",
    "appendix",
    "other",
)
METHODS = ("publisher_page", "publisher_bulk", "publisher_api", "retained_original")
ACCESS = ("html", "bulk", "api", "pdf", "mixed", "blocked")

STATE_RE = re.compile(r"^[A-Z]{2}$")
CODE_RE = re.compile(r"^[A-Z0-9]{1,12}$")
PARSER_RE = re.compile(r"^[a-z]{2}-[a-z0-9-]{2,60}/[1-9][0-9]{0,3}$")
CERT_DIR = pathlib.Path(__file__).resolve().parent / "certs"

_DASHES = dict.fromkeys(map(ord, "‐‑‒–—―−﹘﹣－"), "-")


class Blocked(RuntimeError):
    """The publisher refused (robots.txt, 401/403, browser check) — record it; never bypass."""


class ModelError(ValueError):
    """A record violates state-law/1."""


# ---------------------------------------------------------------------------------------------------------------
# Text helpers
# ---------------------------------------------------------------------------------------------------------------


def norm_ws(value: str | None) -> str:
    """Collapse whitespace (incl. NBSP, zero-width) to single spaces and strip."""
    if not value:
        return ""
    value = value.replace(" ", " ").replace("​", "").replace("﻿", "")
    return re.sub(r"\s+", " ", value).strip()


def norm_lines(value: str | None) -> str:
    """Normalise each line with norm_ws, drop empty lines, join with \\n."""
    if not value:
        return ""
    lines = (norm_ws(line) for line in value.replace("\r\n", "\n").replace("\r", "\n").split("\n"))
    return "\n".join(line for line in lines if line)


_BLOCK_TAGS = {
    "p", "div", "br", "li", "ul", "ol", "tr", "table", "tbody", "thead", "h1", "h2", "h3", "h4", "h5", "h6",
    "blockquote", "pre", "section", "article", "dd", "dt", "dl", "hr", "center", "title", "header", "footer",
    "td", "th", "caption", "body", "html", "form", "nav", "main", "aside",
}
_DROP_TAGS = {"script", "style", "noscript", "head", "template", "svg", "iframe", "object"}


def _is_class(el: Any, name: str) -> bool:
    if not isinstance(el.tag, str):
        return False
    return el.tag.lower() == name or name in (el.get("class") or "").lower().split()


def html_text(fragment: str | bytes | None, *, encoding: str | None = None, drop_tags: Iterable[str] = ()) -> str:
    """Render an HTML fragment/document to plain text: block elements (and <br>) become line breaks, raw newlines
    inside text are ordinary whitespace (except inside <pre>), entities are decoded, markup never survives.
    Returns norm_lines() output."""
    if fragment is None:
        return ""
    if isinstance(fragment, bytes):
        fragment = decode_bytes(fragment, encoding)
    if not fragment.strip():
        return ""
    drop = set(_DROP_TAGS) | {t.lower() for t in drop_tags}
    from lxml import html as lxml_html  # type: ignore

    head = fragment[:3000].lower()
    root = lxml_html.document_fromstring(fragment) if ("<html" in head or "<body" in head) else lxml_html.fragment_fromstring(fragment, create_parent="div")
    out: list[str] = []
    BR = "\x1e"

    def flat(text: str | None, pre: bool) -> str:
        if not text:
            return ""
        return text.replace("\r", "").replace("\n", BR) if pre else text.replace("\r", " ").replace("\n", " ")

    def walk(el: Any, pre: bool) -> None:
        if not isinstance(el.tag, str):  # comments / processing instructions
            out.append(flat(el.tail, pre))
            return
        tag = el.tag.lower()
        if tag in drop:
            out.append(flat(el.tail, pre))
            return
        inner_pre = pre or tag == "pre"
        block = tag in _BLOCK_TAGS
        if block:
            out.append(BR)
        if tag in ("td", "th"):
            out.append(" ")
        out.append(flat(el.text, inner_pre))
        previous = None
        for child in el:
            if previous is not None and _is_class(child, "denominator") and _is_class(previous, "numerator"):
                out.append("/")
            walk(child, inner_pre)
            previous = child
        if block:
            out.append(BR)
        out.append(flat(el.tail, pre))

    walk(root, False)
    return norm_lines("".join(out).replace(BR, "\n"))


# Labels a browser decodes as windows-1252 (WHATWG Encoding Standard): pages labelled ISO-8859-1 routinely carry
# cp1252 dashes and quotes (0x96, 0x97, 0x93 …), which a strict latin-1 decode turns into C1 control characters.
_WINDOWS_1252_LABELS = {"iso-8859-1", "iso8859-1", "latin1", "latin-1", "l1", "us-ascii", "ascii", "iso_8859-1",
                        "cp819", "ibm819", "windows-1252", "cp1252", "x-cp1252"}


def _codec(label: str) -> str:
    return "cp1252" if label.strip().lower() in _WINDOWS_1252_LABELS else label


def decode_bytes(body: bytes, encoding: str | None = None) -> str:
    """Decode publisher bytes: declared encoding, then BOM/meta charset, then utf-8, then cp1252. Latin-1/ASCII labels
    decode as windows-1252, as browsers do."""
    if encoding:
        try:
            return body.decode(_codec(encoding))
        except (LookupError, UnicodeDecodeError):
            pass
    if body.startswith(b"\xef\xbb\xbf"):
        return body[3:].decode("utf-8", errors="replace")
    if body.startswith((b"\xff\xfe", b"\xfe\xff")):
        return body.decode("utf-16", errors="replace")
    head = body[:4096].lower()
    match = re.search(rb"charset=[\"']?([a-z0-9_\-]+)", head) or re.search(rb"encoding=[\"']([a-z0-9_\-]+)", head)
    if match and not match.group(1).lower().startswith(b"utf-16"):  # a utf-16 label on 8-bit bytes is a page error
        try:
            return body.decode(_codec(match.group(1).decode("ascii")))
        except (LookupError, UnicodeDecodeError):
            pass
    try:
        return body.decode("utf-8")
    except UnicodeDecodeError:
        return body.decode("cp1252", errors="replace")


# inline XML elements (no line break around them) and namespaces whose elements are instructions, not text
XML_INLINE = frozenset({"cite", "em", "strong", "u", "i", "b", "span", "sup", "sub", "a", "small", "term", "def"})
XML_SKIP_NS = frozenset({"https://code.dccouncil.us/schemas/codify"})


def xml_local(el) -> tuple[str, str]:
    """(namespace, local name) of an ElementTree/lxml element tag ("" for comments and processing instructions)."""
    tag = el.tag if isinstance(el.tag, str) else ""
    if tag.startswith("{"):
        ns, _, name = tag[1:].partition("}")
        return ns, name
    return "", tag


def xml_text(body: bytes | str) -> str:
    """Plain-text rendering of an XML document: block element boundaries are line breaks, inline elements
    (XML_INLINE) continue the line, <br/> breaks it, raw newlines inside text are ordinary whitespace, and elements in
    XML_SKIP_NS (codification instructions) are left out."""
    from xml.etree import ElementTree as ET

    if isinstance(body, str):
        body = body.encode("utf-8")
    root = ET.fromstring(body)
    out: list[str] = []
    BR = "\x1e"

    def walk(el: ET.Element) -> None:
        ns, name = xml_local(el)
        if ns in XML_SKIP_NS:
            pass
        elif name == "br":
            out.append(BR)
        else:
            inline = name in XML_INLINE
            if not inline:
                out.append(BR)
            if el.text:
                out.append(el.text.replace("\n", " "))
            for child in el:
                walk(child)
            if not inline:
                out.append(BR)
        if el.tail:
            out.append(el.tail.replace("\n", " "))

    walk(root)
    return norm_lines(_html.unescape("".join(out)).replace(BR, "\n"))


def pdf_layout_lines(body: bytes) -> list[str]:
    """pdftotext -layout lines (indentation kept, form feeds dropped): the reading order that keeps a hanging-indent
    subsection label on the same line as its text."""
    with tempfile.NamedTemporaryFile(suffix=".pdf") as handle:
        handle.write(body)
        handle.flush()
        done = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", handle.name, "-"], capture_output=True, check=True)
    return [line.rstrip() for line in done.stdout.decode("utf-8", errors="replace").replace("\f", "\n").split("\n")]


def pdf_text(body: bytes) -> str:
    """Canonical PDF rendering: pdftotext -layout, each line whitespace-normalised."""
    return norm_lines("\n".join(pdf_layout_lines(body)))


def json_text(body: bytes | str) -> str:
    """Rendering of a JSON document: every string value (HTML rendered) on its own line, document order."""
    data = json.loads(body if isinstance(body, str) else decode_bytes(body, "utf-8"))
    out: list[str] = []

    def walk(value: Any) -> None:
        if isinstance(value, str):
            out.append(html_text(value) if "<" in value and ">" in value else norm_lines(_html.unescape(value)))
        elif isinstance(value, dict):
            for item in value.values():
                walk(item)
        elif isinstance(value, list):
            for item in value:
                walk(item)

    walk(data)
    return "\n".join(part for part in out if part)


CAML_NS = "http://lc.ca.gov/legalservices/schemas/caml.1#"
_CAML_SPACES = {"EnSpace": " ", "EmSpace": " ", "ThinSpace": " ", "NbSpace": " "}


def caml_text(body: bytes | str) -> str:
    """California Legislative Counsel CAML (`caml:Content`) rendering: paragraphs/headings/rows end lines, the
    publisher's empty spacing spans (EnSpace, EmSpace, ThinSpace, NbSpace) become a space, a Fraction prints as
    numerator/denominator, table cells are separated by a space."""
    from xml.etree import ElementTree as ET

    root = ET.fromstring(body if isinstance(body, bytes) else body.encode("utf-8"))
    out: list[str] = []

    def local(el: ET.Element) -> str:
        return el.tag.rsplit("}", 1)[-1] if isinstance(el.tag, str) else ""

    def walk(el: ET.Element) -> None:
        name = local(el)
        if name == "span" and el.get("class") in _CAML_SPACES and not len(el) and not (el.text or ""):
            out.append(_CAML_SPACES[el.get("class")])
        elif name == "br":
            out.append("\x1e")
        else:
            if el.text:
                out.append(el.text.replace("\n", " "))
            children = list(el)
            for index, child in enumerate(children):
                if name == "Fraction" and local(child) == "Denominator" and index > 0:
                    out.append("/")
                if name == "tr" and index > 0:
                    out.append(" ")
                walk(child)
                if child.tail:
                    out.append(child.tail.replace("\n", " "))
            if name in ("p", "h1", "h2", "h3", "tr", "table", "li", "div"):
                out.append("\x1e")

    walk(root)
    return norm_lines("".join(out).replace("\x1e", "\n"))


SLIM_NS = "urn:legix:slim"
XHTML_NS = "http://www.w3.org/1999/xhtml"
# empty <span class=…/> elements the Iowa Legislature's "slim" XML uses for characters and spacing
SLIM_CHARS = {"em-dash": "\u2014", "en-dash": "\u2013", "em-space": " ", "en-space": " ", "thin-space": " ",
              "dotLeader": " ____ ", "tabLeader": " ____ ", "single-solid-line": " ____ "}
SLIM_BREAKS = {"new-line", "blank-line"}
SLIM_SKIP = {"About", "TOC"}


def slim_inline(el, out: list[str]) -> None:
    """Inline rendering of an element of a slim document into `out` (\x1e marks a line break): character spans become
    their character, an identifier span is followed by a space, block children (div, p, Heading …) are surrounded by
    breaks."""
    ns, name = xml_local(el)
    cls = el.get("class") or ""
    if ns == SLIM_NS and name in SLIM_SKIP:
        if el.tail:
            out.append(el.tail.replace("\n", " "))
        return
    block = not (ns == XHTML_NS and name == "span")
    if name == "span" and cls in SLIM_CHARS and not len(el) and not el.text:
        out.append(SLIM_CHARS[cls])
    elif name == "span" and cls in SLIM_BREAKS and not len(el) and not el.text:
        out.append("\x1e")
    else:
        if block:
            out.append("\x1e")
        if el.text:
            out.append(el.text.replace("\n", " "))
        for child in el:
            slim_inline(child, out)
        if name == "span" and cls == "identifier":
            out.append(" ")
        if block:
            out.append("\x1e")
    if el.tail:
        out.append(el.tail.replace("\n", " "))


def slim_text(body: bytes | str) -> str:
    """Iowa Legislature slim XML (urn:legix:slim) rendering; see slim_inline."""
    from xml.etree import ElementTree as ET

    root = ET.fromstring(body if isinstance(body, bytes) else body.encode("utf-8"))
    out: list[str] = []
    slim_inline(root, out)
    return norm_lines("".join(out).replace("\x1e", "\n"))


def render_text(body: bytes, content_type: str | None = None, url: str | None = None) -> str:
    """The `.txt` rendering every stored quote is checked against (AGENTS.md capture rule)."""
    kind = (content_type or "").lower()
    path = (urllib.parse.urlparse(url).path.lower() if url else "")
    head = body.lstrip()[:400]
    if b"caml:Content" in head or CAML_NS.encode() in head:
        return caml_text(body)
    if SLIM_NS.encode() in head:
        return slim_text(body)
    if kind.startswith("text/plain") or kind.startswith("text/tab-separated") or path.endswith((".dat", ".txt", ".tsv")):
        return norm_lines(decode_bytes(body, "utf-8"))
    if "pdf" in kind or path.endswith(".pdf") or body[:5] == b"%PDF-":
        return pdf_text(body)
    if "json" in kind or path.endswith(".json"):
        return json_text(body)
    stripped = body.lstrip()[:200].lower()
    if ("xml" in kind and "html" not in kind) or path.endswith(".xml") or (
        stripped.startswith(b"<?xml") and b"<html" not in body[:2000].lower()
    ):
        try:
            return xml_text(body)
        except Exception:  # noqa: BLE001 - fall back to HTML rendering for malformed XML
            pass
    return html_text(body)


def check_quote(rendered_norm: str, quote: str | None) -> bool:
    """True when every line of `quote` occurs verbatim (whitespace-normalised) in the rendering."""
    if not quote:
        return True
    return all(norm_ws(line) in rendered_norm for line in quote.split("\n") if norm_ws(line))


# ---------------------------------------------------------------------------------------------------------------
# Numbers, citations, ids
# ---------------------------------------------------------------------------------------------------------------


def norm_number(value: str) -> str:
    """Section designation normaliser — mirrored exactly by state_law.norm_number_v1 in SQL."""
    value = unicodedata.normalize("NFKC", value or "").translate(_DASHES).lower().strip()
    value = re.sub(r"^(?:§+|sec(?:tion)?s?\.?)\s*", "", value)
    value = re.sub(r"\s+", "", value)
    return value.rstrip(".")


_UNIT_WORD_RE = r"[\s,]*(?:subds?\.|subdivisions?|subsecs?\.|subsections?|paras?\.|paragraphs?|cls?\.|clauses?)$"
_PINPOINT_RE = re.compile(r"((?:\s*\((?:[0-9]{1,4}|[a-z]{1,4}|[ivxlc]{1,8})\))+)\s*$")


def norm_cite(value: str) -> tuple[str, str | None]:
    """Citation normaliser — mirrored by state_law.norm_cite_v1. Returns (normalized, pinpoint or None)."""
    value = unicodedata.normalize("NFKC", value or "").translate(_DASHES).lower()
    value = value.replace("§§", "§")
    value = re.sub(r"\bet\.?\s+seq\.?", " ", value)
    value = re.sub(r"\b(?:sections|section|secs\.|sec\.|ss\.)\s*(?=[0-9])", "§ ", value)
    value = re.sub(r"§\s*", "§ ", value)
    value = re.sub(r"\s+", " ", value).strip()
    value = re.sub(r"[\s,;.]+$", "", value)
    pinpoint = None
    match = _PINPOINT_RE.search(value)
    if match and match.start() > 0:
        pinpoint = re.sub(r"\s+", "", match.group(1))
        value = value[: match.start()].rstrip()
    value = re.sub(_UNIT_WORD_RE, "", value)
    return value, pinpoint


def _escape_id(value: str) -> str:
    return value.replace("%", "%25").replace("/", "%2F").replace(":", "%3A").replace(" ", "%20")


def _slug(value: str | None) -> str:
    return re.sub(r"[^a-z0-9]+", "-", unicodedata.normalize("NFKD", value or "").encode("ascii", "ignore").decode().lower()).strip("-")[:48]


def node_id(state: str, code: str, steps: Iterable[tuple]) -> str:
    """`FL:FS/title:VIII/chapter:95`. Steps are (level, number) or (level, number, heading); an unnumbered step
    gets `~<heading-slug>` (or `~<position>` without a heading)."""
    out = f"{state}:{code}"
    for index, step in enumerate(steps):
        level, number = step[0], step[1]
        heading = step[2] if len(step) > 2 else None
        if level not in LEVELS or level == "code":
            raise ModelError(f"unknown hierarchy level {level!r}")
        if number not in (None, ""):
            token = _escape_id(norm_ws(number))
        else:
            token = "~" + (_slug(heading) or str(index))
        out += f"/{level}:{token}"
    return out


def section_id(state: str, code: str, number: str, version_index: int | None = None) -> str:
    compact = re.sub(r"\s+", "", number)
    if not compact or "@" in compact:
        raise ModelError(f"bad section number {number!r}")
    sid = f"{state}:{code}:{compact}"
    if version_index is not None:
        sid += f"@{int(version_index)}"
    if len(sid) > 300:
        raise ModelError(f"section id too long: {sid[:80]}…")
    return sid


def format_citation(template: str, number: str) -> str:
    head, sep, tail = number.partition(":")
    return template.replace("{n}", number).replace("{t}", head if sep else "").replace("{s}", tail if sep else number)


_NUM_CAPTURE = r"([0-9][0-9a-z.:/\-]*)"


def template_regex(template: str) -> tuple[str, str]:
    """Regex (common subset of Python re and PostgreSQL ARE) matching the normalised canonical citation produced by
    `template`, plus its replacement. Templates with {t}/{s} capture both parts and rebuild `t:s`."""
    normalized, _ = norm_cite(template.replace("{n}", "\x00n").replace("{t}", "\x00t").replace("{s}", "\x00s"))
    parts = re.split(r"(\x00[nts])", normalized)
    regex = ""
    order: list[str] = []
    for part in parts:
        if part in ("\x00n", "\x00t", "\x00s"):
            regex += _NUM_CAPTURE if part != "\x00t" else r"([0-9a-z][0-9a-z.\-]*)"
            order.append(part[1].upper())
        else:
            regex += "".join(("\\s?" if ch == " " else re.escape(ch)) for ch in part)
    if order == ["N"]:
        return regex, r"\1"
    if sorted(order) == ["S", "T"]:
        t = order.index("T") + 1
        s = order.index("S") + 1
        return regex, f"\\{t}:\\{s}"
    raise ModelError(f"citation template needs {{n}} or {{t}}+{{s}}: {template!r}")


@dataclasses.dataclass(frozen=True)
class Pattern:
    regex: str  # full-match regex over norm_cite() output; common subset of Python re and PostgreSQL ARE
    number: str  # replacement producing the section number (\\1, \\2 …)


@dataclasses.dataclass(frozen=True)
class Code:
    code: str
    name: str
    citation_template: str
    patterns: tuple = ()

    def all_patterns(self) -> list[Pattern]:
        out = [p if isinstance(p, Pattern) else Pattern(*p) for p in self.patterns]
        regex, number = template_regex(self.citation_template)
        if all(p.regex != regex for p in out):
            out.append(Pattern(regex, number))
        return out


def apply_patterns(codes: Iterable[Code], citation: str) -> list[tuple[str, str]]:
    """Python mirror of the SQL resolver's parsing step: every (code, number_norm) the citation parses to, in
    pattern order (codes in declaration order). No fuzzy matching."""
    normalized, _ = norm_cite(citation)
    hits: list[tuple[str, str]] = []
    for code in codes:
        for pattern in code.all_patterns():
            match = re.fullmatch(pattern.regex, normalized)
            if match:
                hit = (code.code, norm_number(match.expand(pattern.number)))
                if hit not in hits:
                    hits.append(hit)
    return hits


def alias_patterns(aliases: Iterable[str], *, prefix: str | None = None, number: str = _NUM_CAPTURE) -> tuple[Pattern, ...]:
    """One Pattern matching `<optional prefix><alias> [§] <number>` for every alias (written as people cite it,
    e.g. "Code Civ. Proc.", "Civ. Proc. Code"). Aliases are normalised like citations and regex-escaped; spaces are
    optional. `prefix` is a regex (common subset) such as r"(?:cal\\.?\\s?)?"."""
    alts = []
    for alias in aliases:
        normalized, _ = norm_cite(alias)
        escaped = "".join(("\\s?" if ch == " " else re.escape(ch)) for ch in normalized.rstrip("."))
        alts.append(escaped + r"\.?")
    alts = sorted(set(alts), key=lambda a: (-len(a), a))
    regex = (prefix or "") + "(?:" + "|".join(alts) + ")" + r"\s?,?\s?(?:§\s?)?" + number
    return (Pattern(regex, r"\1"),)


# A marker word counts only when the heading/short body *is* the marker: the word is followed by the end, punctuation,
# a number, or a word that introduces the marker's particulars ("Repealed by …", "Renumbered as …", "Expired July 1,
# 2020"). "Transferred employees; rights." or "Reserved powers." are ordinary catchlines, not markers.
_MARK_NEXT = (r"(?:\s*$|\s*[.,;:)\]\[(\u2014\u2013-]|\s+\d|\s+(?:by|as|to|from|under|eff\.?|effective|on|and|in|"
              r"pursuant|per|with|see|at|until|after|before|for\s+future|(?:acts?|laws?)(?=\s*(?:\d|of\b|,))|l\.|"
              r"sec\.?|section|pub\.?|stat\.?|ch\.?|chapter|art\.?|article|title|session|ord\.?|p\.\s?l\.|s\.\s?l\.|"
              r"january|february|march|april|may|june|july|august|september|october|november|december|jan\.|feb\.|"
              r"mar\.|apr\.|jun\.|jul\.|aug\.|sept?\.|oct\.|nov\.|dec\.)\b)")


def _marker(words: str, tail: int) -> re.Pattern[str]:
    return re.compile(rf"^\[?\(?\s*(?:{words})\b(?={_MARK_NEXT})[^\n]{{0,{tail}}}", re.I)


_STATUS_PATTERNS: tuple[tuple[str, re.Pattern[str]], ...] = (
    ("renumbered", _marker("renumbered|redesignated", 300)),
    ("transferred", _marker("transferred", 300)),
    ("repealed", _marker("repealed and reserved|repealed", 400)),
    ("reserved", _marker("reserved", 200)),
    ("expired", _marker("expired|terminated", 300)),
)


_TRAILING_MARK_RE = re.compile(r"\[\s*(Repealed|Reserved|Expired|Renumbered|Transferred|Redesignated)\b[^\]]{0,200}\]\.?\s*$", re.I)
_TRAILING_STATUS = {"repealed": "repealed", "reserved": "reserved", "expired": "expired", "renumbered": "renumbered",
                    "transferred": "transferred", "redesignated": "renumbered"}


def classify_status(heading: str | None, text: str | None) -> tuple[str | None, str | None]:
    """Shared publisher-marker detector: a heading that *is* a marker (`Repealed.`, `[Reserved]`, `Renumbered as …`)
    or a short body that is only a marker. Returns (status, verbatim marker) or (None, None). States add their own
    markers; this never infers a status from ordinary operative text."""
    for candidate in (norm_ws(heading), norm_ws(text) if text and len(text) <= 600 else ""):
        if not candidate:
            continue
        for status, pattern in _STATUS_PATTERNS:
            match = pattern.match(candidate)
            if match:
                return status, match.group(0).strip()
    trailing = _TRAILING_MARK_RE.search(norm_ws(heading))
    if trailing:
        return _TRAILING_STATUS[trailing.group(1).lower()], trailing.group(0).strip()
    return None, None


# ---------------------------------------------------------------------------------------------------------------
# Network
# ---------------------------------------------------------------------------------------------------------------


@dataclasses.dataclass
class Fetched:
    url: str
    final_url: str
    status: int
    headers: dict
    body: bytes
    sha256: str
    bytes: int
    retrieved_at: str
    method: str = "publisher_page"
    member: str | None = None

    @property
    def content_type(self) -> str:
        return self.headers.get("content-type", "")

    def text(self, encoding: str | None = None) -> str:
        charset = None
        match = re.search(r"charset=([\w\-]+)", self.content_type)
        if match:
            charset = match.group(1)
        return decode_bytes(self.body, encoding or charset)

    def source(self) -> dict:
        return {
            "url": self.final_url or self.url,
            "retrieved_at": self.retrieved_at,
            "sha256": self.sha256,
            "bytes": self.bytes,
            "method": self.method,
            "member": self.member,
        }


def safe_url(url: str) -> str:
    """Percent-encode characters a publisher leaves raw in its links (spaces, non-ASCII); idempotent."""
    return urllib.parse.quote(url, safe=":/?&=%#+,;@!$'()*~[]")


def utcnow() -> str:
    return _dt.datetime.now(_dt.timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def ssl_context() -> ssl.SSLContext:
    """Verification always on: certifi roots + system roots + public intermediates committed under certs/ (for
    publishers that omit their intermediate, e.g. www.cga.ct.gov, www.ilga.gov)."""
    try:
        import certifi  # type: ignore

        ctx = ssl.create_default_context(cafile=certifi.where())
    except ImportError:  # pragma: no cover
        ctx = ssl.create_default_context()
    with contextlib.suppress(Exception):
        ctx.load_default_certs()
    ccr = pathlib.Path("/root/.ccr/ca-bundle.crt")
    if ccr.exists():
        ctx.load_verify_locations(cafile=str(ccr))
    for pem in sorted(CERT_DIR.glob("*.pem")):
        ctx.load_verify_locations(cafile=str(pem))
    return ctx


class Fetcher:
    """Polite sequential fetcher: robots.txt per host, crawl-delay, retries for transient errors only."""

    def __init__(self, *, min_interval_s: float = 1.0, user_agent: str = USER_AGENT, timeout: float = 90.0,
                 max_bytes: int = 256 * 1024 * 1024, respect_robots: bool = True, log: Callable[[str], None] | None = None):
        self.min_interval_s = float(min_interval_s)
        self.user_agent = user_agent
        self.timeout = timeout
        self.max_bytes = max_bytes
        self.respect_robots = respect_robots
        self.log = log or (lambda msg: None)
        self._robots: dict[str, tuple[urllib.robotparser.RobotFileParser | None, float, str]] = {}
        self._last: dict[str, float] = {}
        self._ctx = ssl_context()
        self._opener = urllib.request.build_opener(urllib.request.HTTPSHandler(context=self._ctx))
        self.requests = 0

    # robots -----------------------------------------------------------------------------------------------
    def robots(self, url: str) -> tuple[urllib.robotparser.RobotFileParser | None, float, str]:
        parts = urllib.parse.urlsplit(url)
        host = parts.netloc.lower()
        if host in self._robots:
            return self._robots[host]
        robots_url = f"{parts.scheme}://{parts.netloc}/robots.txt"
        parser: urllib.robotparser.RobotFileParser | None = urllib.robotparser.RobotFileParser(robots_url)
        verdict = "allowed"
        try:
            status, _headers, body, _final = self._raw_get(robots_url, {}, None)
            self._last[host] = time.monotonic()  # the robots request counts toward the host's pacing
        except Exception as error:  # noqa: BLE001
            status, body = 0, b""
            verdict = f"unreachable ({type(error).__name__}: {error})"
        if status == 200 and not body.lstrip().lower().startswith((b"<!doctype", b"<html")):
            parser.parse(decode_bytes(body, "utf-8").splitlines())
            verdict = "parsed"
        elif status in (401, 403):
            parser.disallow_all = True
            verdict = f"robots.txt answered {status}: treated as disallow-all"
        elif 400 <= status < 500 or (status == 200):
            parser = None  # no robots file (or an HTML page in its place): no restrictions
            verdict = f"no robots.txt (HTTP {status})"
        else:
            parser.disallow_all = True
            verdict = f"robots.txt unavailable ({status or verdict}): treated as disallow-all"
        delay = 0.0
        if parser is not None and not parser.disallow_all:
            delay = float(parser.crawl_delay(self.user_agent) or parser.crawl_delay("*") or 0)
        self._robots[host] = (parser, delay, verdict)
        self.log(f"robots {host}: {verdict}; crawl-delay {delay or 0:g}s")
        return self._robots[host]

    def allowed(self, url: str) -> bool:
        if not self.respect_robots:
            return True
        parser, _delay, _ = self.robots(url)
        return True if parser is None else parser.can_fetch(self.user_agent, url)

    def interval(self, url: str) -> float:
        _parser, delay, _ = self.robots(url) if self.respect_robots else (None, 0.0, "")
        return max(self.min_interval_s, delay)

    # transport --------------------------------------------------------------------------------------------
    def _raw_get(self, url: str, headers: dict, data: bytes | None) -> tuple[int, dict, bytes, str]:
        request = urllib.request.Request(safe_url(url), data=data, headers={"User-Agent": self.user_agent, "Accept-Encoding": "gzip", **headers})
        try:
            with self._opener.open(request, timeout=self.timeout) as response:
                body = response.read(self.max_bytes + 1)
                status = response.status
                hdrs = {k.lower(): v for k, v in response.headers.items()}
                final = response.geturl()
        except urllib.error.HTTPError as error:
            body = error.read(1024 * 1024)
            status = error.code
            hdrs = {k.lower(): v for k, v in (error.headers or {}).items()}
            final = url
        if len(body) > self.max_bytes:
            raise RuntimeError(f"response over {self.max_bytes} bytes: {url} (use stream())")
        if hdrs.get("content-encoding", "").lower() == "gzip":
            body = gzip.decompress(body)
            hdrs.pop("content-encoding", None)
        return status, hdrs, body, final

    def _wait(self, url: str) -> None:
        host = urllib.parse.urlsplit(url).netloc.lower()
        gap = self.interval(url)
        last = self._last.get(host)
        if last is not None:
            sleep = gap - (time.monotonic() - last)
            if sleep > 0:
                time.sleep(sleep)
        self._last[host] = time.monotonic()

    def get(self, url: str, *, data: bytes | None = None, headers: dict | None = None, method: str = "publisher_page",
            accept_status: Iterable[int] = (200,)) -> Fetched:
        if not url.startswith("https://") and not url.startswith("http://"):
            raise ValueError(f"not an http(s) URL: {url}")
        if not self.allowed(url):
            raise Blocked(f"robots.txt disallows {url}")
        accept = set(accept_status)
        last_error: Exception | None = None
        for attempt in range(5):
            self._wait(url)
            retrieved_at = utcnow()
            try:
                status, hdrs, body, final = self._raw_get(url, headers or {}, data)
            except (urllib.error.URLError, TimeoutError, ConnectionError, OSError) as error:
                last_error = error
                self.log(f"retry {attempt + 1}/4 {url}: {type(error).__name__}: {error}")
                time.sleep(min(60, 2 ** (attempt + 1)))
                continue
            self.requests += 1
            if status in (401, 403):
                raise Blocked(f"HTTP {status} from {url} (not retried, not bypassed)")
            if status == 200 and _looks_like_browser_check(hdrs, body):
                raise Blocked(f"browser check served for {url} (not bypassed)")
            if status in (429, 500, 502, 503, 504) and attempt < 4:
                wait = _retry_after(hdrs) or min(120, 5 * 2 ** attempt)
                self.log(f"HTTP {status} {url}: waiting {wait:g}s")
                time.sleep(wait)
                continue
            if status not in accept:
                raise RuntimeError(f"HTTP {status} from {url}")
            return Fetched(url=url, final_url=final, status=status, headers=hdrs, body=body,
                           sha256=hashlib.sha256(body).hexdigest(), bytes=len(body), retrieved_at=retrieved_at,
                           method=method)
        raise RuntimeError(f"giving up on {url}: {last_error}")

    @contextlib.contextmanager
    def open_stream(self, url: str, *, headers: dict | None = None) -> Iterator[tuple[Any, dict, str]]:
        """Raw streaming response for bulk files (caller hashes); one attempt, robots + interval enforced."""
        if not self.allowed(url):
            raise Blocked(f"robots.txt disallows {url}")
        self._wait(url)
        request = urllib.request.Request(safe_url(url), headers={"User-Agent": self.user_agent, **(headers or {})})
        try:
            response = self._opener.open(request, timeout=self.timeout)
        except urllib.error.HTTPError as error:
            if error.code in (401, 403):
                raise Blocked(f"HTTP {error.code} from {url}") from None
            raise
        self.requests += 1
        try:
            yield response, {k.lower(): v for k, v in response.headers.items()}, utcnow()
        finally:
            response.close()


def _retry_after(headers: dict) -> float | None:
    value = headers.get("retry-after")
    if value and value.strip().isdigit():
        return min(300.0, float(value))
    return None


def _looks_like_browser_check(headers: dict, body: bytes) -> bool:
    if headers.get("cf-mitigated", "").lower() == "challenge":
        return True
    head = body[:6000].lower()
    return (b"just a moment" in head and b"cloudflare" in head) or b"cf-browser-verification" in head or (
        b"captcha" in head and b"<form" in head and len(body) < 20000
    )


class HashingReader(io.RawIOBase):
    """File-like wrapper hashing and counting every byte read (bulk streams are hashed without touching disk)."""

    def __init__(self, raw: Any):
        self.raw = raw
        self.hash = hashlib.sha256()
        self.count = 0

    def readable(self) -> bool:
        return True

    def readinto(self, buffer: Any) -> int:
        data = self.raw.read(len(buffer))
        if not data:
            return 0
        n = len(data)
        buffer[:n] = data
        self.hash.update(data)
        self.count += n
        return n

    def drain(self) -> None:
        while self.read(1 << 20):
            pass


def iter_zip_members(stream: Any, want: Callable[[str], bool] | None = None, *, max_member: int = 512 * 1024 * 1024
                     ) -> Iterator[tuple[str, bytes]]:
    """Sequentially read a ZIP from a non-seekable stream via local file headers (stored or deflate). Yields
    (name, uncompressed bytes) for wanted members; others are inflated to nowhere. Stops at the central directory.
    Every yielded member is verified against its CRC-32."""
    pending = bytearray()

    def take(n: int) -> bytes:
        out = bytearray()
        if pending:
            k = min(n, len(pending))
            out += pending[:k]
            del pending[:k]
        while len(out) < n:
            chunk = stream.read(n - len(out))
            if not chunk:
                raise EOFError("truncated zip stream")
            out += chunk
        return bytes(out)

    def some() -> bytes:
        if pending:
            out = bytes(pending)
            pending.clear()
            return out
        return stream.read(1 << 16)

    while True:
        try:
            sig = take(4)
        except EOFError:
            return
        if sig != b"PK\x03\x04":
            return  # central directory / end record
        (_ver, flags, method, _t, _d, crc, csize, usize, nlen, xlen) = struct.unpack("<HHHHHIIIHH", take(26))
        name = take(nlen).decode("utf-8" if flags & 0x800 else "cp437")
        extra = take(xlen)
        if csize == 0xFFFFFFFF or usize == 0xFFFFFFFF:
            pos = 0
            while pos + 4 <= len(extra):
                hid, hlen = struct.unpack("<HH", extra[pos:pos + 4])
                if hid == 1:
                    vals = extra[pos + 4: pos + 4 + hlen]
                    if usize == 0xFFFFFFFF:
                        usize, vals = struct.unpack("<Q", vals[:8])[0], vals[8:]
                    if csize == 0xFFFFFFFF:
                        csize = struct.unpack("<Q", vals[:8])[0]
                pos += 4 + hlen
        wanted = (want is None or want(name)) and not name.endswith("/")
        descriptor = bool(flags & 0x08)
        parts: list[bytes] = []
        size = 0
        if method == 0 and not descriptor:
            remaining = csize
            while remaining:
                chunk = take(min(remaining, 1 << 20))
                remaining -= len(chunk)
                if wanted:
                    parts.append(chunk)
            size = csize
        elif method == 8:
            inflater = zlib.decompressobj(-15)
            if not descriptor:
                remaining = csize
                while remaining:
                    chunk = take(min(remaining, 1 << 20))
                    remaining -= len(chunk)
                    piece = inflater.decompress(chunk)
                    size += len(piece)
                    if wanted:
                        parts.append(piece)
                piece = inflater.flush()
                size += len(piece)
                if wanted:
                    parts.append(piece)
            else:
                while not inflater.eof:
                    chunk = some()
                    if not chunk:
                        raise EOFError("truncated deflate member")
                    piece = inflater.decompress(chunk)
                    size += len(piece)
                    if wanted:
                        parts.append(piece)
                pending[:0] = inflater.unused_data
        else:
            raise RuntimeError(f"unsupported zip member (method {method}, descriptor {descriptor}): {name}")
        if size > max_member:
            raise RuntimeError(f"zip member over limit: {name}")
        if descriptor:
            head = take(4)
            if head == b"PK\x07\x08":
                crc = struct.unpack("<I", take(4))[0]
            else:
                crc = struct.unpack("<I", head)[0]
            take(8 if not (csize == 0xFFFFFFFF) else 16)
        if wanted:
            out = b"".join(parts)
            if zlib.crc32(out) & 0xFFFFFFFF != crc:
                raise RuntimeError(f"CRC mismatch in zip member {name}")
            yield name, out


class RetainedStore:
    """Publisher originals this project already captured and keeps, content-addressed, in private Storage
    (corpus-originals/state-codes/sha256/..). Index rows: {url, sha256, retrieved_at, bytes, object_key}, from a JSONL
    file or paged from public.state_law_retained_sources_v1 (needs EXTERNAL_SUPABASE_URL/KEY in the environment).
    Downloads are read-only GETs; every object is checked against its recorded sha256. The original capture time is
    kept as retrieved_at, so an edition built this way states when the publisher bytes were actually read."""

    def __init__(self, state: str, rows: Iterable[dict]):
        self.state = state
        self.by_url: dict[str, dict] = {}
        for row in rows:
            prior = self.by_url.get(row["url"])
            if prior is None or row["retrieved_at"] > prior["retrieved_at"]:
                self.by_url[row["url"]] = row
        self.downloads = 0

    @classmethod
    def from_jsonl(cls, state: str, path: pathlib.Path) -> "RetainedStore":
        return cls(state, read_jsonl(path))

    @classmethod
    def from_rpc(cls, state: str, page_size: int = 5000) -> "RetainedStore":
        rows, after = [], None
        while True:
            got = _admin_rpc("state_law_retained_sources_v1", {"p_jurisdiction": state, "p_after": after, "p_limit": page_size})
            batch = got.get("rows", [])
            rows.extend(batch)
            if len(batch) < page_size:
                return cls(state, rows)
            after = batch[-1]["url"]

    def urls(self, prefix: str = "") -> list[str]:
        return sorted(u for u in self.by_url if u.startswith(prefix))

    def get(self, url: str) -> Fetched:
        row = self.by_url.get(url)
        if row is None:
            raise KeyError(f"no retained original for {url}")
        base = os.environ.get("EXTERNAL_SUPABASE_URL", "").rstrip("/")
        key = os.environ.get("EXTERNAL_SUPABASE_KEY", "")
        if not base or not key:
            raise RuntimeError("EXTERNAL_SUPABASE_URL/EXTERNAL_SUPABASE_KEY are required to read retained originals")
        request = urllib.request.Request(f"{base}/storage/v1/object/corpus-originals/{row['object_key']}",
                                         headers={"apikey": key, "Authorization": f"Bearer {key}"})
        with urllib.request.urlopen(request, timeout=120) as response:
            body = response.read()
        digest = hashlib.sha256(body).hexdigest()
        if digest != row["sha256"]:
            raise RuntimeError(f"retained object for {url} does not match its recorded sha256")
        self.downloads += 1
        return Fetched(url=url, final_url=url, status=200, headers={}, body=body, sha256=digest, bytes=len(body),
                       retrieved_at=row["retrieved_at"], method="retained_original")


def _admin_rpc(name: str, payload: dict) -> Any:
    base = os.environ.get("EXTERNAL_SUPABASE_URL", "").rstrip("/")
    key = os.environ.get("EXTERNAL_SUPABASE_KEY", "")
    if not base or not key:
        raise RuntimeError("EXTERNAL_SUPABASE_URL/EXTERNAL_SUPABASE_KEY are required")
    request = urllib.request.Request(f"{base}/rest/v1/rpc/{name}", data=json.dumps(payload).encode(), method="POST",
                                     headers={"apikey": key, "Authorization": f"Bearer {key}", "Content-Type": "application/json"})
    with urllib.request.urlopen(request, timeout=300) as response:
        return json.loads(response.read().decode("utf-8"))


# ---------------------------------------------------------------------------------------------------------------
# State metadata and run context
# ---------------------------------------------------------------------------------------------------------------


@dataclasses.dataclass(frozen=True)
class StateMeta:
    state: str
    code_name: str
    publisher: str
    publisher_url: str
    official_source: bool
    access: str
    hosts: tuple
    codes: tuple
    parser: str
    min_interval_s: float = 1.0
    terms_note: str = ""
    update_cadence: str = ""
    blocked: str | None = None

    def validate(self) -> None:
        if not STATE_RE.match(self.state):
            raise ModelError(f"bad state {self.state!r}")
        if self.access not in ACCESS:
            raise ModelError(f"bad access {self.access!r}")
        if not PARSER_RE.match(self.parser) or not self.parser.startswith(self.state.lower() + "-"):
            raise ModelError(f"parser must look like {self.state.lower()}-name/1: {self.parser!r}")
        seen = set()
        for code in self.codes:
            if not CODE_RE.match(code.code) or code.code in seen:
                raise ModelError(f"bad or duplicate code key {code.code!r}")
            seen.add(code.code)
            code.all_patterns()

    def code(self, key: str) -> Code:
        for code in self.codes:
            if code.code == key:
                return code
        raise ModelError(f"{self.state}: undeclared code {key!r}")


class _Jsonl:
    def __init__(self, path: pathlib.Path):
        self.path = path
        self.count = 0
        self._fh = gzip.open(path, "wt", encoding="utf-8", compresslevel=6)

    def write(self, obj: dict) -> None:
        self._fh.write(json.dumps(obj, ensure_ascii=False, separators=(",", ":"), sort_keys=True) + "\n")
        self.count += 1

    def close(self) -> dict:
        self._fh.close()
        data = self.path.read_bytes()
        return {"sha256": hashlib.sha256(data).hexdigest(), "bytes": len(data), "records": self.count}


_MARKUP_RE = re.compile(r"</?[a-zA-Z][a-zA-Z0-9]*(?:\s[^<>]*)?/?>|&(?:[a-zA-Z][a-zA-Z0-9]{1,30}|#\d+|#x[0-9a-fA-F]+);")


class RunContext:
    """One acquisition run for one state. State modules call fetch/edition/node/section; run.py finalises."""

    def __init__(self, meta: StateMeta, out_root: pathlib.Path, raw_root: pathlib.Path | None, *,
                 sample: int | None = None, keep_raw: bool = False, fetcher: Fetcher | None = None,
                 today: _dt.date | None = None, log: Callable[[str], None] | None = None):
        meta.validate()
        self.meta = meta
        self.state = meta.state
        self.sample = sample
        self.keep_raw = keep_raw or sample is not None
        self.raw_root = raw_root
        self.started = utcnow()
        self.today = today or _dt.datetime.now(_dt.timezone.utc).date()
        self._log = log or (lambda msg: print(msg, flush=True))
        self.fetcher = fetcher or Fetcher(min_interval_s=meta.min_interval_s, log=self._log)
        base = f"{meta.state.lower()}-{self.today.strftime('%Y%m%d')}"
        state_dir = out_root / meta.state.lower()
        state_dir.mkdir(parents=True, exist_ok=True)
        edition_id, k = base, 1
        while (state_dir / edition_id).exists():
            k += 1
            edition_id = f"{base}-{k}"
        self.edition_id = edition_id
        self.dir = state_dir / edition_id
        self.dir.mkdir(parents=True)
        self._sections = _Jsonl(self.dir / "sections.jsonl.gz")
        self._nodes = _Jsonl(self.dir / "nodes.jsonl.gz")
        self._sources = _Jsonl(self.dir / "sources.jsonl.gz")
        self._rejects = _Jsonl(self.dir / "rejects.jsonl.gz")
        self.strict = sample is not None
        self._node_ids: dict[str, int] = {}
        self._section_ids: set[str] = set()
        self._ordinals: set[int] = set()
        self._by_status: dict[str, int] = {}
        self._edition: dict[str, Any] = {}
        self._source_bytes = 0
        self._last_retrieved: str | None = None
        self._first_retrieved: str | None = None
        self.retained: RetainedStore | None = None
        self.options: dict[str, str] = {}
        self.section_count = 0

    # logging / bounds -------------------------------------------------------------------------------------
    def log(self, msg: str) -> None:
        self._log(f"[{self.state}] {msg}")

    def want_more(self) -> bool:
        return self.sample is None or self.section_count < self.sample

    # sources ----------------------------------------------------------------------------------------------
    def _record_source(self, fetched: Fetched, keep_raw: bool = True) -> None:
        raw_path = None
        if keep_raw and self.keep_raw and self.raw_root is not None:
            raw_dir = self.raw_root / self.state.lower() / fetched.sha256[:2]
            raw_dir.mkdir(parents=True, exist_ok=True)
            raw_file = raw_dir / f"{fetched.sha256}.raw"
            if not raw_file.exists():
                raw_file.write_bytes(fetched.body)
                meta = {"url": fetched.url, "final_url": fetched.final_url, "content_type": fetched.content_type,
                        "member": fetched.member}
                (raw_dir / f"{fetched.sha256}.json").write_text(json.dumps(meta, sort_keys=True))
            raw_path = str(raw_file.relative_to(self.raw_root))
        self._sources.write({
            "schema": SOURCE_SCHEMA, "edition_id": self.edition_id, "url": fetched.url, "final_url": fetched.final_url,
            "status": fetched.status, "retrieved_at": fetched.retrieved_at, "sha256": fetched.sha256,
            "bytes": fetched.bytes, "content_type": fetched.content_type, "method": fetched.method,
            "member": fetched.member, "raw": raw_path,
        })
        self._source_bytes += fetched.bytes
        self._last_retrieved = max(self._last_retrieved or fetched.retrieved_at, fetched.retrieved_at)
        if self._first_retrieved is None or fetched.retrieved_at < self._first_retrieved:
            self._first_retrieved = fetched.retrieved_at

    def fetch(self, url: str, *, method: str = "publisher_page", data: bytes | None = None, headers: dict | None = None,
              accept_status: Iterable[int] = (200,), keep_raw: bool = True) -> Fetched:
        if method not in METHODS:
            raise ModelError(f"bad method {method!r}")
        host = urllib.parse.urlsplit(url).netloc.lower()
        if self.meta.hosts and host not in self.meta.hosts:
            raise ModelError(f"{url} is not on a declared publisher host {self.meta.hosts}")
        fetched = self.fetcher.get(url, data=data, headers=headers, method=method, accept_status=accept_status)
        self._record_source(fetched, keep_raw=keep_raw)
        return fetched

    def get(self, url: str, fallback_fresh: bool = False, keep_raw: bool = True, **kwargs: Any) -> Fetched:
        """fetch() from the publisher, or the retained original of the same URL when the run uses a RetainedStore
        (run.py --retained-index FILE or --option source=retained). fallback_fresh fetches from the publisher when
        no retained copy of that URL exists (for pages the earlier capture did not keep). keep_raw=False records a
        bulk archive without keeping its bytes (its members are kept through member())."""
        if self.retained is None or (fallback_fresh and url not in self.retained.by_url):
            fetched = self.fetch(url, keep_raw=keep_raw, **kwargs)
            return fetched
        host = urllib.parse.urlsplit(url).netloc.lower()
        if self.meta.hosts and host not in self.meta.hosts:
            raise ModelError(f"{url} is not on a declared publisher host {self.meta.hosts}")
        fetched = self.retained.get(url)
        self._record_source(fetched, keep_raw=keep_raw)
        return fetched

    def member(self, archive: Fetched | dict, name: str, body: bytes) -> Fetched:
        """A member of an already-recorded bulk archive, as its own source (sha256 of the member bytes)."""
        src = archive if isinstance(archive, dict) else archive.source()
        fetched = Fetched(url=src["url"], final_url=src["url"], status=200, headers={}, body=body,
                          sha256=hashlib.sha256(body).hexdigest(), bytes=len(body),
                          retrieved_at=src["retrieved_at"], method="publisher_bulk", member=name)
        self._record_source(fetched)
        return fetched

    @contextlib.contextmanager
    def stream(self, url: str, *, headers: dict | None = None) -> Iterator[HashingReader]:
        """Stream a bulk file without keeping it on disk; the archive itself is recorded with its full sha256."""
        host = urllib.parse.urlsplit(url).netloc.lower()
        if self.meta.hosts and host not in self.meta.hosts:
            raise ModelError(f"{url} is not on a declared publisher host {self.meta.hosts}")
        with self.fetcher.open_stream(url, headers=headers) as (response, hdrs, retrieved_at):
            reader = HashingReader(response)
            buffered = io.BufferedReader(reader, buffer_size=1 << 20)
            self._stream_meta = {"url": url, "final_url": response.geturl(), "retrieved_at": retrieved_at,
                                 "content_type": hdrs.get("content-type", ""), "last_modified": hdrs.get("last-modified")}
            yield buffered  # type: ignore[misc]
            reader.drain()
        self._sources.write({
            "schema": SOURCE_SCHEMA, "edition_id": self.edition_id, "url": url,
            "final_url": self._stream_meta["final_url"], "status": 200, "retrieved_at": retrieved_at,
            "sha256": reader.hash.hexdigest(), "bytes": reader.count, "content_type": self._stream_meta["content_type"],
            "method": "publisher_bulk", "member": None, "raw": None,
        })
        self._source_bytes += reader.count
        self._last_retrieved = max(self._last_retrieved or retrieved_at, retrieved_at)
        self._first_retrieved = min(self._first_retrieved or retrieved_at, retrieved_at)
        self.stream_source = {"url": url, "retrieved_at": retrieved_at, "sha256": reader.hash.hexdigest(),
                              "bytes": reader.count}

    # edition ----------------------------------------------------------------------------------------------
    def edition(self, *, edition_label: str | None = None, currency_statement: str | None = None,
                currency_source_url: str | None = None, currency_through: str | None = None,
                source_last_modified: str | None = None) -> None:
        if currency_through is not None and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", currency_through):
            raise ModelError("currency_through must be an ISO date the publisher states")
        self._edition = {
            "edition_label": norm_ws(edition_label) or None,
            "currency_statement": norm_lines(currency_statement) or None,
            "currency_source_url": currency_source_url,
            "currency_through": currency_through,
            "source_last_modified": source_last_modified,
        }

    # hierarchy --------------------------------------------------------------------------------------------
    def _ensure_root(self, code: str) -> str:
        root = f"{self.state}:{code}"
        if root not in self._node_ids:
            info = self.meta.code(code)
            self._node_ids[root] = len(self._node_ids)
            self._nodes.write({
                "schema": NODE_SCHEMA, "node_id": root, "edition_id": self.edition_id, "state": self.state,
                "code": code, "parent_id": None, "level": "code", "label": info.name, "number": None,
                "heading": info.name, "ordinal": self._node_ids[root], "source_url": None,
            })
        return root

    def node(self, code: str, steps: list[tuple], label: str, heading: str | None = None,
             source_url: str | None = None) -> str:
        parent = self._ensure_root(code) if len(steps) == 1 else node_id(self.state, code, steps[:-1])
        if parent not in self._node_ids:
            raise ModelError(f"parent {parent} must be emitted before {steps}")
        nid = node_id(self.state, code, steps)
        if nid in self._node_ids:
            return nid
        level, number = steps[-1][0], steps[-1][1]
        self._node_ids[nid] = len(self._node_ids)
        self._nodes.write({
            "schema": NODE_SCHEMA, "node_id": nid, "edition_id": self.edition_id, "state": self.state, "code": code,
            "parent_id": parent, "level": level, "label": norm_ws(label) or level.title(),
            "number": norm_ws(number) or None, "heading": norm_ws(heading) or None, "ordinal": self._node_ids[nid],
            "source_url": source_url,
        })
        return nid

    def ensure_path(self, code: str, path: list[dict], source_url: str | None = None) -> str:
        """Create any missing nodes of `path` ([{level,label,number,heading}], root→leaf) and return the leaf id."""
        self._ensure_root(code)
        steps: list[tuple[str, str | None]] = []
        nid = f"{self.state}:{code}"
        for step in path:
            steps.append((step["level"], step.get("number"), step.get("heading")))
            nid = self.node(code, list(steps), step.get("label") or step["level"].title(), step.get("heading"),
                            source_url)
        return nid

    # sections ---------------------------------------------------------------------------------------------
    def section(self, **fields: Any) -> str | None:
        """Emit one section (see _section). Sample runs are strict (a ModelError stops the run); full runs record
        the rejected record in rejects.jsonl.gz with the reason and continue, so one odd page never hides others."""
        try:
            return self._section(**fields)
        except ModelError as error:
            if self.strict:
                raise
            src = fields.get("source")
            src = src.source() if isinstance(src, Fetched) else (src or {})
            self._rejects.write({"state": self.state, "code": fields.get("code"), "number": fields.get("number"),
                                 "reason": str(error)[:500], "source_url": src.get("url"), "source_sha256": src.get("sha256")})
            return None

    def _section(self, *, code: str, number: str, heading: str | None, text: str, source: Fetched | dict,
                node_id: str | None = None, path: list[dict] | None = None, history: str | None = None,
                status: str | None = None, status_marker: str | None = None, status_basis: str | None = None,
                effective: dict | None = None, version: str | None = None, version_index: int | None = None,
                also: Iterable[Fetched | dict] = (), ordinal: int | None = None) -> str:
        info = self.meta.code(code)
        number = norm_ws(number)
        if path is None:
            path = []
        if node_id is None:
            node_id = self.ensure_path(code, path)
        elif node_id not in self._node_ids:
            raise ModelError(f"unknown node {node_id}")
        text = norm_lines(text)
        heading = norm_ws(heading) or None
        history = norm_lines(history) or None
        for label, value in (("text", text), ("heading", heading), ("history", history)):
            if value and _MARKUP_RE.search(value):
                raise ModelError(f"markup in {label} of {self.state} {number}: {_MARKUP_RE.search(value).group(0)!r}")
        if status is None:
            status, marker = classify_status(heading, text)
            if status:
                status_marker = status_marker or marker
        if status is None:
            if not self.meta.official_source:
                status, basis = "not_recorded", "not_recorded"
            else:
                status, basis = "in_force", "current_compilation"
        else:
            basis = "publisher_marker" if status != "not_recorded" else "not_recorded"
        if status_basis:
            basis = status_basis
        if status not in STATUSES or basis not in STATUS_BASES:
            raise ModelError(f"bad status {status}/{basis}")
        if status == "in_force" and basis == "publisher_marker" and not status_marker:
            raise ModelError("publisher_marker basis needs the marker text")
        if not text and status == "in_force":
            raise ModelError(f"{self.state} {number}: empty text cannot be in_force")
        eff = {"start": None, "end": None, "note": None}
        if effective:
            eff.update({k: effective.get(k) for k in eff})
            for key in ("start", "end"):
                if eff[key] is not None and not re.fullmatch(r"\d{4}-\d{2}-\d{2}", eff[key]):
                    raise ModelError(f"effective.{key} must be ISO date")
            eff["note"] = norm_ws(eff["note"]) or None
        src = source.source() if isinstance(source, Fetched) else dict(source)
        for key in ("url", "retrieved_at", "sha256", "bytes", "method"):
            if src.get(key) in (None, ""):
                raise ModelError(f"source.{key} missing for {number}")
        if src["method"] not in METHODS:
            raise ModelError(f"bad source method {src['method']}")
        src.setdefault("member", None)
        extra = [a.source() if isinstance(a, Fetched) else dict(a) for a in also]
        if extra:
            src["also"] = [{"url": a["url"], "sha256": a["sha256"], "member": a.get("member")} for a in extra]
        if ordinal is None:
            ordinal = self.section_count
        if ordinal in self._ordinals:
            raise ModelError(f"duplicate ordinal {ordinal}")
        self._ordinals.add(ordinal)
        sid = section_id(self.state, code, number, version_index)
        if sid in self._section_ids:
            raise ModelError(f"duplicate section id {sid} (pass version/version_index for multiple versions)")
        self._section_ids.add(sid)
        record = {
            "schema": SECTION_SCHEMA, "section_id": sid, "edition_id": self.edition_id, "state": self.state,
            "code": code, "number": number, "number_norm": norm_number(number), "version": norm_ws(version) or None,
            "citation": format_citation(info.citation_template, number), "heading": heading, "text": text,
            "history": history, "status": status, "status_basis": basis, "status_marker": norm_ws(status_marker) or None,
            "effective": eff, "node_id": node_id, "path": [
                {"level": p["level"], "label": norm_ws(p.get("label")) or p["level"].title(),
                 "number": norm_ws(p.get("number")) or None, "heading": norm_ws(p.get("heading")) or None}
                for p in path
            ], "ordinal": ordinal, "source": src,
            "text_sha256": hashlib.sha256(text.encode("utf-8")).hexdigest(), "parser": self.meta.parser,
        }
        self._sections.write(record)
        self.section_count += 1
        self._by_status[status] = self._by_status.get(status, 0) + 1
        return sid

    # finalise ---------------------------------------------------------------------------------------------
    def finish(self) -> dict:
        files = {
            "sections.jsonl.gz": self._sections.close(),
            "nodes.jsonl.gz": self._nodes.close(),
            "sources.jsonl.gz": self._sources.close(),
            "rejects.jsonl.gz": self._rejects.close(),
        }
        meta = self.meta
        edition = {
            "schema": EDITION_SCHEMA, "edition_id": self.edition_id, "state": meta.state, "code_name": meta.code_name,
            "publisher": meta.publisher, "publisher_url": meta.publisher_url, "official_source": meta.official_source,
            "access": meta.access, "edition_label": None, "currency_statement": None, "currency_source_url": None,
            "currency_through": None, "source_last_modified": None, **self._edition,
            "retrieved_from": self._first_retrieved or self.started, "retrieved_to": self._last_retrieved or self.started,
            "source_mode": "retained_original" if self.retained is not None else "publisher",
            "codes": [
                {"code": c.code, "name": c.name, "citation_template": c.citation_template,
                 "patterns": [{"regex": p.regex, "number": p.number} for p in c.all_patterns()]}
                for c in meta.codes
            ],
            "counts": {"sections": self.section_count, "nodes": len(self._node_ids), "sources": files["sources.jsonl.gz"]["records"],
                       "rejected": files["rejects.jsonl.gz"]["records"],
                       "source_bytes": self._source_bytes, "by_status": dict(sorted(self._by_status.items()))},
            "files": files, "parser": meta.parser, "lib": LIB_VERSION,
            "sample": None if self.sample is None else {"limit": self.sample},
            "terms_note": meta.terms_note, "update_cadence": meta.update_cadence,
        }
        (self.dir / "edition.json").write_text(json.dumps(edition, indent=2, ensure_ascii=False, sort_keys=True))
        return edition


def read_jsonl(path: pathlib.Path) -> Iterator[dict]:
    opener = gzip.open if str(path).endswith(".gz") else open
    with opener(path, "rt", encoding="utf-8") as handle:  # type: ignore[operator]
        for line in handle:
            if line.strip():
                yield json.loads(line)
