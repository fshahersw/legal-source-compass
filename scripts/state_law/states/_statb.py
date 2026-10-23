"""Small helpers shared by STAT-B's state modules (MI-WY), kept out of the shared lib on purpose.

Nothing here fetches: state modules fetch only through the run context (`ctx.fetch` / `ctx.stream`) from
`scripts/state_law/lib.py`. These helpers turn publisher markup into plain text the same way for every STAT-B
parser, parse dates the publisher prints, and give the offline tests a fake run context.

Owner: STAT-B (wave 1025). If STAT-A's lib grows an equivalent helper, the state modules switch to it.
"""
from __future__ import annotations

import datetime as _dt
import hashlib
import html as _html
import re

MONTHS = {m: i for i, m in enumerate(
    ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october",
     "november", "december"], 1)}
MONTH_ABBR = {"jan": 1, "feb": 2, "mar": 3, "apr": 4, "may": 5, "jun": 6, "jul": 7, "aug": 8, "sep": 9,
              "sept": 9, "oct": 10, "nov": 11, "dec": 12}

_WS = re.compile(r"[ \t\r\f\v    ​]+")


def ws(text: str) -> str:
    """Collapse runs of spaces/tabs (incl. non-breaking) inside lines; strip each line; drop empty lines."""
    lines = [_WS.sub(" ", line).strip() for line in text.replace("\r\n", "\n").replace("\r", "\n").split("\n")]
    return "\n".join(line for line in lines if line)


def one_line(text: str) -> str:
    return _WS.sub(" ", text.replace("\n", " ")).strip()


def el_text(el) -> str:
    """Text of an lxml element: descendants' text in order, <br> as a line break, tables row by row."""
    parts: list[str] = []

    def walk(node):
        tag = node.tag if isinstance(node.tag, str) else ""
        if tag in ("script", "style"):
            if node.tail:
                parts.append(node.tail)
            return
        if tag == "br":
            parts.append("\n")
        elif tag in ("tr",):
            parts.append("\n")
        elif tag in ("td", "th"):
            parts.append(" ")
        if node.text and tag not in ("script", "style"):
            parts.append(node.text)
        for child in node:
            walk(child)
        if tag in ("p", "div", "tr", "table", "li", "h1", "h2", "h3", "h4", "h5", "h6"):
            parts.append("\n")
        if node.tail:
            parts.append(node.tail)

    text = el.text or ""
    parts.append(text)
    for child in el:
        walk(child)
    return ws("".join(parts))


def strip_tags(fragment: str) -> str:
    """Plain text of a markup fragment (regex level; for small fragments only)."""
    fragment = re.sub(r"(?is)<(script|style)\b.*?</\1>", " ", fragment)
    fragment = re.sub(r"(?i)<br\s*/?>", "\n", fragment)
    fragment = re.sub(r"(?i)</(p|div|tr|li|h\d)>", "\n", fragment)
    fragment = re.sub(r"<[^>]+>", " ", fragment)
    return ws(_html.unescape(fragment))


def parse_us_date(text: str) -> str | None:
    """'September 1, 2027' / 'Sept. 1, 2027' / '1-1-27' -> ISO date, else None. Only exact printed dates."""
    m = re.search(r"\b([A-Z][a-z]{2,8})\.?\s+(\d{1,2}),\s+(\d{4})\b", text)
    if m:
        name = m.group(1).lower()
        month = MONTHS.get(name) or MONTH_ABBR.get(name)
        if month:
            try:
                return _dt.date(int(m.group(3)), month, int(m.group(2))).isoformat()
            except ValueError:
                return None
    return None


def natural_key(value: str):
    """Sort key: digit runs numerically, other runs as text ('2', '2A', '10', '10.5')."""
    return [(0, int(part), "") if part.isdigit() else (1, 0, part.lower()) for part in re.findall(r"\d+|\D+", value)]


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def today() -> str:
    return _dt.datetime.now(_dt.timezone.utc).date().isoformat()


class FakeFetched:
    """Stand-in for lib.Fetched in offline tests."""

    def __init__(self, url, body, method="publisher_page", member=None, status=200, headers=None):
        self.url = self.final_url = url
        self.status = status
        self.headers = headers or {}
        self.body = body
        self.sha256 = sha256(body)
        self.bytes = len(body)
        self.retrieved_at = "2026-10-23T00:00:00Z"
        self.method = method
        self.member = member


class FakeCtx:
    """Offline run context for parser tests: serves fixture bytes by URL and records what the module emits.

    Mirrors the `ctx` API in scripts/state_law/MODEL.md section 7 (fetch, stream, edition, node, section, want_more,
    log). Unknown URLs raise KeyError so a test never reaches the network.
    """

    def __init__(self, pages: dict, sample: int | None = None, run_date: str = "2026-10-24"):
        self.pages = pages
        self.sample = sample
        self.run_date = run_date
        self.editions: list[dict] = []
        self.nodes: list[dict] = []
        self.sections: list[dict] = []
        self.logs: list[str] = []
        self._node_ids: set[str] = set()

    def fetch(self, url, *, method="publisher_page", data=None, headers=None, accept_status=(200,)):
        body = self.pages[url]
        if isinstance(body, str):
            body = body.encode("utf-8")
        return FakeFetched(url, body, method=method)

    def stream(self, url, *, method="publisher_bulk"):
        import contextlib
        import io

        @contextlib.contextmanager
        def _cm():
            body = self.pages[url]
            yield io.BytesIO(body)

        return _cm()

    def edition(self, edition_label=None, currency_statement=None, currency_source_url=None, currency_through=None):
        self.editions.append(dict(edition_label=edition_label, currency_statement=currency_statement,
                                  currency_source_url=currency_source_url, currency_through=currency_through))

    def node(self, code, steps, label, heading=None, source_url=None):
        node_id = code + ":" + "/".join(f"{lvl}:{num}" for lvl, num in steps)
        if node_id not in self._node_ids:
            self._node_ids.add(node_id)
            self.nodes.append(dict(node_id=node_id, code=code, steps=list(steps), label=label, heading=heading,
                                   source_url=source_url))
        return node_id

    def section(self, **kw):
        self.sections.append(kw)
        return f"{kw.get('code')}:{kw.get('number')}"

    def want_more(self):
        return self.sample is None or len(self.sections) < self.sample

    def log(self, msg):
        self.logs.append(msg)
