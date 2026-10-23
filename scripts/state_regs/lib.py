"""Shared helpers for the state administrative code stream (wave 1025, worker REGS).

  - polite fetching from official state publishers: robots.txt honoured (Crawl-delay raises the per-host spacing),
    at least MIN_INTERVAL seconds between requests to one host, bounded retries with backoff on 429/5xx/network errors,
    a response-size bound, an identifying User-Agent, and a hard refusal of commercial legal hosts;
  - TLS: the system CA bundle plus `tls/extra_intermediates.pem` (intermediate certificates a server fails to send,
    downloaded from the certificate's own Authority Information Access URL; verification is never disabled);
  - raw capture: every accepted response body is kept unchanged (gzip) under private/acq/w1025_regs/raw/ with a
    manifest line (url, final_url, sha256 of the uncompressed bytes, bytes, retrieved_at, status, content type);
  - text rendering for exact-text checks: html_text() (stdlib HTMLParser, independent of the parsers' lxml/regex
    extraction) and pdf_text() (pdftotext -layout when present, pypdf otherwise);
  - normalisation helpers shared by the parsers (norm_ws, squash for containment checks).

When the shared state-law library (/home/user/wt/stat-a/scripts/state_law/lib.py) exists, `shared_lib()` imports it by
path so field names can be reused; nothing here depends on it.
"""
from __future__ import annotations

