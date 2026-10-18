"""Acquire raw official CPSC files for the cpsc_catalog stream (bytes kept unchanged).

Usage:
  python3 -I -B scripts/enrichment/cpsc_catalog/acquire.py recalls            # Recall API, one JSON window per year
  python3 -I -B scripts/enrichment/cpsc_catalog/acquire.py files <list.txt>   # cpsc.gov s3fs-public PDFs (one URL per line)
  python3 -I -B scripts/enrichment/cpsc_catalog/acquire.py record <url> <path> <method> [status]
                                                                              # add a manifest line for a file saved by
                                                                              # another tool (e.g. a Firecrawl page read)

Every saved file gets one line in private/acq/cpsc_catalog/_manifest.jsonl:
  {url, path, sha256, bytes, retrieved_at (UTC), status, method}
Owner hold: NEISS case records, NEISS query-builder exports and SaferProducts.gov incident reports are never
requested here; `files` refuses URLs that point at them.
"""
import datetime as dt
import hashlib
import json
import os
import re
import sys
import time
import urllib.error
import urllib.parse
import urllib.request

ROOT = os.path.abspath(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", ".."))
ACQ = os.path.join(ROOT, "private", "acq", "cpsc_catalog")
MANIFEST = os.path.join(ACQ, "_manifest.jsonl")
UA = "legal-source-compass research (Seeger Weiss internal research)"
RECALL_API = "https://www.saferproducts.gov/RestWebServices/Recall?format=json&RecallDateStart={y}-01-01&RecallDateEnd={y}-12-31"
FIRST_YEAR = 1973
MIN_INTERVAL = 0.6  # seconds between requests to one host (<= 2 req/s)

# Owner hold (docs/owner-data-removal-2026-10-05.md): never fetch NEISS case data or SaferProducts incident reports.
HELD = re.compile(r"neiss.*(\.(csv|xlsx?|zip|tsv|txt)$|query|export|download)|/incidentreport|/publicsearch/.*(incident|report)|saferproducts\.gov/(?!restwebservices/recall)", re.I)


def sha256_file(path):
    digest = hashlib.sha256()
    with open(path, "rb") as handle:
        for chunk in iter(lambda: handle.read(1 << 20), b""):
            digest.update(chunk)
    return digest.hexdigest()


def now():
    return dt.datetime.now(dt.timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def log(url, path, status, method):
    entry = {
        "url": url,
        "path": os.path.relpath(path, ROOT),
        "sha256": sha256_file(path),
        "bytes": os.path.getsize(path),
        "retrieved_at": now(),
        "status": status,
        "method": method,
    }
    with open(MANIFEST, "a") as out:
        out.write(json.dumps(entry) + "\n")
    return entry


_last = {}


def fetch(url, dest, timeout=300):
    host = urllib.parse.urlparse(url).netloc
    wait = MIN_INTERVAL - (time.time() - _last.get(host, 0))
    if wait > 0:
        time.sleep(wait)
    request = urllib.request.Request(url, headers={"User-Agent": UA})
    tmp = dest + ".part"
    for attempt in range(5):
        _last[host] = time.time()
        try:
            with urllib.request.urlopen(request, timeout=timeout) as response, open(tmp, "wb") as out:
                status = response.status
                while True:
                    chunk = response.read(1 << 20)
                    if not chunk:
                        break
                    out.write(chunk)
            os.replace(tmp, dest)
            return status
        except urllib.error.HTTPError as error:
            if error.code in (429, 500, 502, 503, 504) and attempt < 4:
                time.sleep(2 ** attempt * 3)
                continue
            raise
        except (urllib.error.URLError, TimeoutError, ConnectionError) as error:
            if attempt < 4:
                print("retry", url, error, flush=True)
                time.sleep(2 ** attempt * 3)
                continue
            raise


def recalls():
    out_dir = os.path.join(ACQ, "recall_api")
    os.makedirs(out_dir, exist_ok=True)
    last = dt.date.today().year
    total = 0
    for year in range(FIRST_YEAR, last + 1):
        url = RECALL_API.format(y=year)
        dest = os.path.join(out_dir, f"recalls_{year}.json")
        status = fetch(url, dest)
        with open(dest, "rb") as handle:
            count = len(json.load(handle))
        total += count
        entry = log(url, dest, status, "direct GET (documented Recall REST API, per-year RecallDate window)")
        print(year, count, entry["bytes"], flush=True)
    print("total", total)


def safe_name(url):
    name = urllib.parse.unquote(urllib.parse.urlparse(url).path.rsplit("/", 1)[-1])
    return re.sub(r"[^A-Za-z0-9._-]+", "_", name)[:150] or "file"


def files(list_path):
    out_dir = os.path.join(ACQ, "reports")
    os.makedirs(out_dir, exist_ok=True)
    seen = set()
    if os.path.exists(MANIFEST):
        with open(MANIFEST) as handle:
            seen = {json.loads(line)["url"] for line in handle if line.strip()}
    with open(list_path) as handle:
        urls = [line.strip() for line in handle if line.strip() and not line.startswith("#")]
    for url in urls:
        if HELD.search(url):
            print("HELD (owner hold, not fetched)", url, flush=True)
            continue
        if url in seen:
            continue
        dest = os.path.join(out_dir, safe_name(url))
        try:
            status = fetch(url, dest)
        except Exception as error:  # noqa: BLE001 - report and continue
            print("FAILED", url, error, flush=True)
            continue
        entry = log(url, dest, status, "direct GET (cpsc.gov public file)")
        seen.add(url)
        print(entry["bytes"], entry["path"], flush=True)


def record(url, path, method, status="200"):
    entry = log(url, os.path.abspath(path), int(status), method)
    print(json.dumps(entry))


def pages():
    """Add manifest lines for the Firecrawl page reads saved under pages/ (source URL taken from each file's header)."""
    seen = set()
    if os.path.exists(MANIFEST):
        with open(MANIFEST) as handle:
            seen = {json.loads(line)["path"] for line in handle if line.strip()}
    folder = os.path.join(ACQ, "pages")
    for name in sorted(os.listdir(folder)):
        path = os.path.join(folder, name)
        if os.path.relpath(path, ROOT) in seen:
            continue
        with open(path) as handle:
            head = handle.readline()
        urls = re.findall(r"https://www\.(?:cpsc|saferproducts)\.gov/[^\s|]+", head)
        method = "firecrawl_scrape page read (host returns HTTP 403 to this sandbox); markdown main content saved as text"
        entry = log(" ".join(urls) or "see file header", path, 200, method)
        print(entry["path"], entry["sha256"][:12])


if __name__ == "__main__":
    os.makedirs(ACQ, exist_ok=True)
    command = sys.argv[1]
    if command == "recalls":
        recalls()
    elif command == "files":
        files(sys.argv[2])
    elif command == "record":
        record(*sys.argv[2:])
    elif command == "pages":
        pages()
    else:
        raise SystemExit(__doc__)
