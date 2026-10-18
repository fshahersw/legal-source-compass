"""Acquire JPML pending-MDL monthly reports (archive + current month) and statistics-info files, bytes unchanged.

Usage:
  python3 -I -B acquire_jpml_history.py pages      # fetch the index pages only
  python3 -I -B acquire_jpml_history.py reports    # fetch every PDF the archive / current page lists
  python3 -I -B acquire_jpml_history.py stats      # fetch every file the statistics-info page links
  python3 -I -B acquire_jpml_history.py wayback    # discover pre-archive reports via the Wayback CDX API

Rules followed: official host first; robots.txt Crawl-delay (10 s) honoured between requests to jpml.uscourts.gov;
retries with backoff; files already in the manifest with HTTP 200 and an existing file are not refetched.
Manifest: private/acq/jpml_history/_manifest.jsonl (url, path, sha256, bytes, retrieved_at, status, method, ...).
"""
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
ACQ = ROOT / "private" / "acq" / "jpml_history"
MANIFEST = ACQ / "_manifest.jsonl"
UA = "legal-source-compass research (Seeger Weiss internal research)"
JPML = "https://www.jpml.uscourts.gov"
PAGES = {
    "archive": f"{JPML}/pending-mdl-reports-archive",
    "current": f"{JPML}/pending-mdls-0",
    "statistics": f"{JPML}/statistics-info",
    # the statistics view is paginated (Drupal pager: "Pages 1 2 3 4"); every page is read
    "statistics_p1": f"{JPML}/statistics-info?page=1",
    "statistics_p2": f"{JPML}/statistics-info?page=2",
    "statistics_p3": f"{JPML}/statistics-info?page=3",
}
STAT_PAGES = ("statistics", "statistics_p1", "statistics_p2", "statistics_p3")
HOST_DELAY = {"www.jpml.uscourts.gov": 10.0, "web.archive.org": 1.5}
_last = {}


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def manifest_entries():
    if not MANIFEST.exists():
        return []
    return [json.loads(line) for line in MANIFEST.read_text().splitlines() if line.strip()]


def append_manifest(entry):
    with MANIFEST.open("a") as fh:
        fh.write(json.dumps(entry, sort_keys=True) + "\n")


def polite_get(url, timeout=120):
    host = urllib.parse.urlparse(url).netloc
    wait = HOST_DELAY.get(host, 1.0) - (time.monotonic() - _last.get(host, -1e9))
    if wait > 0:
        time.sleep(wait)
    last_error = None
    for attempt in range(4):
        _last[host] = time.monotonic()
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return resp.status, resp.read(), resp.headers.get("Content-Type", "")
        except urllib.error.HTTPError as err:
            if err.code in (429, 500, 502, 503, 504) and attempt < 3:
                last_error = err.code
                time.sleep(HOST_DELAY.get(host, 1.0) * (2 ** attempt))
                continue
            return err.code, b"", ""
        except (urllib.error.URLError, TimeoutError, ConnectionError) as err:
            last_error = str(err)
            time.sleep(HOST_DELAY.get(host, 1.0) * (2 ** attempt))
    return 0, b"", f"error: {last_error}"


