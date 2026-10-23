"""Shared helpers for the safety/1 builders (scripts/safety_v2). Standard library only.

Paths: build outputs under private/build/w1025_safety/<stream>/, small acquisition captures under
private/acq/w1025_safety/<stream>/. Every network response the builders keep is logged in a manifest line
{url (never a key), status, bytes, sha256, retrieved_at}. Chunk files are gzip NDJSON, one loader call each
(scripts/safety_v2/load.py posts them to public.safety_load_v1).
"""
import gzip
import hashlib
import io
import json
import os
import re
import threading
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import date, datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
BUILD = ROOT / "private" / "build" / "w1025_safety"
ACQ = ROOT / "private" / "acq" / "w1025_safety"
UA = "LegalSourceAtlas research contact@legal-source-atlas.example"
OPENFDA = "https://api.fda.gov/"
KEY_PARAM = re.compile(r"([?&])(api_key|apikey|access_token)=[^&]*", re.I)


def utc_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def public_url(url):
    """The URL as it may be recorded: any credential parameter removed."""
    out = KEY_PARAM.sub(lambda m: m.group(1), url)
    return out.replace("?&", "?").rstrip("?&")


def sha256_bytes(b):
    return hashlib.sha256(b).hexdigest()


def sha256_file(path):
    h = hashlib.sha256()
    with open(path, "rb") as f:
        for block in iter(lambda: f.read(1 << 20), b""):
            h.update(block)
    return h.hexdigest()


class Http:
    """Polite GET/POST: a minimum interval per host, retries on 429/5xx/network errors, a request log.

    The log keeps public URLs only (credential parameters removed) with status, bytes, sha256 and retrieval time.
    """

    def __init__(self, min_interval=0.5, log_path=None, timeout=120):
        self.min_interval = min_interval
        self.last = {}
        self.log_path = Path(log_path) if log_path else None
        self.timeout = timeout
        self.requests = 0
        self.lock = threading.Lock()

    def _wait(self, url):
        """Thread-safe: requests to one host start at least min_interval apart, whatever the number of threads."""
        host = urllib.parse.urlparse(url).netloc
        with self.lock:
            now = time.time()
            start = max(now, self.last.get(host, 0) + self.min_interval)
            self.last[host] = start
            self.requests += 1
        if start > now:
            time.sleep(start - now)

    def _log(self, url, status, body):
        if not self.log_path:
            return
        line = json.dumps({"url": public_url(url), "status": status, "bytes": len(body or b""),
                           "sha256": sha256_bytes(body or b""), "retrieved_at": utc_now()}) + "\n"
        with self.lock:
            self.log_path.parent.mkdir(parents=True, exist_ok=True)
            with open(self.log_path, "a") as f:
                f.write(line)

    def request(self, url, data=None, headers=None, method=None, allow=(404,)):
        hdrs = {"User-Agent": UA, "Accept": "application/json"}
        hdrs.update(headers or {})
        for attempt in range(6):
            self._wait(url)
            req = urllib.request.Request(url, data=data, headers=hdrs, method=method or ("POST" if data else "GET"))
            try:
                with urllib.request.urlopen(req, timeout=self.timeout) as resp:
                    body = resp.read()
                    self._log(url, resp.status, body)
                    return resp.status, body
            except urllib.error.HTTPError as err:
                body = err.read()
                if err.code in allow:
                    self._log(url, err.code, body)
                    return err.code, body
                if err.code in (429, 500, 502, 503, 504) and attempt < 5:
                    time.sleep(min(120, (2 ** attempt) * (10 if err.code == 429 else 2)))
                    continue
                self._log(url, err.code, body)
                raise RuntimeError(f"{public_url(url)} -> HTTP {err.code}: {body[:300]!r}") from None
            except (urllib.error.URLError, TimeoutError, ConnectionError):
                if attempt < 5:
                    time.sleep(2 ** attempt * 2)
                    continue
                raise


