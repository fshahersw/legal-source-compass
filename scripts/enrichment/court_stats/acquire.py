"""Download official U.S. Courts data tables (Judicial Business, 12-month periods ending September 30).

For every (fiscal year, table) the table's own page on www.uscourts.gov is read and its download links are
collected; the Excel file is preferred and the PDF is kept as well. Files are stored unchanged under
private/acq/court-stats/jb/<year>/ and every download is listed in private/acq/court-stats/manifest.json with
its source page, file URL, size, sha256 and retrieval time so each value can be re-checked.

Usage: python3 acquire.py [first_year=2014] [last_year=2025]
"""
import hashlib
import json
import re
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "private" / "acq" / "court-stats"
BASE = "https://www.uscourts.gov"
UA = "SeegerWeiss Research firasshaher99@gmail.com"
# District civil, courts of appeals and judgeship tables used by the court_stats builders.
TABLES = ["c", "c-1", "c-2", "c-2a", "c-3", "c-3a", "c-3b", "c-4a", "c-5", "c-6", "c-11", "c-12", "b", "b-1", "b-4", "b-4a", "b-7", "x-1a"]
LINK = re.compile(r'href="([^"]+\.(?:xlsx|xls|pdf))"', re.I)


def get(url, attempts=4):
    for attempt in range(attempts):
        try:
            request = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(request, timeout=120) as response:
                return response.status, response.read()
        except urllib.error.HTTPError as error:
            if error.code == 404:
                return 404, b""
            if attempt == attempts - 1:
                return error.code, b""
        except urllib.error.URLError:
            if attempt == attempts - 1:
                return 0, b""
        time.sleep(1.5 * (attempt + 1))
    return 0, b""


def table_links(html):
    links = []
    for href in LINK.findall(html):
        if "guide-vol" in href or href in links:
            continue
        links.append(href)
    return links


def fetch_table(year, table):
    page = f"{BASE}/data-news/data-tables/{year}/09/30/judicial-business/{table}"
    status, body = get(page)
    entry = {"year": year, "table": table, "page": page, "page_status": status, "files": []}
    if status != 200:
        return entry
    html = body.decode("utf-8", "replace")
    title = re.search(r"<title>(.*?)</title>", html, re.S)
    entry["page_title"] = re.sub(r"\s+", " ", title.group(1)).strip() if title else None
    sub = re.search(r'field--name-field-data-table-subtitle[^>]*>(.*?)</div>', html, re.S)
    entry["subtitle"] = re.sub(r"<[^>]+>|\s+", " ", sub.group(1)).strip() if sub else None
    folder = OUT / "jb" / str(year)
    folder.mkdir(parents=True, exist_ok=True)
    for href in table_links(html):
        url = href if href.startswith("http") else BASE + href
        name = url.rsplit("/", 1)[-1]
        target = folder / f"{table}__{name}"
        if target.exists() and target.stat().st_size > 0:
            data = target.read_bytes()
            fstatus = 200
        else:
            fstatus, data = get(url)
            if fstatus == 200 and data:
                target.write_bytes(data)
        if fstatus == 200 and data:
            entry["files"].append({
                "url": url, "path": str(target.relative_to(ROOT)), "bytes": len(data),
                "sha256": hashlib.sha256(data).hexdigest(), "retrieved_at": datetime.now(timezone.utc).isoformat(timespec="seconds"),
            })
        else:
            entry["files"].append({"url": url, "status": fstatus})
    return entry


def main():
    first = int(sys.argv[1]) if len(sys.argv) > 1 else 2014
    last = int(sys.argv[2]) if len(sys.argv) > 2 else 2025
    jobs = [(year, table) for year in range(first, last + 1) for table in TABLES]
    with ThreadPoolExecutor(max_workers=4) as pool:
        entries = list(pool.map(lambda job: fetch_table(*job), jobs))
    manifest_path = OUT / "manifest.json"
    previous = json.loads(manifest_path.read_text()) if manifest_path.exists() else []
    keep = [e for e in previous if (e["year"], e["table"]) not in set(jobs)]
    manifest = sorted(keep + entries, key=lambda e: (e["year"], e["table"]))
    manifest_path.write_text(json.dumps(manifest, indent=1))
    ok = sum(1 for e in entries if e["files"])
    print(json.dumps({"jobs": len(jobs), "pages_with_files": ok, "missing": [f"{e['year']}/{e['table']}:{e['page_status']}" for e in entries if not e["files"]]}))


if __name__ == "__main__":
    main()