import gzip
import hashlib
import html as htmlmod
import importlib.util
import json
import os
import re
import shutil
import ssl
import subprocess
import tempfile
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from datetime import datetime, timezone
from html.parser import HTMLParser

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.abspath(os.path.join(HERE, "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "w1025_regs")
BUILD = os.path.join(ROOT, "private", "build", "w1025_regs")
RAW = os.path.join(ACQ, "raw")
MANIFEST = os.path.join(ACQ, "manifest.jsonl")
EXTRA_CA = os.path.join(ACQ, "tls", "extra_intermediates.pem")
SHARED_LIB = "/home/user/wt/stat-a/scripts/state_law/lib.py"

# The repository's research User-Agent (scripts/enrichment/*/fetchlib.py).
USER_AGENT = "legal-source-compass research (contact: notreelai@gmail.com)"
MIN_INTERVAL = 1.0
MAX_BYTES = 40_000_000
NOT_RECORDED = "Not recorded"

# Commercial or unofficial legal hosts: never fetched (owner instruction 2026-10-19; WAVE1025 accuracy rules).
COMMERCIAL = re.compile(
    r"(^|\.)(westlaw\.com|lexis\.com|lexisnexis\.com|advance\.lexis\.com|thomsonreuters\.com|justia\.com|casetext\.com|"
    r"findlaw\.com|fastcase\.com|vlex\.com|casemine\.com|law\.cornell\.edu|public\.law|elaws\.us|ecode360\.com|"
    r"municode\.com|amlegal\.com|barclaysccr\.com|regulations\.justia\.com|casetext\.com|leagle\.com|anylaw\.com|"
    r"lawserver\.com|nolo\.com|govt\.westlaw\.com|weblinks\.westlaw\.com|codes\.findlaw\.com)$",
    re.I,
)

_robots: dict[str, tuple[urllib.robotparser.RobotFileParser | None, float | None, str]] = {}
_last: dict[str, float] = {}
_guard = threading.Lock()
_host_locks: dict[str, threading.Lock] = {}
_manifest_lock = threading.Lock()


def utc_now() -> str:
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def shared_lib():
    """The shared state-law library module when it exists (imported by path), else None."""
    if not os.path.exists(SHARED_LIB):
        return None
    spec = importlib.util.spec_from_file_location("state_law_lib", SHARED_LIB)
    if not spec or not spec.loader:
        return None
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def _context() -> ssl.SSLContext:
    bundle = os.environ.get("SSL_CERT_FILE") or "/root/.ccr/ca-bundle.crt"
    ctx = ssl.create_default_context(cafile=bundle) if os.path.exists(bundle) else ssl.create_default_context()
    if os.path.exists(EXTRA_CA):
        ctx.load_verify_locations(cafile=EXTRA_CA)
    return ctx


CTX = _context()


def is_commercial(url: str) -> bool:
    host = urllib.parse.urlsplit(url).hostname or ""
    return bool(COMMERCIAL.search(host))


class Blocked(Exception):
    """robots.txt disallows the URL, or the host is commercial: never fetched."""


class Response:
    def __init__(self, url: str, status: int, body: bytes, headers: dict, final_url: str):
        self.url, self.status, self.body, self.headers, self.final_url = url, status, body, headers, final_url

    @property
    def content_type(self) -> str:
        return self.headers.get("Content-Type") or self.headers.get("content-type") or ""

    def text(self) -> str:
        return decode(self.body, self.content_type)


def decode(body: bytes, content_type: str = "") -> str:
    m = re.search(r"charset=([\w-]+)", content_type or "", re.I)
    enc = m.group(1) if m else None
    if not enc:
        head = body[:2000].decode("ascii", "replace")
        mm = re.search(r'<meta[^>]+charset=["\']?([\w-]+)', head, re.I)
        enc = mm.group(1) if mm else "utf-8"
    try:
        return body.decode(enc, "replace")
    except LookupError:
        return body.decode("utf-8", "replace")


def _host_lock(host: str) -> threading.Lock:
    with _guard:
        return _host_locks.setdefault(host, threading.Lock())


def _raw_get(url: str, *, data: bytes | None = None, headers: dict | None = None, timeout: int = 60,
             max_bytes: int = MAX_BYTES) -> Response:
    hdrs = {"User-Agent": USER_AGENT, "Accept": "text/html,application/xhtml+xml,application/json,application/pdf,*/*;q=0.8"}
    if headers:
        hdrs.update(headers)
    req = urllib.request.Request(url, data=data, headers=hdrs, method="POST" if data is not None else "GET")
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=CTX) as resp:
            body = resp.read(max_bytes + 1)
            if len(body) > max_bytes:
                raise RuntimeError(f"{url}: larger than {max_bytes} bytes")
            return Response(url, resp.status, body, dict(resp.headers), resp.geturl())
    except urllib.error.HTTPError as err:
        body = err.read() if hasattr(err, "read") else b""
        return Response(url, err.code, body[:max_bytes], dict(err.headers or {}), err.geturl() if hasattr(err, "geturl") else url)


def robots(url: str) -> tuple[urllib.robotparser.RobotFileParser | None, float | None, str]:
    """(parser or None, crawl-delay or None, verdict note) for the URL's host; cached per host."""
    parts = urllib.parse.urlsplit(url)
    key = f"{parts.scheme}://{parts.netloc}"
    with _guard:
        if key in _robots:
            return _robots[key]
    note = "no robots.txt"
    parser = None
    delay = None
    try:
        with _host_lock(parts.netloc):
            _pace(parts.netloc, MIN_INTERVAL)
            r = _raw_get(key + "/robots.txt", timeout=30, max_bytes=2_000_000)
        txt = r.body.decode("utf-8", "replace")
        if r.status == 200 and "<html" not in txt[:500].lower() and txt.strip():
            parser = urllib.robotparser.RobotFileParser()
            parser.parse(txt.splitlines())
            d = parser.crawl_delay(USER_AGENT) or parser.crawl_delay("*")
            delay = float(d) if d else None
            note = "robots.txt read"
        elif r.status in (401, 403):
            note = f"robots.txt answered HTTP {r.status} (treated as no rules; page requests decide)"
        else:
            note = f"robots.txt HTTP {r.status}" if r.status != 200 else "robots.txt empty or HTML"
    except Exception as err:  # unreadable robots.txt: allowed, as urllib.robotparser does for 4xx
        note = f"robots.txt unreadable: {str(err)[:120]}"
    with _guard:
        _robots[key] = (parser, delay, note)
    return _robots[key]


def robots_verdict(url: str) -> dict:
    parser, delay, note = robots(url)
    allowed = True if parser is None else parser.can_fetch(USER_AGENT, url)
    return {"allowed": allowed, "crawl_delay": delay, "note": note}


def _pace(host: str, interval: float) -> None:
    now = time.monotonic()
    wait = _last.get(host, 0.0) + interval - now
    if wait > 0:
        time.sleep(wait)
    _last[host] = time.monotonic()


def fetch(url: str, *, data: bytes | None = None, headers: dict | None = None, timeout: int = 90, retries: int = 3,
          interval: float = MIN_INTERVAL, check_robots: bool = True, max_bytes: int = MAX_BYTES) -> Response:
    """GET (POST when data is given) with robots, pacing and retries. 404 and other 4xx return without retrying."""
    if is_commercial(url):
        raise Blocked(f"commercial host refused: {url}")
    host = urllib.parse.urlsplit(url).netloc
    if check_robots:
        v = robots_verdict(url)
        if not v["allowed"]:
            raise Blocked(f"robots.txt disallows {url}")
        if v["crawl_delay"]:
            interval = max(interval, min(v["crawl_delay"], 30.0))
    last = None
    for attempt in range(retries + 1):
        with _host_lock(host):
            _pace(host, interval)
        try:
            r = _raw_get(url, data=data, headers=headers, timeout=timeout, max_bytes=max_bytes)
        except (urllib.error.URLError, TimeoutError, ConnectionError, ssl.SSLError, OSError) as err:
            last = repr(err)[:300]
            if attempt < retries:
                time.sleep(min(30, 3 * 2 ** attempt))
                continue
            raise RuntimeError(f"{url}: {last}") from None
        if r.status in (429, 500, 502, 503, 504) and attempt < retries:
            ra = r.headers.get("Retry-After")
            wait = int(ra) if ra and ra.isdigit() and int(ra) <= 120 else min(30, 3 * 2 ** attempt)
            time.sleep(wait)
            last = f"HTTP {r.status}"
            continue
        if is_commercial(r.final_url):
            raise Blocked(f"redirected to a commercial host: {r.final_url}")
        return r
    raise RuntimeError(f"{url}: {last}")


def store(rel: str, r: Response, *, keep: bool = True) -> dict:
    """Keep the unchanged body (gzip) under raw/<rel>.gz and append a manifest line; returns the line."""
    path = os.path.join(RAW, rel + ".gz")
    if keep:
        os.makedirs(os.path.dirname(path), exist_ok=True)
        with gzip.open(path, "wb", compresslevel=9) as handle:
            handle.write(r.body)
    entry = {"url": r.url, "final_url": r.final_url, "path": os.path.relpath(path, ROOT) if keep else None,
             "sha256": sha256(r.body), "bytes": len(r.body), "retrieved_at": utc_now(), "status": r.status,
             "content_type": r.content_type, "method": "urllib"}
    os.makedirs(ACQ, exist_ok=True)
    with _manifest_lock, open(MANIFEST, "a", encoding="utf-8") as handle:
        handle.write(json.dumps(entry, sort_keys=True) + "\n")
    return entry


def load_raw(entry: dict) -> bytes:
    """The unchanged body of a manifest entry, checked against its sha256."""
    with gzip.open(os.path.join(ROOT, entry["path"]), "rb") as handle:
        body = handle.read()
    if sha256(body) != entry["sha256"]:
        raise ValueError(f"sha256 mismatch for {entry['path']}")
    return body


def manifest(prefix: str = "") -> dict[str, dict]:
    """Latest manifest entry per stored path (optionally under raw/<prefix>)."""
    out: dict[str, dict] = {}
    if not os.path.exists(MANIFEST):
        return out
    want = os.path.relpath(os.path.join(RAW, prefix), ROOT) if prefix else ""
    with open(MANIFEST, encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                e = json.loads(line)
                if e.get("path") and e["path"].startswith(want):
                    out[e["path"]] = e
    return out


# ------------------------------------------------------------------------------------------- text renderings
class _Text(HTMLParser):
    BLOCK = {"p", "div", "br", "li", "tr", "td", "th", "h1", "h2", "h3", "h4", "h5", "h6", "table", "section", "article",
             "ul", "ol", "dd", "dt", "blockquote", "pre", "hr", "center"}
    SKIP = {"script", "style", "head", "noscript", "template", "svg", "title"}

    def __init__(self):
        super().__init__(convert_charrefs=True)
        self.out: list[str] = []
        self.skip = 0

    def handle_starttag(self, tag, attrs):
        if tag in self.SKIP:
            self.skip += 1
        elif tag in self.BLOCK:
            self.out.append("\n")

    def handle_startendtag(self, tag, attrs):
        if tag in self.BLOCK:
            self.out.append("\n")

    def handle_endtag(self, tag):
        if tag in self.SKIP:
            self.skip = max(0, self.skip - 1)
        elif tag in self.BLOCK:
            self.out.append("\n")

    def handle_data(self, data):
        if not self.skip:
            self.out.append(data)


def html_text(raw: bytes | str, content_type: str = "") -> str:
    """Plain-text rendering of an HTML page (stdlib parser): the reference every parsed quote is checked against."""
    s = raw if isinstance(raw, str) else decode(raw, content_type)
    p = _Text()
    p.feed(s)
    p.close()
    lines = [" ".join(line.replace("\xa0", " ").split()) for line in "".join(p.out).split("\n")]
    return "\n".join(line for line in lines if line)


def pdf_text(raw: bytes) -> str:
    """Plain-text rendering of a PDF: pdftotext -layout when installed, pypdf otherwise."""
    exe = shutil.which("pdftotext")
    if exe:
        with tempfile.TemporaryDirectory() as tmp:
            src = os.path.join(tmp, "in.pdf")
            with open(src, "wb") as handle:
                handle.write(raw)
            out = subprocess.run([exe, "-layout", "-enc", "UTF-8", src, "-"], capture_output=True, timeout=300)
            if out.returncode == 0:
                return out.stdout.decode("utf-8", "replace")
    import io

    from pypdf import PdfReader

    reader = PdfReader(io.BytesIO(raw))
    return "\n".join((page.extract_text() or "") for page in reader.pages)


def norm_ws(s: str | None) -> str:
    """Runs of whitespace (incl. no-break space) to one space, trimmed."""
    return " ".join((s or "").replace("\xa0", " ").split())


def squash(s: str) -> str:
    """Containment key: HTML entities decoded, typographic quotes/dashes folded, all whitespace removed."""
    s = htmlmod.unescape(s or "")
    s = s.translate(str.maketrans({"‘": "'", "’": "'", "“": '"', "”": '"', "–": "-",
                                   "—": "-", " ": " ", "­": None}))
    return re.sub(r"\s+", "", s)


def contained(needle: str, haystack_squashed: str, window: int = 80) -> tuple[bool, float]:
    """(every line found in order, share of lines found) of a parsed text in a squashed reference rendering.

    Each line of the stored text (a block of the publisher's layout) must occur verbatim, whitespace aside, in the
    reference, after the previous line's match. Navigation glyphs a parser leaves out (permalink marks, buttons) may sit
    between two lines in the reference; they never sit inside a line. A line longer than `window` squashed characters
    that is not found whole is scored by its windows, so the share reflects how much of it was found."""
    lines = [squash(line) for line in (needle or "").split("\n")]
    lines = [x for x in lines if x]
    if not lines:
        return False, 0.0
    pos = 0
    found = 0.0
    for x in lines:
        i = haystack_squashed.find(x, pos)
        if i >= 0:
            found += 1
            pos = i + len(x)
            continue
        if len(x) > window:
            parts = [x[j:j + window] for j in range(0, len(x), window)]
            found += sum(1 for p in parts if p in haystack_squashed) / len(parts) * 0.99
    share = found / len(lines)
    return share == 1.0, share


def write_jsonl_gz(path: str, rows) -> tuple[int, str]:
    """Write rows as gzip JSON lines; returns (count, sha256 of the uncompressed bytes)."""
    os.makedirs(os.path.dirname(path), exist_ok=True)
    h = hashlib.sha256()
    n = 0
    with gzip.open(path, "wb", compresslevel=9) as handle:
        for row in rows:
            line = (json.dumps(row, ensure_ascii=False, sort_keys=True) + "\n").encode()
            h.update(line)
            handle.write(line)
            n += 1
    return n, h.hexdigest()


def read_jsonl_gz(path: str):
    with gzip.open(path, "rt", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                yield json.loads(line)
