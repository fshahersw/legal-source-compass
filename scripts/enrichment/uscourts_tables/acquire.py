"""Download the table workbooks (XLSX) and, where no workbook exists, the PDF listed for the tables we use.

Reads private/acq/uscourts_tables/listing_index.json (crawl_listing.py). For every listed table of the chosen
publications it fetches the XLSX (preferred) -- or, with --pdf-fallback, the PDF when the table has no workbook -- one
request per second, stored gzip-compressed with sha256 of the original bytes in _manifest.jsonl. It never fetches the
table's HTML page again (the listing row already carries its exact title, table number, period end and file links),
skips the composite "All ... tables" files, and writes private/acq/uscourts_tables/files_index.json:
one entry per (publication, table, period end) with title, page URL, file URL, format, sha256, bytes.

Usage: python3 -I -B acquire.py [--pubs 77,78,79,32] [--pdf-fallback] [--series B,C,D,...] [--tables C,D-1,...] [--pdf-only]
                              [--limit N] [--min-year Y]
  --tables     only these listing table numbers (exact, case-insensitive), for the PDF back-fill of selected court tables
  --pdf-only   fetch the PDF of an entry only when the entry has no workbook (the period before spreadsheets were published)
"""
import argparse
import json
import re
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fetchlib as F  # noqa: E402

PUB_CODE = {"77": "JB", "78": "STFJ", "79": "FJCS", "32": "BF", "531": "BAPCPA", "529": "WIRETAP", "34": "JFF", "33": "FCMS", "530": "CJRA"}
# Priority order: district/appeals/bankruptcy/magistrate/trial/judgeship tables first, the rest after.
PRIORITY = ["C", "D", "B", "F", "M", "T", "X", "E", "H", "S", "J", "K", "V", "G", "A", "BAP", "JCI"]


def series_of(table):
    m = re.match(r"^([A-Za-z]+)", table or "")
    return m.group(1).upper() if m else ""


def is_composite(entry):
    title = (entry.get("title") or "").lower()
    table = (entry.get("table") or "").lower()
    return title.startswith("all ") or table.startswith("n-a") or table in ("", "all")


def pick(entry, pdf_fallback):
    files = entry.get("files") or []
    xlsx = next((f for f in files if f.lower().endswith((".xlsx", ".xls"))), None)
    if xlsx:
        return xlsx, ("xlsx" if xlsx.lower().endswith(".xlsx") else "xls")
    pdf = next((f for f in files if f.lower().endswith(".pdf")), None)
    if pdf and pdf_fallback:
        return pdf, "pdf"
    return None, None


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--pubs", default="77,78,79,32")
    ap.add_argument("--series", default="")
    ap.add_argument("--pdf-fallback", action="store_true")
    ap.add_argument("--pdf-only", action="store_true")
    ap.add_argument("--tables", default="")
    ap.add_argument("--min-year", type=int, default=0)
    ap.add_argument("--limit", type=int, default=0)
    args = ap.parse_args()
    listing = json.loads((F.ACQ / "listing_index.json").read_text())
    want_series = [s for s in args.series.split(",") if s] or PRIORITY
    want_tables = {t.strip().upper() for t in args.tables.split(",") if t.strip()}
    jobs = []
    for pn in args.pubs.split(","):
        pub = PUB_CODE.get(pn, pn)
        for entry in listing.get(pn, {}).get("tables", []):
            if is_composite(entry) or not entry.get("period_end"):
                continue
            if int(entry["period_end"][:4]) < args.min_year:
                continue
            s = series_of(entry["table"])
            if s not in want_series:
                continue
            if want_tables and entry["table"].upper() not in want_tables:
                continue
            if args.pdf_only:
                if any(f.lower().endswith((".xlsx", ".xls")) for f in entry.get("files", [])):
                    continue
                url, fmt = pick(entry, True)
            else:
                url, fmt = pick(entry, args.pdf_fallback)
            if not url:
                continue
            jobs.append((want_series.index(s), pub, entry, url, fmt))
    jobs.sort(key=lambda j: (j[0], j[1], j[2]["table"], j[2]["period_end"]))
    if args.limit:
        jobs = jobs[: args.limit]
    print(f"{len(jobs)} files to fetch (stored copies are reused)", flush=True)
    index_path = F.ACQ / "files_index.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else {}
    bad = 0
    for n, (_, pub, entry, url, fmt) in enumerate(jobs, 1):
        key = f"{pub}|{entry['table']}|{entry['period_end']}"
        status, data, path = F.fetch(url, subdir="files")
        if status != 200:
            bad += 1
            print(f"  [{n}/{len(jobs)}] {key}: HTTP {status} {url}", flush=True)
            index[key] = {"pub": pub, "table": entry["table"], "period_end": entry["period_end"], "title": entry["title"], "page": entry["page"], "url": url, "format": fmt, "status": status}
            continue
        index[key] = {
            "pub": pub, "table": entry["table"], "period_end": entry["period_end"], "title": entry["title"], "page": entry["page"],
            "url": url, "format": fmt, "status": 200, "sha256": F.sha256_of(data), "bytes": len(data), "path": str(path.relative_to(F.ROOT)),
            "other_files": [f for f in entry.get("files", []) if f != url],
        }
        if n % 50 == 0:
            index_path.write_text(json.dumps(index, indent=1, sort_keys=True))
            print(f"  [{n}/{len(jobs)}] {key} ok; failures so far {bad}", flush=True)
    index_path.write_text(json.dumps(index, indent=1, sort_keys=True))
    print(f"done: {len(jobs)} files, {bad} failures; files_index.json has {len(index)} entries")


if __name__ == "__main__":
    main()