# ------------------------------------------------------------------------------------------------ openFDA
def openfda_query(path, search=None, count=None, limit=None, skip=None, sort=None, search_after=None):
    """openFDA query string. '+' separates clauses and must stay literal; spaces become %20, '&' and '#' are encoded.

    The search expression is kept exactly as stored (it is the reproducible definition of a subject)."""
    parts = []
    if search:
        parts.append("search=" + search.replace("%", "%25").replace(" ", "%20").replace("&", "%26").replace("#", "%23"))
    if count:
        parts.append("count=" + count)
    if sort:
        parts.append("sort=" + sort)
    if limit is not None:
        parts.append(f"limit={int(limit)}")
    if skip:
        parts.append(f"skip={int(skip)}")
    if search_after:
        parts.append("search_after=" + urllib.parse.quote(search_after, safe=""))
    return f"{OPENFDA}{path}?" + "&".join(parts)


def openfda_get(http, url, key=None):
    """GET an openFDA URL (the key, when given, is appended only for the request). Returns (json | None, public_url).
    None means openFDA answered 404 "No matches found" (zero matching reports)."""
    full = url + (("&" if "?" in url else "?") + "api_key=" + key if key else "")
    status, body = http.request(full)
    if status == 404:
        return None, public_url(url)
    return json.loads(body.decode("utf-8")), public_url(url)


def openfda_key():
    """DATA_GOV_API_KEY (api.data.gov keys work as openFDA keys); never printed."""
    return os.environ.get("DATA_GOV_API_KEY") or None


def day_counts_to_months(results):
    """openFDA count=<date field> results [{time: YYYYMMDD, count}] → {YYYY-MM: summed count}."""
    out = {}
    for r in results or []:
        t = str(r.get("time", ""))
        if not re.fullmatch(r"(19|20)\d{6}", t):
            continue
        m = f"{t[:4]}-{t[4:6]}"
        out[m] = out.get(m, 0) + int(r["count"])
    return dict(sorted(out.items()))


def month_add(m, k):
    y, mo = int(m[:4]), int(m[5:7])
    idx = y * 12 + (mo - 1) + k
    return f"{idx // 12:04d}-{idx % 12 + 1:02d}"


def month_span(a, b):
    out, m = [], a
    while m <= b:
        out.append(m)
        m = month_add(m, 1)
    return out


def quarter_of(month):
    return f"{month[:4]}-Q{(int(month[5:7]) - 1) // 3 + 1}"


