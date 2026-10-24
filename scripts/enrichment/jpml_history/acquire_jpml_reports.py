"""Acquire the JPML statistics pages and every report file they link (wave 1026), bytes unchanged, stored gzipped.

Usage (from the repository root):
  python3 -I -B scripts/enrichment/jpml_history/acquire_jpml_reports.py robots
  python3 -I -B scripts/enrichment/jpml_history/acquire_jpml_reports.py pages
  python3 -I -B scripts/enrichment/jpml_history/acquire_jpml_reports.py targets      # list linked files, no fetch
  python3 -I -B scripts/enrichment/jpml_history/acquire_jpml_reports.py files        # fetch files not held yet

Storage: private/acq/jpml_reports/<sub>/<name>.gz (gzip of the original bytes) and _manifest.jsonl with
url, path, sha256 (of the ORIGINAL bytes), bytes (original length), gz_bytes, retrieved_at (UTC), status, method,
content_type. A file already held under private/acq/jpml_history/ (wave 1018 acquisition, same URL, sha256 recorded
there) is not fetched again; it is listed in the manifest as `reused` with that file's path and sha256.

Politeness: one request at a time; the delay between requests to the host is the larger of 1 second and the
Crawl-delay in the host's robots.txt (read first); retries with backoff on 429/5xx; never retried through another
route on 403.
"""
import gzip
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
ACQ = ROOT / "private" / "acq" / "jpml_reports"
OLD = ROOT / "private" / "acq" / "jpml_history"
MANIFEST = ACQ / "_manifest.jsonl"
UA = "LegalSourceAtlas/1.0 (research; official court statistics)"
JPML = "https://www.jpml.uscourts.gov"
PAGES = {
    "pending_current": f"{JPML}/pending-mdls-0",
    "pending_archive": f"{JPML}/pending-mdl-reports-archive",
    "quarterly_caseload": f"{JPML}/mdl-quarterly-caseload-summary",
    "statistics": f"{JPML}/statistics-info",
}
_last = {}
_delay = {"www.jpml.uscourts.gov": 10.0}  # replaced by the robots.txt value when `robots` has run


def now():
    return datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def manifest_entries(path=MANIFEST):
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def append_manifest(entry):
    ACQ.mkdir(parents=True, exist_ok=True)
    with MANIFEST.open("a") as fh:
        fh.write(json.dumps(entry, sort_keys=True) + "\n")


def load_delay():
    for e in reversed(manifest_entries()):
        if e.get("page") == "robots" and e.get("status") == 200:
            txt = gzip.decompress((ACQ / e["path"]).read_bytes()).decode("utf-8", "replace")
            m = re.search(r"(?im)^crawl-delay:\s*([0-9.]+)", txt)
            if m:
                _delay["www.jpml.uscourts.gov"] = max(1.0, float(m.group(1)))
            return txt
    return None


def polite_get(url, timeout=120):
    host = urllib.parse.urlparse(url).netloc
    delay = _delay.get(host, 1.0)
    wait = delay - (time.monotonic() - _last.get(host, -1e9))
    if wait > 0:
        time.sleep(wait)
    last_error = None
    for attempt in range(4):
        _last[host] = time.monotonic()
        req = urllib.request.Request(url, headers={"User-Agent": UA, "Accept": "*/*", "Accept-Encoding": "gzip"})
        try:
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                body = resp.read()
                if (resp.headers.get("Content-Encoding") or "").lower() == "gzip":
                    body = gzip.decompress(body)
                return resp.status, body, resp.headers.get("Content-Type", ""), resp.geturl()
        except urllib.error.HTTPError as err:
            if err.code in (429, 500, 502, 503, 504) and attempt < 3:
                last_error = err.code
                time.sleep(delay * (2 ** attempt))
                continue
            return err.code, b"", "", url
        except (urllib.error.URLError, TimeoutError, ConnectionError) as err:
            last_error = str(err)
            time.sleep(delay * (2 ** attempt))
    return 0, b"", f"error: {last_error}", url


def store(url, sub, name, method, extra=None):
    status, body, ctype, final = polite_get(url)
    rel = f"{sub}/{name}.gz"
    entry = {"url": url, "final_url": final, "path": rel, "status": status, "retrieved_at": now(), "method": method,
             "content_type": ctype}
    if status == 200 and body:
        path = ACQ / rel
        path.parent.mkdir(parents=True, exist_ok=True)
        gz = gzip.compress(body, compresslevel=9, mtime=0)
        path.write_bytes(gz)
        entry.update({"sha256": hashlib.sha256(body).hexdigest(), "bytes": len(body), "gz_bytes": len(gz)})
    else:
        entry.update({"sha256": None, "bytes": 0})
    if extra:
        entry.update(extra)
    append_manifest(entry)
    print(json.dumps({k: entry.get(k) for k in ("url", "status", "bytes")}), flush=True)
    return entry


def read_held(entry):
    """Original bytes of a manifest entry (gzipped in jpml_reports, plain in jpml_history)."""
    if entry.get("reused_from"):
        return (OLD / entry["reused_from"]).read_bytes()
    return gzip.decompress((ACQ / entry["path"]).read_bytes())


