"""Visible text of an HTML fragment, the way a browser lays it out (shared by the oversight parsers).

Block-level tags (paragraphs, list items, table cells, breaks and so on) separate words; inline tags (span, a, em, strong)
do not, so '<span>Salem</span>, <span>OR</span>' reads 'Salem, OR' and not 'Salem , OR'. Entities are unescaped, non-breaking
spaces become spaces and runs of whitespace collapse. Letters, digits and punctuation are never changed.
"""
import html
import re

_BLOCK = re.compile(r"<\s*/?\s*(?:p|div|br|li|ul|ol|tr|td|th|table|thead|tbody|h[1-6]|blockquote|section|article|dt|dd|dl)\b[^>]*>", re.I)
_TAG = re.compile(r"<[^>]+>")
_WS = re.compile(r"\s+")


def clean(fragment):
    if fragment is None:
        return ""
    text = _TAG.sub("", _BLOCK.sub(" ", fragment))
    return _WS.sub(" ", html.unescape(text).replace("\xa0", " ")).strip()