def quarter_bounds(q):
    y, n = int(q[:4]), int(q[-1])
    start = date(y, 3 * (n - 1) + 1, 1)
    end_month = 3 * n
    end = date(y + (end_month // 12), end_month % 12 + 1, 1) if end_month < 12 else date(y + 1, 1, 1)
    from datetime import timedelta
    return start.strftime("%Y%m%d"), (end - timedelta(days=1)).strftime("%Y%m%d")


def slug(text, limit=80):
    s = re.sub(r"[^A-Za-z0-9._-]+", "-", text.strip().lower()).strip("-._")
    return s[:limit].rstrip("-._") or "x"


# ------------------------------------------------------------------------------------------------ chunk output
class ChunkWriter:
    """gzip NDJSON chunks of at most `max_rows` rows for one loader target; groups are never split across chunks.

    Each chunk file `<target>-NNNNN.jsonl.gz` is one call of public.safety_load_v1(target, rows, opts). The writer
    keeps a manifest entry per chunk (rows, sha256 of the uncompressed NDJSON, opts)."""

    def __init__(self, outdir, target, max_rows=5000, opts=None, source=None):
        self.outdir = Path(outdir)
        self.outdir.mkdir(parents=True, exist_ok=True)
        self.target = target
        self.max_rows = max_rows
        self.opts = opts or {}
        self.source = source
        self.buf = []
        self.chunks = []
        self.rows = 0
        self.lock = threading.RLock()

    def add_group(self, rows):
        rows = list(rows)
        if not rows:
            return
        if len(rows) > self.max_rows:
            raise ValueError(f"{self.target}: a group of {len(rows)} rows exceeds one chunk")
        with self.lock:
            if len(self.buf) + len(rows) > self.max_rows:
                self._flush()
            self.buf.extend(rows)

    def add(self, row):
        self.add_group([row])

    def flush(self):
        with self.lock:
            self._flush()

    def _flush(self):
        if not self.buf:
            return
        n = len(self.chunks) + 1
        path = self.outdir / f"{self.target}-{n:05d}.jsonl.gz"
        text = "".join(json.dumps(r, ensure_ascii=False, sort_keys=True, separators=(",", ":")) + "\n" for r in self.buf)
        data = text.encode("utf-8")
        with gzip.open(path, "wb", compresslevel=6) as f:
            f.write(data)
        self.chunks.append({"file": path.name, "target": self.target, "rows": len(self.buf), "sha256": sha256_bytes(data),
                            "opts": self.opts, "source": self.source, "bytes_gz": path.stat().st_size})
        self.rows += len(self.buf)
        self.buf = []

    def close(self):
        self.flush()
        return {"target": self.target, "rows": self.rows, "chunks": self.chunks}


def read_chunk(path):
    with gzip.open(path, "rb") as f:
        data = f.read()
    rows = [json.loads(line) for line in data.decode("utf-8").splitlines() if line.strip()]
    return rows, sha256_bytes(data)


def write_manifest(outdir, stream, outputs, inputs, notes=None):
    """Manifest of one build: outputs per target (rows, chunks with sha256), inputs (URLs/files with sha256), notes."""
    outdir = Path(outdir)
    manifest = {"stream": stream, "built_at": utc_now(), "outputs": outputs, "inputs": inputs, "notes": notes or {}}
    (outdir / "manifest.json").write_text(json.dumps(manifest, indent=1, sort_keys=True))
    return manifest


def iso(d):
    """YYYYMMDD → YYYY-MM-DD (None when not a plausible date)."""
    d = (d or "").strip()
    if not re.fullmatch(r"(19|20)\d{6}", d):
        return None
    try:
        return date(int(d[:4]), int(d[4:6]), int(d[6:8])).isoformat()
    except ValueError:
        return None


class RangeFile(io.RawIOBase):
    """A seekable read-only view of a remote file through HTTP Range requests (for zipfile on large official archives,
    so only the bytes read cross the network and nothing is stored). Refuses a server that ignores Range or an archive
    replaced while it is read (If-Range on Last-Modified)."""

    def __init__(self, url, block=8 << 20, min_interval=0.5):
        self.url, self.pos, self.block, self.min_interval = url, 0, block, min_interval
        self.cache_start, self.cache, self.requests = -1, b"", 0
        req = urllib.request.Request(url, method="HEAD", headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=60) as resp:
            self.size = int(resp.headers["Content-Length"])
            self.last_modified = resp.headers.get("Last-Modified")
            if (resp.headers.get("Accept-Ranges") or "").lower() != "bytes":
                raise RuntimeError(f"{url} does not accept byte ranges")

    def seekable(self):
        return True

    def readable(self):
        return True

    def tell(self):
        return self.pos

    def seek(self, offset, whence=0):
        self.pos = offset if whence == 0 else self.pos + offset if whence == 1 else self.size + offset
        return self.pos

    def _fetch(self, start, end):
        for attempt in range(8):
            time.sleep(self.min_interval)
            headers = {"User-Agent": UA, "Range": f"bytes={start}-{end}"}
            if self.last_modified:
                headers["If-Range"] = self.last_modified
            try:
                with urllib.request.urlopen(urllib.request.Request(self.url, headers=headers), timeout=300) as resp:
                    self.requests += 1
                    if resp.status != 206:
                        raise RuntimeError(f"server answered {resp.status} to a Range request (archive replaced?)")
                    return resp.read()
            except Exception:  # noqa: BLE001 - network hiccups: retry with backoff, then raise
                if attempt == 7:
                    raise
                time.sleep(min(60, 2 ** (attempt + 1)))

    def read(self, n=-1):
        if n is None or n < 0:
            n = self.size - self.pos
        n = min(n, self.size - self.pos)
        if n <= 0:
            return b""
        if not (self.cache_start <= self.pos and self.pos + n <= self.cache_start + len(self.cache)):
            end = min(self.size - 1, self.pos + max(n, self.block) - 1)
            self.cache, self.cache_start = self._fetch(self.pos, end), self.pos
        off = self.pos - self.cache_start
        data = self.cache[off:off + n]
        self.pos += len(data)
        return data

    def readinto(self, buffer):
        data = self.read(len(buffer))
        buffer[:len(data)] = data
        return len(data)
