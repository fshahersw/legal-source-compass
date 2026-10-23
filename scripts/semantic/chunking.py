"""Deterministic structural chunking for the semantic index (pure functions, no I/O).

A document's stored text is cut into passages of at most MAX_CHARS characters (about 800 tokens of legal text) at the
coarsest structural boundary that works, in this order:

    1. top-level subsections   ("(a) ..." at the left margin, or a heading line marked with the U+001E record
                                separator the corpus keeps in U.S. Code text, at indent 0)
    2. second-level paragraphs ("(1) ...", or a marked heading line at indent 1)
    3. third-level paragraphs  ("(A) ...", or a marked heading line at indent 2 or deeper)
    4. lines                   (one paragraph or table row per line)
    5. sentences               (a full stop, semicolon or colon followed by a capital, digit or opening bracket)
    6. words                   (the last whitespace before the limit; a hard cut only inside a single token that long)

Adjacent pieces are then merged greedily while they still fit, so a short tail joins the passage before it whenever the two fit.
Offsets are exact: every passage is `text[start:end]` of the stored text, trimmed of surrounding whitespace, passages never
overlap, and every non-whitespace character of the text is in exactly one passage. The same input and parameters always give
the same passages, offsets and hashes (CHUNKER_VERSION names the algorithm; a change of version re-embeds).
"""
from __future__ import annotations

import hashlib
import re
from dataclasses import dataclass

CHUNKER_VERSION = "chunk-1"
MAX_CHARS = 2800  # about 750 tokens of legal text (measured 3.8 to 4.2 characters per token on the stored text)
MAX_EMBED_CHARS = 3000  # heading path plus passage; keeps a dense passage near 800 tokens
SNIPPET_CHARS = 280
MARK = "\x1e"  # the corpus keeps this record separator in front of U.S. Code heading lines

_LOWER = re.compile(r"\(([a-z]{1,2})\)(?=\s|$)")
_DIGIT = re.compile(r"\((\d{1,3})\)(?=\s|$)")
_UPPER = re.compile(r"\(([A-Z]{1,2})\)(?=\s|$)")
_SENTENCE = re.compile(r"(?<=[.;:?!])\s+(?=[A-Z(“\"0-9])")


