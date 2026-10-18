"""Acquire official U.S. Courts tables for stream uscourts_caseload (read-only GETs; raw bytes kept unchanged).

Two families:
  jb   Judicial Business data-table pages /data-news/data-tables/<year>/09/30/judicial-business/<table>
       (Excel preferred, PDF kept too) for the tables this stream ingests: F-2, C-4, C-4A, S-19, S-20, T-1.
  jff  Judicial Facts and Figures edition pages (2005-2025): every table PDF linked from each edition page.

Each file goes to private/acq/uscourts_caseload/<family>/... and is listed in _manifest.jsonl (see fetchlib).
An index of (edition/year, table, page, title, files) is written to private/acq/uscourts_caseload/<family>_index.json.

Usage: python3 acquire_uscourts_caseload.py jb [first_year] [last_year] [tables...]
       python3 acquire_uscourts_caseload.py jff
"""
import json
import re
import sys
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fetchlib  # noqa: E402

BASE = "https://www.uscourts.gov"
JB_TABLES = ["f-2", "c-4", "c-4a", "s-19", "s-20", "t-1"]
JFF_BASE = BASE + "/data-news/reports/statistical-reports/judicial-facts-and-figures/"
JFF_EDITIONS = {y: JFF_BASE + f"judicial-facts-and-figures-{y}" for y in [2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2014, 2013, 2012, 2011, 2009, 2008, 2007, 2006, 2005]}
JFF_EDITIONS[2010] = JFF_BASE + "judicial-facts-and-figures-2013/judicial-facts-and-figures-2010"
FILE = re.compile(r'href="([^"]+\.(?:xlsx|xls|pdf))"', re.I)


def clean(html_fragment):
    return re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", html_fragment)).replace("&nbsp;", " ").replace("&amp;", "&").strip()


def page_meta(html):
    title = re.search(r"<title>(.*?)</title>", html, re.S)
    sub = re.search(r'field--name-field-data-table-subtitle[^>]*>(.*?)</div>', html, re.S)
    return (clean(title.group(1)) if title else None), (clean(sub.group(1)) if sub else None)


def fetch_jb(year, table):
    page = f"{BASE}/data-news/data-tables/{year}/09/30/judicial-business/{table}"
    status, body, path = fetchlib.fetch(page, subdir="pages")
    entry = {"year": year, "table": table, "page": page, "page_status": status, "files": []}
    if status != 200:
        return entry
    html = body.decode("utf-8", "replace")
    entry["page_title"], entry["subtitle"] = page_meta(html)
    main = re.search(r"<main.*?</main>", html, re.S)
    for href in FILE.findall(main.group(0) if main else html):
        if "guide-vol" in href:
            continue
        url = href if href.startswith("http") else BASE + href
        fstatus, data, fpath = fetchlib.fetch(url, subdir="jb")
        entry["files"].append({"url": url, "status": fstatus, "path": str(fpath.relative_to(fetchlib.ROOT)) if fpath else None,
                               "sha256": fetchlib.sha256_of(fpath) if fpath else None})
    return entry


XLSX_EDITIONS = range(2014, 2026)  # editions whose data-table pages offer .xlsx (earlier ones offer legacy .xls + PDF)
PDF_CROSSCHECK_EDITIONS = (2025,)


