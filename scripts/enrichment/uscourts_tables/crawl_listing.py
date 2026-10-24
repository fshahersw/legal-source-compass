"""Index every table the U.S. Courts "Caseload Statistics Data Tables" view lists for the publications we use.

The view (https://www.uscourts.gov/statistics-reports/caseload-statistics-data-tables) is filterable by publication
(pn) and by a date range on the period end (y[min], y[max]). Each row shows the table's exact title, table number,
period end date, publication name and its download links with sizes. Two passes build private/acq/uscourts_tables/
listing_index.json (one entry per table page with title, table number, period end, publication, page URL and files):

  pass 1 (--all):      page through one publication in the view's default order and in table-number order and take the
                       union (the default order ties on the date, so pages can repeat or skip a row);
  pass 2 (by year):    one request series per period-end year in table-number order, which is a total order inside a
                       year, so paging is stable; rows not seen in pass 1 are added and counted.

Usage: python3 -I -B crawl_listing.py all [pn,...]     pass 1
       python3 -I -B crawl_listing.py years [pn,...] [--since YYYY] [--refresh]   pass 2
  --since    only period-end years from YYYY on (to look for newly posted periods)
  --refresh  request the listing pages again instead of reusing the stored copies (new tables appear on them)

The index is re-read and merged just before every write, so two runs for different publications never drop each other's
entries (an earlier run lost the Federal Court Management Statistics entries that way).
"""
import json
import re
import sys
import urllib.parse
from html import unescape
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import fetchlib as F  # noqa: E402

LISTING = F.BASE + "/statistics-reports/caseload-statistics-data-tables"
PUBLICATIONS = {
    "77": "Judicial Business",
    "78": "Statistical Tables For The Federal Judiciary",
    "79": "Federal Judicial Caseload Statistics",
    "32": "Bankruptcy Filings",
    "531": "Bankruptcy Abuse Prevention and Consumer Protection Act (BAPCPA)",
    "529": "Wiretap",
    "34": "Judicial Facts and Figures",
    "33": "Federal Court Management Statistics",
    "530": "Civil Justice Reform Act (CJRA)",
}
MONTHS = {m: i for i, m in enumerate(["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"], 1)}
ROW = re.compile(r"<tr>(.*?)</tr>", re.S)
CELL = re.compile(r"<td[^>]*>(.*?)</td>", re.S)
HREF = re.compile(r'href="([^"]+)"')
SIZE = re.compile(r"(pdf|xlsx|xls|csv|zip|docx?)\s*,\s*([\d.,]+)\s*(KB|MB|B)", re.I)
DATE = re.compile(r"^([A-Z][a-z]+) (\d{1,2}), (\d{4})$")
YEARS = {"77": (1996, 2026), "78": (2001, 2026), "79": (2001, 2026), "32": (2001, 2026), "531": (2007, 2026), "529": (1997, 2026), "34": (2005, 2026),
         "33": (1997, 2026)}
ORDERS = [None, "field_current_table_number"]


def text_of(fragment):
    return re.sub(r"\s+", " ", unescape(re.sub(r"<[^>]+>", " ", fragment))).strip()


def parse_rows(html):
    out = []
    for row in ROW.findall(html):
        cells = CELL.findall(row)
        if len(cells) < 5:
            continue
        title = text_of(cells[0])
        number = text_of(cells[1])
        period = text_of(cells[2])
        publication = text_of(cells[3])
        hrefs = [unescape(h) for h in HREF.findall(row)]
        page = next((h for h in hrefs if "/data-tables/" in h), None)
        files = [h for h in hrefs if "/sites/default/files/" in h]
        sizes = [(m.group(1).lower(), m.group(2), m.group(3).upper()) for m in SIZE.finditer(text_of(cells[4]))]
        match = DATE.match(period)
        period_end = None
        if match and match.group(1) in MONTHS:
            period_end = f"{int(match.group(3)):04d}-{MONTHS[match.group(1)]:02d}-{int(match.group(2)):02d}"
        out.append({"title": title, "table": number, "period_text": period, "period_end": period_end, "publication": publication,
                    "page": F.BASE + page if page and page.startswith("/") else page,
                    "files": [F.BASE + f if f.startswith("/") else f for f in files], "sizes": sizes})
    return out