def latest_page(key):
    hits = [e for e in manifest_entries() if e.get("page") == key and e["status"] == 200]
    return (hits[-1], read_held(hits[-1])) if hits else (None, None)


def safe_name(url):
    name = Path(urllib.parse.unquote(urllib.parse.urlparse(url).path)).name
    return "".join(c if c.isalnum() or c in "-_." else "_" for c in name)


def page_links(html, base):
    from bs4 import BeautifulSoup

    soup = BeautifulSoup(html, "lxml")
    out = []
    for a in soup.find_all("a", href=True):
        href = urllib.parse.urljoin(base, a["href"].strip())
        row = a.find_parent("tr")
        cells = [" ".join(td.get_text(" ").split()) for td in row.find_all("td")] if row else []
        out.append({"text": " ".join(a.get_text(" ").split()), "url": href, "row": cells})
    return out


def pager_urls(html, base):
    """Further pages of a paginated listing (Drupal pager ?page=N)."""
    pages = set()
    for link in page_links(html, base):
        u = link["url"]
        if u.split("?")[0] == base.split("?")[0] and re.search(r"[?&]page=\d+", u):
            pages.add(u)
    return sorted(pages, key=lambda u: int(re.search(r"page=(\d+)", u).group(1)))


def fetch_robots():
    store(f"{JPML}/robots.txt", "pages", "robots.txt", "direct HTTPS GET (robots.txt)", {"page": "robots"})


def fetch_pages():
    load_delay()
    for key, url in PAGES.items():
        e = store(url, "pages", f"{key}.html", "direct HTTPS GET (index page)", {"page": key})
        if e["status"] != 200:
            continue
        html = read_held(e)
        for i, pu in enumerate(pager_urls(html, url)):
            n = re.search(r"page=(\d+)", pu).group(1)
            store(pu, "pages", f"{key}_p{n}.html", "direct HTTPS GET (index page, pager)", {"page": f"{key}_p{n}"})


def targets():
    out = {}
    keys = sorted({e["page"] for e in manifest_entries() if e.get("page") and e["page"] != "robots"})
    for key in keys:
        entry, html = latest_page(key)
        if html is None:
            continue
        for link in page_links(html, entry["url"]):
            u = link["url"]
            if "/sites/jpml/files/" in u:
                out.setdefault(u, {"link_text": link["text"], "listed_on": key, "row": link["row"]})
    return out


def old_index():
    idx = {}
    for e in manifest_entries(OLD / "_manifest.jsonl"):
        if e.get("status") == 200 and e.get("sha256") and (OLD / e["path"]).exists():
            idx[e["url"]] = e
    return idx


def fetch_files(dry=False):
    load_delay()
    held = {e["url"] for e in manifest_entries() if e.get("status") == 200 and e.get("sha256") and not e.get("page")}
    old = old_index()
    t = targets()
    todo = []
    for u, meta in sorted(t.items()):
        if u in held:
            continue
        sub = "reports" if re.search(r"Pending_MDL|Terminated_Litigations-|Recently_Terminated", u, re.I) else "files"
        if u in old:
            o = old[u]
            data = (OLD / o["path"]).read_bytes()
            if hashlib.sha256(data).hexdigest() != o["sha256"]:
                raise SystemExit(f"held file changed: {o['path']}")
            if not dry:
                append_manifest({"url": u, "path": None, "reused_from": o["path"], "status": 200, "sha256": o["sha256"],
                                 "bytes": o["bytes"], "retrieved_at": o["retrieved_at"], "method": "reused (wave 1018 acquisition, sha256 re-verified)",
                                 "verified_at": now(), **meta})
            continue
        todo.append((u, sub, meta))
    print(json.dumps({"targets": len(t), "already_held": len(held), "reused": len([u for u in t if u in old and u not in held]), "to_fetch": len(todo)}), flush=True)
    for u, sub, meta in todo:
        print("TODO" if dry else "GET", u, flush=True)
        if not dry:
            store(u, sub, safe_name(u), "direct HTTPS GET (link on JPML page)", meta)


def fetch_discovered():
    """Fetch the official report URLs listed in discovered_urls.json (found by site search; no longer linked from the
    archive page) directly from jpml.uscourts.gov. A URL already answered (any status) is not requested again."""
    load_delay()
    listed = json.loads((ACQ / "discovered_urls.json").read_text())
    done = {e["url"] for e in manifest_entries() if e.get("listed_on") == "site_search_discovery"}
    held = {e["url"] for e in manifest_entries() if e.get("status") == 200 and e.get("sha256")}
    todo = [u for u in listed["urls"] if u not in done and u not in held and urllib.parse.urlparse(u).netloc == "www.jpml.uscourts.gov"]
    print(json.dumps({"listed": len(listed["urls"]), "to_fetch": len(todo)}), flush=True)
    for u in todo:
        store(u, "reports_unlisted", safe_name(u), "direct HTTPS GET (official URL found by site search; not linked from the archive page)",
              {"listed_on": "site_search_discovery", "discovered_at": listed["discovered_at"]})


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "discovered":
        fetch_discovered()
    if cmd == "robots":
        fetch_robots()
        print(load_delay())
    elif cmd == "pages":
        fetch_pages()
    elif cmd == "targets":
        fetch_files(dry=True)
    elif cmd == "files":
        fetch_files()
