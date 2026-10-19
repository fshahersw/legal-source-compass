"""Fetch publicly served (logged-out) pages and data files for the SCAC stream.

Polite: one request per host per >= 1.2 s, identifying User-Agent, bounded retries with backoff, robots.txt checked
for every path. Raw response bytes are stored unchanged under private/acq/scac/raw/ and every response is recorded in
private/acq/scac/_manifest.jsonl (url, path, sha256, bytes, retrieved_at UTC, http status, method).

No account is created and no login is attempted. A page that redirects to a login or returns 401/403 is recorded
as such (the status goes into the manifest) and nothing further is requested on that path.

Usage:
  python3 -I -B fetch.py urls <url> [<url> ...]      fetch listed URLs (https only)
  python3 -I -B fetch.py file <path-to-url-list>     one URL per line (# comments allowed)
"""
import hashlib
import json
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import urllib.robotparser
from datetime import datetime, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[2]
ACQ = ROOT / "private" / "acq" / "scac"
RAW = ACQ / "raw"
MANIFEST = ACQ / "_manifest.jsonl"
USER_AGENT = "legal-source-compass research (contact: notreelai@gmail.com)"
MIN_INTERVAL = 1.2
ALLOWED_HOSTS = {"securities.stanford.edu", "fred.stlouisfed.org", "mba.tuck.dartmouth.edu"}

_last_request = {}
_robots = {}


def utc_now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def local_name(url):
    """Deterministic file name for a URL: host/path (+ query hash when present)."""
    parts = urllib.parse.urlsplit(url)
    path = parts.path.strip("/") or "index"
    name = path.replace("/", "__")
    if parts.query:
        name += "__q_" + hashlib.sha256(parts.query.encode()).hexdigest()[:10]
    if "." not in name.rsplit("__", 1)[-1]:
        name += ".bin"
    return f"{parts.hostname}/{name}"


def robots_allows(url):
    parts = urllib.parse.urlsplit(url)
    host = parts.hostname
    if host not in _robots:
        rp = urllib.robotparser.RobotFileParser()
        robots_url = f"https://{host}/robots.txt"
        try:
            request = urllib.request.Request(robots_url, headers={"User-Agent": USER_AGENT})
            with urllib.request.urlopen(request, timeout=40) as response:
                rp.parse(response.read().decode("utf-8", "replace").splitlines())
        except urllib.error.HTTPError as error:
            # 4xx robots.txt means no restrictions are published; 5xx we treat as "disallow all" to be safe.
            rp.parse([] if 400 <= error.code < 500 else ["User-agent: *", "Disallow: /"])
        except urllib.error.URLError:
            rp.parse(["User-agent: *", "Disallow: /"])
        _robots[host] = rp
    return _robots[host].can_fetch(USER_AGENT, url)


def throttle(host):
    wait = MIN_INTERVAL - (time.monotonic() - _last_request.get(host, 0))
    if wait > 0:
        time.sleep(wait)
    _last_request[host] = time.monotonic()


def fetch(url, *, method_label="direct-urllib"):
    parts = urllib.parse.urlsplit(url)
    if parts.scheme != "https" or parts.hostname not in ALLOWED_HOSTS:
        raise ValueError(f"host/scheme not allowed: {url}")
    if not robots_allows(url):
        record = {"url": url, "path": None, "sha256": None, "bytes": 0, "retrieved_at": utc_now(), "http_status": None, "method": "skipped-robots-disallow"}
        append_manifest(record)
        return record
    body, status, final_url, content_type = b"", None, url, None
    for attempt in range(4):
        throttle(parts.hostname)
        request = urllib.request.Request(url, headers={"User-Agent": USER_AGENT, "Accept": "*/*"})
        try:
            with urllib.request.urlopen(request, timeout=60) as response:
                body = response.read()
                status = response.status
                final_url = response.geturl()
                content_type = response.headers.get("Content-Type")
            break
        except urllib.error.HTTPError as error:
            status = error.code
            body = error.read()
            final_url = error.geturl()
            content_type = error.headers.get("Content-Type") if error.headers else None
            if error.code in (429, 500, 502, 503, 504) and attempt < 3:
                time.sleep(3 * 2 ** attempt)
                continue
            break
        except urllib.error.URLError:
            if attempt < 3:
                time.sleep(3 * 2 ** attempt)
                continue
            raise
    rel = local_name(url)
    path = RAW / rel
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(body)
    record = {
        "url": url,
        "final_url": final_url,
        "path": str(path.relative_to(ROOT)),
        "sha256": hashlib.sha256(body).hexdigest(),
        "bytes": len(body),
        "retrieved_at": utc_now(),
        "http_status": status,
        "content_type": content_type,
        "method": method_label,
    }
    append_manifest(record)
    return record


def append_manifest(record):
    ACQ.mkdir(parents=True, exist_ok=True)
    with MANIFEST.open("a", encoding="utf-8") as handle:
        handle.write(json.dumps(record, sort_keys=True) + "\n")


def main(argv):
    if len(argv) < 3 or argv[1] not in ("urls", "file"):
        print(__doc__)
        return 2
    urls = argv[2:] if argv[1] == "urls" else [
        line.strip() for line in Path(argv[2]).read_text().splitlines() if line.strip() and not line.startswith("#")
    ]
    for url in urls:
        record = fetch(url)
        print(json.dumps({k: record.get(k) for k in ("url", "http_status", "bytes", "path", "final_url")}))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv))