def fetch_pages(params, subdir, max_pages=400, refresh=False):
    rows = []
    for page in range(max_pages):
        p = dict(params)
        if page:
            p["page"] = str(page)
        url = LISTING + "?" + urllib.parse.urlencode(p, safe="[]")
        status, body, _ = F.fetch(url, subdir=subdir, force=refresh)
        if status != 200:
            print(f"  {params} page={page}: HTTP {status}", flush=True)
            return rows, status
        batch = parse_rows(body.decode("utf-8", "replace"))
        if not batch:
            break
        rows.extend(batch)
        if len(batch) < 50:
            break
    return rows, 200


def write_merged(pn, entry):
    """Write one publication's entry into listing_index.json, re-reading the file first so other publications' entries stay."""
    index_path = F.ACQ / "listing_index.json"
    current = json.loads(index_path.read_text()) if index_path.exists() else {}
    current[pn] = entry
    F.ACQ.mkdir(parents=True, exist_ok=True)
    tmp = index_path.with_suffix(".json.tmp")
    tmp.write_text(json.dumps(current, indent=1, sort_keys=True))
    tmp.replace(index_path)
    return current


def pass_all(pns):
    index_path = F.ACQ / "listing_index.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else {}
    for pn in pns:
        union, counts = {}, []
        for order in ORDERS:
            params = {"pn": pn}
            if order:
                params.update({"order": order, "sort": "asc"})
            rows, _ = fetch_pages(params, "listing")
            counts.append(len(rows))
            for r in rows:
                union.setdefault((r["page"], r["period_end"]), r)
        previous = index.get(pn, {})
        entry = {**previous, "publication": PUBLICATIONS.get(pn, pn), "per_order_rows": counts}
        known = {(t["page"], t["period_end"]) for t in previous.get("tables", [])}
        entry["tables"] = list(previous.get("tables", [])) + [r for k, r in union.items() if k not in known]
        print(f"{PUBLICATIONS.get(pn, pn)}: rows per order {counts}, distinct table pages {len(union)}, union now {len(entry['tables'])}", flush=True)
        index = write_merged(pn, entry)


def pass_years(pns, since=None, refresh=False):
    index_path = F.ACQ / "listing_index.json"
    index = json.loads(index_path.read_text()) if index_path.exists() else {}
    for pn in pns:
        first, last = YEARS[pn]
        if since:
            first = max(first, since)
        entry = index.setdefault(pn, {"publication": PUBLICATIONS.get(pn, pn), "tables": []})
        known = {(t["page"], t["period_end"]) for t in entry["tables"]}
        by_year, added, total = {}, [], 0
        for year in range(last, first - 1, -1):
            params = {"pn": pn, "y[min]": f"{year}-01-01", "y[max]": f"{year}-12-31", "order": "field_current_table_number", "sort": "asc"}
            rows, status = fetch_pages(params, "listing_by_year", max_pages=20, refresh=refresh)
            if status != 200:
                continue
            distinct = {}
            for r in rows:
                distinct.setdefault((r["page"], r["period_end"]), r)
            by_year[str(year)] = [len(rows), len(distinct)]
            total += len(distinct)
            for key, r in distinct.items():
                if key not in known:
                    entry["tables"].append(r)
                    known.add(key)
                    added.append(r)
        if since:  # a partial re-crawl keeps the full crawl's per-year counts and adds the refreshed years
            entry.setdefault("by_year_rows_distinct", {}).update(by_year)
            entry.setdefault("refreshes", []).append({"since": since, "added": len(added), "at": F.now_iso(), "years": by_year})
        else:
            entry["by_year_rows_distinct"] = by_year
            entry["added_by_year_crawl"] = len(added)
            entry["by_year_distinct_total"] = total
        for r in added:
            r["first_seen"] = F.now_iso()
        print(f"{PUBLICATIONS.get(pn, pn)}: by-year distinct {total}, added to the earlier union {len(added)}, union now {len(entry['tables'])}", flush=True)
        for r in added:
            print(f"   new: {r['table']} {r['period_end']} {r['title'][:80]}", flush=True)
        index = write_merged(pn, entry)
    print("listing_index.json written:", sum(len(v["tables"]) for v in index.values()), "tables")


if __name__ == "__main__":
    argv = list(sys.argv[1:])
    since = None
    if "--since" in argv:
        at = argv.index("--since")
        since = int(argv[at + 1])
        del argv[at:at + 2]
    args = [a for a in argv if not a.startswith("--")]
    mode = args[0] if args else "all"
    pns = args[1].split(",") if len(args) > 1 else list(YEARS if mode == "years" else PUBLICATIONS)
    if mode == "years":
        pass_years(pns, since=since, refresh="--refresh" in sys.argv)
    else:
        pass_all(pns)
