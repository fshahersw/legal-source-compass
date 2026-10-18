"""Acquire the Civil Justice Reform Act (CJRA) semiannual reports from www.uscourts.gov.

Two official indexes are read and stored unchanged:
  1. the caseload statistics data-tables listing filtered to the publication "Civil Justice Reform Act (CJRA)"
     (https://www.uscourts.gov/statistics-reports/caseload-statistics-data-tables?pn=530, every page), and
  2. the CJRA report landing page and each period page it links
     (https://www.uscourts.gov/data-news/reports/statistical-reports/civil-justice-reform-act-report).
From both an inventory of every published file is built (private/acq/uscourts_cjra/inventory.json). The per-judge
summary (the "n-a" entry: "Text and Appendices" or "Appendices A,B,C,D") and the small summary tables CJRA 1-4 are
downloaded for every period; the case-level lists (CJRA 7-11) only for the periods named with --detail.

Raw bytes are kept unchanged; every response is listed in private/acq/uscourts_cjra/_manifest.jsonl
(url, path, sha256, bytes, retrieved_at UTC, status, method).

Usage: python3 -I -B acquire_cjra.py [--detail 2026-03-31 ...] [--pages-only]
"""
import hashlib
import html as htmllib
import json
import re
import sys
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[3]
OUT = ROOT / "private" / "acq" / "uscourts_cjra"
MANIFEST = OUT / "_manifest.jsonl"
BASE = "https://www.uscourts.gov"
UA = "legal-source-compass research (contact: notreelai@gmail.com)"  # the owner's approved contact (CONTRACT.md); fetches made before 2026-10-18 15:20 UTC used an earlier UA without a contact address
LISTING = BASE + "/statistics-reports/caseload-statistics-data-tables?pn=530&page={page}"
REPORT_INDEX = BASE + "/data-news/reports/statistical-reports/civil-justice-reform-act-report"
MONTHS = {"march": "03-31", "september": "09-30"}
DELAY = 0.7  # seconds between requests (< 2 req/s)
_last = [0.0]


def get(url, attempts=4):
    for attempt in range(attempts):
        wait = DELAY - (time.time() - _last[0])
        if wait > 0:
            time.sleep(wait)
        _last[0] = time.time()
        try:
            request = urllib.request.Request(url, headers={"User-Agent": UA})
            with urllib.request.urlopen(request, timeout=180) as response:
                return response.status, response.read(), response.geturl()
        except urllib.error.HTTPError as error:
            if error.code == 404 or attempt == attempts - 1:
                return error.code, b"", url
        except (urllib.error.URLError, TimeoutError, ConnectionError):
            if attempt == attempts - 1:
                return 0, b"", url
        time.sleep(2 ** attempt)
    return 0, b"", url


