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


def _flat(value: str) -> str:
    """Source line breaks inside HTML text are whitespace (only <br> and block ends break lines)."""
    return value.replace("\r", " ").replace("\n", " ")


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
            parts.append(_flat(node.text))
        for child in node:
            walk(child)
        if tag in ("p", "div", "tr", "table", "li", "h1", "h2", "h3", "h4", "h5", "h6"):
            parts.append("\n")
        if node.tail:
            parts.append(_flat(node.tail))

    text = _flat(el.text or "")
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

    get = fetch

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


# --- status from the publisher's own markers (stricter than lib.classify_status; see module docstring) ----------

_MARKER = re.compile(
    r"^[\[(]?\s*(repealed|reserved|expired|renumbered|redesignated|transferred|terminated)"
    r"(?=$|[\s.,:;\])\-—]*(?:$|by\b|and\b|eff\.?|effective\b|as\b|to\b|from\b|for\b|pursuant\b|under\b|in\b|on\b|"
    r"\d|[\[(]|L\.|Laws\b|P\.?L\.?|S\.?L\.?|Acts?\b|ch\.?|c\.|section|sec\.|§))", re.I)
_MAP = {"redesignated": "renumbered", "terminated": "expired"}
_TRAILING = re.compile(r"(\((repealed|reserved|expired|renumbered|redesignated|transferred|terminated)\b[^()]*\))\.?\s*$",
                       re.I)


def marker_status(heading: str | None, text: str | None):
    """(status, verbatim marker) when the publisher printed a status-only entry, else (None, None).

    A heading counts only when no statute text is printed under it; a short text counts only when the marker word
    starts it and is followed by end of text, punctuation, or a citation/date word ("Repealed by L.2005, c.83",
    "[Reserved]", "Expired." , "Renumbered as 12-3-4"). Ordinary catchlines such as "Reserved name." or
    "Transferred employees; ..." over operative text never set a status.
    """
    t = one_line(text or "")
    h = one_line(heading or "")
    candidates = []
    if t and len(t) <= 400:
        candidates.append(t)
    if not t and h:
        candidates.append(h)
    for cand in candidates:
        m = _MARKER.match(cand)
        if m:
            word = m.group(1).lower()
            return _MAP.get(word, word), cand
    if not t and h:
        # catchline followed by the publisher's parenthetical marker: "Salary (Repealed)." (Pennsylvania)
        m = _TRAILING.search(h)
        if m:
            word = m.group(2).lower()
            return _MAP.get(word, word), m.group(1)
    return None, None


def status_kwargs(heading: str | None, text: str | None, *, flag_status: str | None = None,
                  flag_marker: str | None = None):
    """kwargs for ctx.section(status=..., status_marker=..., status_basis=...), or None when the entry has neither
    text nor a publisher marker (the caller logs and skips it). `flag_status` is a structured publisher flag (e.g.
    Michigan's <Repealed>true</Repealed>) and needs the verbatim marker text the publisher prints with it."""
    status, marker = marker_status(heading, text)
    if flag_status and flag_marker:
        return {"status": flag_status, "status_marker": flag_marker, "status_basis": "publisher_marker"}
    if status:
        return {"status": status, "status_marker": marker, "status_basis": "publisher_marker"}
    if one_line(text or ""):
        return {"status": "in_force", "status_marker": None, "status_basis": "current_compilation"}
    return None


# --- local verify adapter ---------------------------------------------------------------------------------------

def _xml_text_rendering_markup(body):
    """lib.xml_text, except that a text node carrying the publisher's escaped markup (Michigan MCL `BodyText`:
    `&lt;Paragraph&gt;&lt;P&gt;...&lt;Emph&gt;`) is rendered through lib.html_text, as lib.json_text already does for
    JSON string values. Requested from STAT-A as an additive lib change; until then STAT-B verifies through this."""
    from xml.etree import ElementTree as ET
    from state_law import lib  # type: ignore

    if isinstance(body, str):
        body = body.encode("utf-8")
    root = ET.fromstring(body)
    out: list[str] = []

    def piece(value):
        if value and "<" in value and ">" in value and re.search(r"<[A-Za-z][^>]*>", value):
            return "\n" + lib.html_text(value) + "\n"
        return value or ""

    def walk(el):
        out.append("\n")
        out.append(piece(el.text))
        for child in el:
            walk(child)
        out.append("\n")
        out.append(piece(el.tail))

    walk(root)
    return lib.norm_lines(_html.unescape("".join(out)))


