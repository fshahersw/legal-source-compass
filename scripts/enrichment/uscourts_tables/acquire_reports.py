"""Acquire the three U.S. Courts report publications that are not in the caseload data-table listing:

  * Crime Victims' Rights reports (annual, one PDF per calendar year):
      https://www.uscourts.gov/data-news/reports/statistical-reports/crime-victims-rights-report
  * Delayed-Notice Search Warrant reports (one page per year, each linking its report files):
      https://www.uscourts.gov/data-news/reports/statistical-reports/delayed-notice-search-warrant-report
  * Director's Report on the Foreign Intelligence Surveillance Courts' Activities (annual PDF):
      https://www.uscourts.gov/data-news/reports/statistical-reports/directors-report-foreign-intelligence-surveillance-courts-activities

One request per second (fetchlib), every file stored gzip-compressed with the sha256 of the bytes the server sent; stored copies are
reused. Writes private/acq/uscourts_tables/reports_index.json: one entry per file with its publication, the page that links it,
the link text, url, sha256, bytes and stored path. Usage: python3 -I -B acquire_reports.py
"""
import json
import re
import sys
from html import unescape
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fetchlib as F  # noqa: E402

PUBLICATIONS = {
    "CVRA": ("Crime Victims' Rights report", "https://www.uscourts.gov/data-news/reports/statistical-reports/crime-victims-rights-report"),
    "DNSW": ("Delayed-Notice Search Warrant report", "https://www.uscourts.gov/data-news/reports/statistical-reports/delayed-notice-search-warrant-report"),
    "FISC": ("Director's Report on the Foreign Intelligence Surveillance Courts' Activities",
             "https://www.uscourts.gov/data-news/reports/statistical-reports/directors-report-foreign-intelligence-surveillance-courts-activities"),
}
FILE = re.compile(r"\.(?:pdf|xlsx?|csv)$|/file/\d+/download$", re.I)


def file_format(href, data):
    """The file's format: from its extension, or for a /file/<n>/download link from the bytes (PDF or zip-based xlsx)."""
    if not href.endswith("/download"):
        return href.rsplit(".", 1)[-1].lower()
    if data[:5] == b"%PDF-":
        return "pdf"
    if data[:2] == b"PK":
        return "xlsx"
    if data[:8] == bytes.fromhex("d0cf11e0a1b11ae1"):
        return "xls"
    return "unknown"


def links(html):
    """[(href, link text)] of a page, entities decoded, tags stripped from the text."""
    out = []
    for m in re.finditer(r'<a\b[^>]*href="([^"#]+)"[^>]*>(.*?)</a>', html, re.S | re.I):
        text = re.sub(r"<[^>]+>", " ", m.group(2))
        out.append((unescape(m.group(1)), re.sub(r"\s+", " ", unescape(text)).strip()))
    return out


def absolute(href):
    return href if href.startswith("http") else F.BASE + href


def page_files(url):
    status, body, _ = F.fetch(url, subdir="pages")
    if status != 200:
        return status, [], [], ""
    html = body.decode("utf-8", "replace")
    found = links(html)
    files = [(absolute(h), t) for h, t in found if FILE.search(h) and "guide-vol01" not in h]
    slug = url.rstrip("/").split("/")[-1]
    subpages = sorted({absolute(h) for h, _ in found if f"/{slug}/" in h and not FILE.search(h)})
    title = re.search(r"<title>(.*?)</title>", html, re.S | re.I)
    return status, files, subpages, (re.sub(r"\s+", " ", unescape(title.group(1))).strip() if title else "")


def main():
    index_path = F.ACQ / "reports_index.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else {}
    for code, (name, url) in PUBLICATIONS.items():
        status, files, subpages, title = page_files(url)
        pages = [(url, title, files)]
        for sub in subpages:
            s2, f2, _, t2 = page_files(sub)
            if s2 == 200:
                pages.append((sub, t2, f2))
            else:
                print(f"  {code}: page {sub} answered {s2}", flush=True)
        for page, page_title, page_links in pages:
            for href, text in page_links:
                st, data, path = F.fetch(href, subdir="reports")
                entry = {"pub": code, "publication": name, "publication_page": url, "page": page, "page_title": page_title, "link_text": text,
                         "url": href, "status": st}
                if st == 200:
                    entry.update({"sha256": F.sha256_of(data), "bytes": len(data), "path": str(path.relative_to(F.ROOT)),
                                  "format": file_format(href, data)})
                index[href] = entry
                print(f"  {code} {st} {href}", flush=True)
    index_path.write_text(json.dumps(index, indent=1, sort_keys=True))
    print(f"{len(index)} files in reports_index.json")


if __name__ == "__main__":
    main()