def log(url, path, status, data, method="direct HTTPS GET (urllib)", final_url=None):
    entry = {"url": url, "path": str(path.relative_to(ROOT)) if path else None, "sha256": hashlib.sha256(data).hexdigest() if data else None,
             "bytes": len(data), "retrieved_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "status": status, "method": method}
    if final_url and final_url != url:
        entry["final_url"] = final_url
    with MANIFEST.open("a") as fh:
        fh.write(json.dumps(entry) + "\n")
    return entry


def fetch_to(url, path, reuse=True):
    if reuse and path.exists() and path.stat().st_size > 0:
        return 200, path.read_bytes()
    status, data, final = get(url)
    if status == 200 and data:
        path.parent.mkdir(parents=True, exist_ok=True)
        path.write_bytes(data)
        log(url, path, status, data, final_url=final)
    else:
        log(url, None, status, b"", final_url=final)
    return status, data


def text(fragment):
    return htmllib.unescape(re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", fragment))).strip()


def parse_listing(html):
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
        page = re.search(r'href="(/data-news/data-tables/(\d{4})/(\d{2})/(\d{2})/civil-justice-reform-act-cjra/([^"]+))"', tr)
        if not page:
            continue
        files = re.findall(r'href="(/sites/default/files/[^"]+)"', tr)
        cells = [text(td) for td in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        rows.append({"table_page": BASE + page.group(1), "period": f"{page.group(2)}-{page.group(3)}-{page.group(4)}", "table_slug": page.group(5),
                     "title": cells[0] if cells else None, "table_number": cells[1] if len(cells) > 1 else None,
                     "files": [BASE + f for f in files], "source": "data-tables listing"})
    return rows


def parse_period_page(html, page_url):
    rows = []
    for tr in re.findall(r"<tr[^>]*>(.*?)</tr>", html, re.S):
        page = re.search(r'href="(/data-news/data-tables/(\d{4})/(\d{2})/(\d{2})/civil-justice-reform-act-cjra/([^"]+))"', tr)
        files = re.findall(r'href="(/sites/default/files/[^"]+\.(?:pdf|xlsx|xls))"', tr)
        if not page and not files:
            continue
        cells = [text(td) for td in re.findall(r"<td[^>]*>(.*?)</td>", tr, re.S)]
        rows.append({"table_page": BASE + page.group(1) if page else None, "period": f"{page.group(2)}-{page.group(3)}-{page.group(4)}" if page else None,
                     "table_slug": page.group(5) if page else None, "title": cells[0] if cells else None, "table_number": cells[1] if len(cells) > 1 else None,
                     "files": [BASE + f for f in files], "source": page_url})
    loose = [BASE + f for f in re.findall(r'href="(/sites/default/files/[^"]+\.(?:pdf|xlsx|xls)|/file/\d+/download)"', html) if "guide-vol" not in f]
    return rows, sorted(set(loose))


def main(argv):
    detail = set()
    if "--detail" in argv:
        detail = {a for a in argv[argv.index("--detail") + 1:] if re.fullmatch(r"\d{4}-\d{2}-\d{2}", a)}
    pages_only = "--pages-only" in argv
    OUT.mkdir(parents=True, exist_ok=True)
    pages_dir = OUT / "pages"
    listing_rows = []
    for page in range(0, 40):
        status, data = fetch_to(LISTING.format(page=page), pages_dir / f"datatables_pn530_p{page}.html")
        if status != 200:
            break
        rows = parse_listing(data.decode("utf-8", "replace"))
        if not rows:
            break
        listing_rows.extend(rows)
    status, data = fetch_to(REPORT_INDEX, pages_dir / "cjra_report_index.html")
    index_html = data.decode("utf-8", "replace")
    period_links = sorted(set(re.findall(r'href="((?:https://www\.uscourts\.gov)?/(?:data-news/reports/statistical-reports/civil-justice-reform-act-report|statistics-reports)/((march|september)-(\d{4}))-civil-justice-reform-act)"', index_html)))
    periods = {}
    for href, slug, month, year in period_links:
        url = href if href.startswith("http") else BASE + href
        period = f"{year}-{MONTHS[month]}"
        status, data = fetch_to(url, pages_dir / f"period_{period}.html")
        rows, loose = parse_period_page(data.decode("utf-8", "replace"), url) if status == 200 else ([], [])
        periods[period] = {"period": period, "report_page": url, "page_status": status, "tables": rows, "loose_files": loose}
    for row in listing_rows:
        periods.setdefault(row["period"], {"period": row["period"], "report_page": None, "page_status": None, "tables": [], "loose_files": []})
        periods[row["period"]].setdefault("listing", []).append(row)
    inventory = {"retrieved_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "listing_url": LISTING.format(page=0), "report_index": REPORT_INDEX,
                 "periods": [periods[k] for k in sorted(periods)]}
    (OUT / "inventory.json").write_text(json.dumps(inventory, indent=1))
    print(json.dumps({"listing_rows": len(listing_rows), "periods": len(periods)}))
    if pages_only:
        return
    files_dir = OUT / "files"
    for period, entry in sorted(periods.items()):
        wanted = []
        for row in entry["tables"] + entry.get("listing", []):
            slug = (row.get("table_slug") or "").lower()
            is_detail = slug in {"cjra-7", "cjra-8", "cjra-9", "cjra-10", "cjra-11"}
            if is_detail and period not in detail:
                continue
            wanted.extend(row["files"])
        if not wanted:
            wanted = [f for f in entry["loose_files"] if period in detail or not re.search(r"table_?(7|8|9|10|11)w?|cjratable(7|8|9|10|11)", f, re.I)]
        for url in sorted(set(wanted)):
            m = re.search(r"/file/(\d+)/download$", url)
            name = f"file_{m.group(1)}.pdf" if m else url.rsplit("/", 1)[-1]
            status, data = fetch_to(url, files_dir / period / name)
            print(period, status, len(data), name)


if __name__ == "__main__":
    main(sys.argv[1:])