def _xml_text_inline(body: bytes, inline: set) -> str:
    """XML text rendering where the named inline elements (Utah <modchap>, <xref>, <format>, <tab>) join their
    surrounding text instead of starting a new line; every other element boundary is a line break."""
    from xml.etree import ElementTree as ET
    from state_law import lib  # type: ignore

    root = ET.fromstring(body)
    out: list[str] = []

    def walk(el):
        block = el.tag not in inline
        if block:
            out.append("\n")
        elif el.tag == "tab":
            out.append(" ")
        out.append(el.text or "")
        for child in el:
            walk(child)
        if block:
            out.append("\n")
        out.append(el.tail or "")

    walk(root)
    return lib.norm_lines(_html.unescape("".join(out)))


def verify_cli(argv=None):
    """python3 scripts/state_law/states/_statb.py verify <edition_dir> --raw <raw_root>"""
    import argparse
    import json
    import pathlib
    import sys as _sys

    _sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
    from state_law import lib  # type: ignore
    from state_law import verify as shared_verify  # type: ignore

    lib.xml_text = _xml_text_rendering_markup
    shared_render = lib.render_text

    def render_text(body, content_type=None, url=None):
        # CSV downloads (Virginia Law Library): undo the CSV quoting layer, then render each field (HTML or text)
        if url and url.lower().split("?", 1)[0].endswith(".csv"):
            import csv as _csv
            import io as _io

            out = []
            for row in _csv.reader(_io.StringIO(lib.decode_bytes(body, "utf-8").lstrip("\ufeff"))):
                for field in row:
                    out.append(lib.html_text(field) if "<" in field else lib.norm_lines(_html.unescape(field)))
            return "\n".join(x for x in out if x)
        # PDFs: the same `pdftotext -layout` rendering the North Dakota parser reads (lib.pdf_text uses the default
        # reading mode, which drops some non-breaking hyphens the layout mode keeps)
        if body[:5] == b"%PDF-":
            import subprocess
            import tempfile

            with tempfile.NamedTemporaryFile(suffix=".pdf") as handle:
                handle.write(body)
                handle.flush()
                done = subprocess.run(["pdftotext", "-layout", "-enc", "UTF-8", handle.name, "-"], capture_output=True,
                                      check=True)
            return lib.norm_lines(done.stdout.decode("utf-8", errors="replace"))
        # Utah title XML: the publisher's page prints each subsection's label from its number attribute
        # ("78B-2-307(1)(a)" -> "(a)"); render it the same way before reading the text nodes
        if body[:200].lstrip().startswith(b"<title number=") and b"<subsection number=" in body:
            labelled = re.sub(rb'(<subsection number="[^"]*?(\([^()"]+\))">)', rb"\1\2 ", body)
            labelled = re.sub(rb'(<section number="([^"]+)">)', rb"\1\2 ", labelled)   # the page prints the number
            return _xml_text_inline(labelled, {"modchap", "xref", "ext_ref", "format", "tab", "b", "i", "u", "sup", "sub",
                                               "em", "strong", "span"})
        # UTF-16 LE without a byte-order mark (South Dakota api/Statutes): lib.decode_bytes reads it as UTF-8
        if len(body) > 4 and body[1:2] == b"\x00" and body[3:4] == b"\x00" and not body.startswith(b"\xff\xfe"):
            decoded = body.decode("utf-16-le", errors="replace")
            # the whole-title response is a run of complete <html> documents; render each one
            return "\n".join(lib.html_text(doc) for doc in re.split(r"(?=<html\b)", decoded) if doc.strip())
        return shared_render(body, content_type, url)

    lib.render_text = render_text
    parser = argparse.ArgumentParser()
    parser.add_argument("cmd", choices=["verify"])
    parser.add_argument("edition_dir", type=pathlib.Path)
    parser.add_argument("--raw", type=pathlib.Path, default=None)
    args = parser.parse_args(argv)
    result = shared_verify.verify(args.edition_dir, args.raw)
    result["adapter"] = ("statb: xml_text renders escaped publisher markup via html_text; .csv sources are rendered "
                         "field by field after CSV unquoting; BOM-less UTF-16 LE bodies are decoded as UTF-16; PDFs are rendered with pdftotext -layout; Utah subsection labels are rendered from their number attribute")
    (args.edition_dir / "verify.json").write_text(json.dumps(result, indent=2, ensure_ascii=False))
    print(json.dumps({k: result[k] for k in ("edition_id", "ok", "counts", "adapter")}, ensure_ascii=False))
    for item in result["failures"][:20]:
        print("FAIL", json.dumps(item, ensure_ascii=False))
    return 0 if result["ok"] else 2