def sha256_hex(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class Span:
    start: int
    end: int

    @property
    def length(self) -> int:
        return self.end - self.start


def line_level(line: str) -> int:
    """Structural level of one line: 0 top-level subsection, 1 paragraph, 2 sub-paragraph, 3 any other line."""
    tabs = len(line) - len(line.lstrip("\t"))
    rest = line[tabs:]
    if rest.startswith(MARK):
        return min(tabs, 2)
    if tabs == 0:
        if _LOWER.match(rest):
            return 0
        if _DIGIT.match(rest):
            return 1
        if _UPPER.match(rest):
            return 2
    return 3


def _trim(text: str, start: int, end: int) -> Span | None:
    while start < end and text[start].isspace():
        start += 1
    while end > start and text[end - 1].isspace():
        end -= 1
    return Span(start, end) if end > start else None


def _lines(text: str, start: int, end: int) -> list[tuple[int, int]]:
    out = []
    pos = start
    while pos < end:
        nl = text.find("\n", pos, end)
        stop = end if nl == -1 else nl
        out.append((pos, stop))
        pos = stop + 1
    return out


def _cut_points(text: str, start: int, end: int, depth: int) -> list[int]:
    """Offsets inside (start, end) where a line of structural level <= depth begins."""
    points = []
    for s, e in _lines(text, start, end):
        if s > start and text[s:e].strip() and line_level(text[s:e]) <= depth:
            points.append(s)
    return points


def _sentence_cuts(text: str, start: int, end: int) -> list[int]:
    return [start + m.end() for m in _SENTENCE.finditer(text[start:end]) if start + m.end() < end]


def _word_split(text: str, start: int, end: int, limit: int) -> list[tuple[int, int]]:
    """Cut at the last whitespace before the limit; a hard cut only where no whitespace exists."""
    pieces = []
    pos = start
    while end - pos > limit:
        window_end = pos + limit
        cut = -1
        for i in range(window_end, pos, -1):
            if text[i - 1].isspace():
                cut = i
                break
        if cut <= pos:
            cut = window_end
        pieces.append((pos, cut))
        pos = cut
    pieces.append((pos, end))
    return pieces


def _split(text: str, start: int, end: int, depth: int, limit: int) -> list[tuple[int, int]]:
    """Recursively cut [start, end) at the coarsest boundary level that yields pieces within the limit where possible."""
    if end - start <= limit:
        return [(start, end)]
    if depth <= 3:
        points = _cut_points(text, start, end, depth)
        if points:
            bounds = [start, *points, end]
            out: list[tuple[int, int]] = []
            for a, b in zip(bounds, bounds[1:]):
                out.extend(_split(text, a, b, depth + 1, limit))
            return out
        return _split(text, start, end, depth + 1, limit)
    if depth == 4:
        cuts = _sentence_cuts(text, start, end)
        if cuts:
            bounds = [start, *cuts, end]
            out = []
            for a, b in zip(bounds, bounds[1:]):
                out.extend(_split(text, a, b, 5, limit))
            return out
        return _split(text, start, end, 5, limit)
    return _word_split(text, start, end, limit)


def split_spans(text: str, max_chars: int = MAX_CHARS) -> list[Span]:
    """Passages of `text` as trimmed, ordered, non-overlapping spans (see the module docstring)."""
    if not text or not text.strip():
        return []
    pieces = [s for a, b in _split(text, 0, len(text), 0, max_chars) if (s := _trim(text, a, b))]
    merged: list[Span] = []
    for p in pieces:
        if merged and p.end - merged[-1].start <= max_chars:
            merged[-1] = Span(merged[-1].start, p.end)
        else:
            merged.append(p)
    return merged


_STRIP_MARKS = re.compile(r"[\x1e\x1f]")
_INDENT = re.compile(r"\n[\t ]+")
_RUNS = re.compile(r"[\t ]{2,}")
_BLANKS = re.compile(r"\n{3,}")


def clean_for_embedding(body: str) -> str:
    """Remove the corpus's heading marks and indentation noise; wording and line breaks are kept."""
    s = _STRIP_MARKS.sub("", body)
    s = _INDENT.sub("\n", s)
    s = s.replace("\t", " ")
    s = _RUNS.sub(" ", s)
    return _BLANKS.sub("\n\n", s).strip()


def snippet_of(body: str, limit: int = SNIPPET_CHARS) -> str:
    """The first words of a passage on one line, cut at a word boundary."""
    flat = " ".join(clean_for_embedding(body).split())
    if len(flat) <= limit:
        return flat
    cut = flat.rfind(" ", 0, limit)
    return flat[: cut if cut > limit // 2 else limit].rstrip(" ,;:.-") + "…"


def embedding_text(heading: str, body: str) -> str:
    """The exact string that is embedded: the heading path, a blank line, then the passage."""
    cleaned = clean_for_embedding(body)
    return f"{heading}\n\n{cleaned}" if heading else cleaned


@dataclass(frozen=True)
class Chunk:
    dataset: str
    record_id: str
    chunk_no: int
    chunk_total: int  # passages the record has in all (more than were kept when the record is capped)
    start: int
    end: int
    body: str
    heading: str
    title: str
    href: str
    source_url: str | None

    @property
    def text_sha256(self) -> str:
        return sha256_hex(self.body)

    @property
    def embed_text(self) -> str:
        return embedding_text(self.heading, self.body)

    @property
    def snippet(self) -> str:
        return snippet_of(self.body)


@dataclass(frozen=True)
class Doc:
    dataset: str
    record_id: str
    title: str
    heading: str
    text: str
    href: str
    source_url: str | None = None
    max_chunks: int = 40


def body_limit(heading: str, max_chars: int = MAX_CHARS, max_embed_chars: int = MAX_EMBED_CHARS) -> int:
    """Characters a passage may have so that heading plus passage stay within max_embed_chars (never below 1,200)."""
    return max(1200, min(max_chars, max_embed_chars - len(heading) - 2))


def chunk_doc(doc: Doc, max_chars: int = MAX_CHARS) -> list[Chunk]:
    """Passages of one document. A record with more than doc.max_chunks passages keeps the first max_chunks and every kept
    passage carries chunk_total, so the index never presents a prefix as the whole record."""
    spans = split_spans(doc.text, body_limit(doc.heading, max_chars))
    total = len(spans)
    return [
        Chunk(
            dataset=doc.dataset,
            record_id=doc.record_id,
            chunk_no=i,
            chunk_total=total,
            start=s.start,
            end=s.end,
            body=doc.text[s.start : s.end],
            heading=doc.heading,
            title=doc.title,
            href=doc.href,
            source_url=doc.source_url,
        )
        for i, s in enumerate(spans[: doc.max_chunks])
    ]


def estimate_tokens(text: str) -> int:
    """Budgeting estimate only (the API's own usage counts are what is logged): about 3.4 characters per token."""
    return -(-len(text) * 10 // 34)