def fetch_jff(edition):
    """Editions 2014-2025: visit each table's data-table page and download its .xlsx (and the PDF for 2025, for
    display cross-checks). Editions 2005-2013: download the table PDFs linked from the edition page (their .xls
    files are legacy BIFF workbooks that cannot be read with the installed libraries)."""
    page = JFF_EDITIONS[edition]
    status, body, path = fetchlib.fetch(page, subdir="pages")
    html = body.decode("utf-8", "replace")
    main = re.search(r"<main.*?</main>", html, re.S)
    main = main.group(0) if main else html
    out = []
    for row in re.findall(r"<tr[^>]*>(.*?)</tr>", main, re.S):
        cells = [clean(c) for c in re.findall(r"<td[^>]*>(.*?)</td>", row, re.S)]
        files = [h for h in FILE.findall(row) if "guide-vol" not in h]
        table_pages = [h for h in re.findall(r'href="([^"]+)"', row) if "/data-tables/" in h]
        if not cells or not (files or table_pages):
            continue
        meta = {"edition": edition, "page": page, "title": cells[0], "number": cells[1] if len(cells) > 1 else None, "period": cells[2] if len(cells) > 2 else None}
        wanted = []
        if edition in XLSX_EDITIONS and table_pages:
            tpage = table_pages[0] if table_pages[0].startswith("http") else BASE + table_pages[0]
            tstatus, tbody, _ = fetchlib.fetch(tpage, subdir="pages")
            meta["table_page"] = tpage
            thtml = tbody.decode("utf-8", "replace")
            tmain = re.search(r"<main.*?</main>", thtml, re.S)
            tfiles = FILE.findall(tmain.group(0) if tmain else thtml)
            wanted = [h for h in tfiles if h.lower().endswith(".xlsx")]
            if edition in PDF_CROSSCHECK_EDITIONS or not wanted:
                wanted += [h for h in tfiles if h.lower().endswith(".pdf")]
        else:
            wanted = [h for h in files if h.lower().endswith(".pdf")]
        for href in wanted:
            url = href if href.startswith("http") else BASE + href
            fstatus, data, fpath = fetchlib.fetch(url, subdir="jff")
            out.append({**meta, "url": url, "status": fstatus,
                        "path": str(fpath.relative_to(fetchlib.ROOT)) if fpath else None, "sha256": fetchlib.sha256_of(fpath) if fpath else None})
    # editions that also offer one combined PDF of all tables keep it for cross-checking
    for href in FILE.findall(main):
        if re.search(r"all.*fig", href, re.I):
            url = href if href.startswith("http") else BASE + href
            fstatus, data, fpath = fetchlib.fetch(url, subdir="jff")
            out.append({"edition": edition, "page": page, "title": "All tables (combined PDF)", "number": "ALL", "period": None, "url": url, "status": fstatus,
                        "path": str(fpath.relative_to(fetchlib.ROOT)) if fpath else None, "sha256": fetchlib.sha256_of(fpath) if fpath else None})
    return out


def write_index(name, entries, key):
    path = fetchlib.ACQ / f"{name}_index.json"
    previous = json.loads(path.read_text()) if path.exists() else []
    keys = {key(e) for e in entries}
    merged = [e for e in previous if key(e) not in keys] + entries
    path.write_text(json.dumps(sorted(merged, key=lambda e: json.dumps(key(e))), indent=1))
    return path


def main():
    family = sys.argv[1] if len(sys.argv) > 1 else "jb"
    if family == "jb":
        first = int(sys.argv[2]) if len(sys.argv) > 2 else 2025
        last = int(sys.argv[3]) if len(sys.argv) > 3 else 2025
        tables = sys.argv[4:] or JB_TABLES
        jobs = [(y, t) for y in range(first, last + 1) for t in tables]
        with ThreadPoolExecutor(max_workers=2) as pool:
            entries = list(pool.map(lambda job: fetch_jb(*job), jobs))
        write_index("jb", entries, lambda e: (e["year"], e["table"]))
        missing = [f"{e['year']}/{e['table']}:{e['page_status']}" for e in entries if not any(f.get("path") for f in e["files"])]
        print(json.dumps({"jobs": len(jobs), "with_files": len(jobs) - len(missing), "missing": missing}))
    elif family == "jff":
        editions = [int(a) for a in sys.argv[2:]] or sorted(JFF_EDITIONS)
        entries = []
        for edition in editions:
            entries.extend(fetch_jff(edition))
        write_index("jff", entries, lambda e: (e["edition"], e["url"]))
        bad = [e["url"] for e in entries if e["status"] != 200]
        print(json.dumps({"files": len(entries), "failed": bad}))


if __name__ == "__main__":
    main()