# --- replay of bytes already captured from the publisher (parser proof when the live fetcher must stop) -----------

class ReplayFetcher:
    """Serves publisher bytes captured earlier (url -> (path, retrieved_at)) through the lib.Fetcher interface.
    Every Fetched is labelled method `retained_original`; nothing touches the network."""

    def __init__(self, captures: dict):
        self.captures = captures
        self.requests = 0

    def get(self, url, *, data=None, headers=None, method="publisher_page", accept_status=(200,)):
        import pathlib
        from state_law import lib  # type: ignore

        if url not in self.captures:
            raise lib.Blocked(f"no retained capture for {url} (live fetching is not allowed for this run)")
        path, retrieved_at = self.captures[url]
        body = pathlib.Path(path).read_bytes()
        self.requests += 1
        return lib.Fetched(url=url, final_url=url, status=200, headers={}, body=body, sha256=sha256(body),
                           bytes=len(body), retrieved_at=retrieved_at, method="retained_original")

    def open_stream(self, url, *, headers=None):
        raise RuntimeError("replay of streamed archives is not supported")


def replay_cli(argv=None):
    """python3 _statb.py replay <xx> --capture URL=PATH@ISO ... --out DIR --raw DIR [--sample N] [--option k=v]"""
    import argparse
    import importlib.util
    import json
    import pathlib
    import sys as _sys

    _sys.path.insert(0, str(pathlib.Path(__file__).resolve().parents[2]))
    from state_law import lib  # type: ignore

    parser = argparse.ArgumentParser()
    parser.add_argument("cmd", choices=["replay"])
    parser.add_argument("state")
    parser.add_argument("--capture", action="append", default=[])
    parser.add_argument("--out", type=pathlib.Path, required=True)
    parser.add_argument("--raw", type=pathlib.Path, required=True)
    parser.add_argument("--sample", type=int, default=None)
    parser.add_argument("--option", action="append", default=[])
    args = parser.parse_args(argv)
    captures = {}
    for item in args.capture:
        url, rest = item.rsplit("=", 1)   # URLs may carry "=" in their query; paths do not
        path, at = rest.rsplit("@", 1)
        captures[url] = (path, at)
    here = pathlib.Path(__file__).resolve().parent
    spec = importlib.util.spec_from_file_location(f"state_law.states.{args.state}", here / f"{args.state}.py")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    ctx = lib.RunContext(module.META, args.out, args.raw, sample=args.sample, keep_raw=True,
                         fetcher=ReplayFetcher(captures))
    ctx.options = dict(o.split("=", 1) for o in args.option)
    ctx.log("REPLAY of retained publisher captures (method retained_original); no live requests")
    module.acquire(ctx)
    edition = ctx.finish()
    (ctx.dir / "replay.json").write_text(json.dumps({"captures": captures}, indent=2))
    print(json.dumps({"edition_dir": str(ctx.dir), "counts": edition["counts"]}))
    return 0


if __name__ == "__main__":
    import sys as _sys
    _sys.exit(replay_cli() if len(_sys.argv) > 1 and _sys.argv[1] == "replay" else verify_cli())
