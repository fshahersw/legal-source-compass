"""Plain-text renderings of acquired rule documents, and the quote check every extracted value must pass.

Rendering (deterministic, documented in REPORT.md): PDFs go through poppler's `pdftotext -layout -enc UTF-8`; every line is
stripped and its internal runs of spaces collapsed to one; form feeds (page breaks) are kept as their own line so page
numbers can be counted; more than one blank line in a row is reduced to one. HTML keeps the visible text of block
elements, one block per line. The rendering never rewrites words.
"""
from __future__ import annotations

import html as htmlmod
import re
import subprocess

PAGE_BREAK = "\f"


def tidy_lines(raw: str) -> str:
    out: list[str] = []
    blank = 0
    for page_no, page in enumerate(raw.split(PAGE_BREAK)):
        if page_no:
            out.append(PAGE_BREAK)
            blank = 0
        for line in page.split("\n"):
            line = re.sub(r"[ \t ]+", " ", line).strip()
            if not line:
                blank += 1
                if blank > 1:
                    continue
            else:
                blank = 0
            out.append(line)
    text = "\n".join(out)
    text = text.replace("­", "")  # soft hyphens are invisible in the source
    return text.strip("\n") + "\n"


def pdf_text(path: str, layout: bool = True) -> str:
    """layout=False uses pdftotext's reading-order mode, which keeps two-column pages (many constitutions) in order."""
    args = ["pdftotext", "-layout", "-enc", "UTF-8", path, "-"] if layout else ["pdftotext", "-enc", "UTF-8", path, "-"]
    result = subprocess.run(args, capture_output=True, timeout=300)
    if result.returncode != 0:
        raise RuntimeError(f"pdftotext failed for {path}: {result.stderr[:200]!r}")
    return tidy_lines(result.stdout.decode("utf-8", "replace"))


BLOCK_TAGS = ("p", "div", "li", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "br", "td", "th", "dt", "dd", "pre", "blockquote", "section", "article")


def html_fragment_text(fragment) -> str:
    """Visible text of a BeautifulSoup element, one block element per line."""
    from bs4 import NavigableString

    parts: list[str] = []

    def walk(node):
        for child in node.children:
            if isinstance(child, NavigableString):
                if child.__class__.__name__ in ("Comment", "Doctype", "Declaration", "ProcessingInstruction"):
                    continue
                parts.append(str(child))
            elif child.name in ("script", "style", "noscript", "template"):
                continue
            else:
                block = child.name in BLOCK_TAGS
                if block:
                    parts.append("\n")
                walk(child)
                if block:
                    parts.append("\n")

    walk(fragment)
    return tidy_lines(htmlmod.unescape("".join(parts)))


def page_of(text: str, offset: int) -> int:
    """1-based page number of a character offset in a rendering with form-feed page breaks."""
    return text.count(PAGE_BREAK, 0, offset) + 1


def squash(s: str) -> str:
    return re.sub(r"\s+", " ", s.replace(PAGE_BREAK, " ")).strip()


QUOTE_FOLD = str.maketrans({"’": "'", "‘": "'", "“": '"', "”": '"', "–": "-", "—": "-"})


def find_quote(quote: str, text: str) -> str | None:
    """'exact' when the quote is a substring of text; 'spacing_normalized' when it is after collapsing whitespace
    (line breaks, page breaks); None otherwise. Typographic quote and dash variants are not folded: a quote must use the
    source's own characters."""
    q = quote.strip()
    if len(q) < 12:
        return None
    if q in text:
        return "exact"
    if squash(q) and squash(q) in squash(text):
        return "spacing_normalized"
    return None


def value_in_quote(value: str, quote: str) -> bool:
    """The extracted value's own words must appear in the quote (case- and spacing-insensitive)."""
    v = squash(value).lower().translate(QUOTE_FOLD)
    q = squash(quote).lower().translate(QUOTE_FOLD)
    return bool(v) and v in q