def save(url, sub, name, method, extra=None, refresh=False):
    """Fetch url into ACQ/sub/name (bytes unchanged) unless a 200 manifest entry with that file already exists."""
    rel = f"{sub}/{name}"
    path = ACQ / rel
    if not refresh:
        for e in manifest_entries():
            if e["url"] == url and e["path"] == rel and e["status"] == 200 and path.exists():
                return e
    status, body, ctype = polite_get(url)
    entry = {"url": url, "path": rel, "status": status, "retrieved_at": now(), "method": method, "content_type": ctype}
    if status == 200 and body:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(body)
        entry.update({"sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body)})
    else:
        entry.update({"sha256": None, "bytes": 0})
    if extra:
        entry.update(extra)
    append_manifest(entry)
    print(json.dumps({k: entry[k] for k in ("url", "status", "bytes")}), flush=True)
    return entry


def page_links(html: bytes, base: str):
    from bs4 import BeautifulSoup  # local import: only acquisition needs it

    soup = BeautifulSoup(html, "lxml")
    out = []
    for a in soup.find_all("a", href=True):
        href = urllib.parse.urljoin(base, a["href"].strip())
        out.append({"text": " ".join(a.get_text(" ").split()), "url": href})
    return out


def safe_name(url):
    name = Path(urllib.parse.unquote(urllib.parse.urlparse(url).path)).name
    return "".join(c if c.isalnum() or c in "-_." else "_" for c in name)


def fetch_pages(keys=None):
    for key, url in PAGES.items():
        if keys and key not in keys:
            continue
        save(url, "pages", f"{key}.html", "direct HTTPS GET (index page)", {"page": key}, refresh=True)


def latest_page(key):
    hits = [e for e in manifest_entries() if e.get("page") == key and e["status"] == 200]
    return (ACQ / hits[-1]["path"]).read_bytes() if hits else None


def report_targets():
    targets = {}
    for key in ("archive", "current"):
        html = latest_page(key)
        if html is None:
            raise SystemExit(f"page {key} not fetched; run 'pages' first")
        for link in page_links(html, PAGES[key]):
            u = link["url"]
            if "/sites/jpml/files/" in u and u.lower().endswith(".pdf") and re.search(r"Pending_MDL|Terminated", u, re.I):
                targets.setdefault(u, {"link_text": link["text"], "listed_on": key})
    return targets


def fetch_reports():
    targets = report_targets()
    print(json.dumps({"targets": len(targets)}), flush=True)
    for url, meta in sorted(targets.items()):
        save(url, "reports", safe_name(url), "direct HTTPS GET (link on JPML page)", meta)


def stats_targets():
    from bs4 import BeautifulSoup

    targets = {}
    for key in STAT_PAGES:
        html = latest_page(key)
        if html is None:
            raise SystemExit(f"page {key} not fetched; run 'pages' first")
        soup = BeautifulSoup(html, "lxml")
        for tr in soup.find_all("tr"):
            cells = tr.find_all("td")
            a = tr.find("a", href=True)
            if len(cells) < 2 or not a:
                continue
            u = urllib.parse.urljoin(PAGES[key], a["href"].strip())
            if "/sites/jpml/files/" in u:
                targets.setdefault(u, {"link_text": " ".join(a.get_text(" ").split()), "stat_type": " ".join(cells[0].get_text(" ").split()), "listed_on": key})
    return targets


def fetch_stats():
    targets = stats_targets()
    print(json.dumps({"targets": len(targets)}), flush=True)
    for u, meta in sorted(targets.items()):
        save(u, "statistics", safe_name(u), "direct HTTPS GET (link on statistics-info)", meta)


CDX = "https://web.archive.org/cdx/search/cdx"


def wayback():
    """Discovery only: list captured URLs of pre-archive monthly reports (CDX API) and save the CDX response."""
    q = urllib.parse.urlencode({
        "url": "jpml.uscourts.gov/sites/jpml/files/Pending_MDL_Dockets_By",
        "matchType": "prefix", "output": "json", "fl": "original,timestamp,statuscode,mimetype,digest,length",
        "filter": "statuscode:200", "collapse": "urlkey", "limit": "20000",
    })
    save(f"{CDX}?{q}", "wayback", "cdx_pending_mdl_dockets.json", "Wayback Machine CDX API (discovery)", {"page": "wayback_cdx"}, refresh=True)


if __name__ == "__main__":
    ACQ.mkdir(parents=True, exist_ok=True)
    if sys.argv[1] == "pages":
        fetch_pages(set(sys.argv[2:]) or None)
    else:
        {"reports": fetch_reports, "stats": fetch_stats, "wayback": wayback}[sys.argv[1]]()
