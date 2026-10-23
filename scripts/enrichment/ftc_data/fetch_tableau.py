"""Record which of the FTC's Tableau Public views offer a data download, and keep the data of those that do.

  python3 -I -B fetch_tableau.py

Views come from two official lists: the dashboard links on https://www.ftc.gov/news-events/data-visualizations/explore-data
(stored page) and the sheets Tableau Public itself lists for each workbook of the FTC's profile
(https://public.tableau.com/public/apis/workbooks?profileName=federal.trade.commission and
https://public.tableau.com/profile/api/workbook/<workbook>). For every view the script asks for the CSV download Tableau Public
offers when the author allows it (https://public.tableau.com/views/<workbook>/<view>.csv): HTTP 200 with text/csv means the view
offers a data download; any other answer is recorded as "no download offered" with the status. Nothing is guessed from images.
public.tableau.com's robots.txt asks for a 10 s Crawl-delay and the fetcher keeps it, one request at a time.

Output: private/acq/ftc_data/tableau/{workbooks.json, workbook_<wb>.json, <wb>__<view>.csv | <wb>__<view>.err} and the
summary private/acq/ftc_data/tableau/_views.json (one entry per view: status, content type, bytes, sha256, where it came from).
"""
import gzip
import json
import os
import re
import sys
import urllib.parse

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ftc_http as fh  # noqa: E402

DIR = os.path.join(fh.ACQ, "tableau")
PROFILE = "federal.trade.commission"
LIST_URL = f"https://public.tableau.com/public/apis/workbooks?profileName={PROFILE}&start=0&count=50&visibility=NON_HIDDEN"
VIZ = re.compile(r"^https://public\.tableau\.com/app/profile/federal\.trade\.commission/viz/([A-Za-z0-9_]+)/([A-Za-z0-9_]+)")
METHOD = "public.tableau.com CSV download endpoint (direct GET, robots.txt Crawl-delay 10 s observed)"


def explore_links():
    """(section heading, link text, workbook, view) for every dashboard link on the FTC Explore Data page."""
    from bs4 import BeautifulSoup

    path = os.path.join(fh.ACQ, "pages", "explore_data.html.gz")
    soup = BeautifulSoup(gzip.open(path).read().decode("utf-8", "replace"), "lxml")
    main = soup.find("main") or soup
    out = []
    section = None
    for node in main.descendants:
        if getattr(node, "name", None) in ("h2", "h3", "h4"):
            section = node.get_text(" ", strip=True)
        if getattr(node, "name", None) == "a" and node.get("href"):
            m = VIZ.match(node["href"])
            if m:
                out.append((section, node.get_text(" ", strip=True), m.group(1), m.group(2)))
    return out


def save(name, resp, mode="wb"):
    path = os.path.join(DIR, name)
    os.makedirs(DIR, exist_ok=True)
    with open(path, mode) as handle:
        handle.write(resp.body)
    return path


def main():
    fetcher = fh.Fetcher()
    views = {}  # (wb, view) -> info

    for section, label, wb, view in explore_links():
        info = views.setdefault((wb, view), {"workbook": wb, "view": view, "labels": [], "sections": [], "listed_on": set()})
        if label not in info["labels"]:
            info["labels"].append(label)
        if section and section not in info["sections"]:
            info["sections"].append(section)
        info["listed_on"].add("ftc.gov Explore Data page")

    entry, resp = fetcher.fetch_to_file(LIST_URL, os.path.join(DIR, "workbooks.json"), METHOD.replace("CSV download endpoint", "workbook list API"))
    workbooks = json.loads(resp.body)["contents"]
    wb_titles = {w["workbookRepoUrl"]: w["title"] for w in workbooks}
    wb_names = list(wb_titles)
    for wb, view in list(views):
        if wb not in wb_names:
            wb_names.append(wb)
    for wb in wb_names:
        url = f"https://public.tableau.com/profile/api/workbook/{wb}"
        entry, resp = fetcher.fetch_to_file(url, os.path.join(DIR, f"workbook_{wb}.json"), METHOD.replace("CSV download endpoint", "workbook sheet list API"), keep_non200=True)
        if resp.status != 200:
            print("workbook list", wb, resp.status)
            continue
        doc = json.loads(resp.body)
        if doc.get("title"):
            wb_titles.setdefault(wb, doc["title"])
        for vi in doc.get("viewInfos", []):
            view = vi["sheetRepoUrl"].split("/")[-1]
            info = views.setdefault((wb, view), {"workbook": wb, "view": view, "labels": [], "sections": [], "listed_on": set()})
            info["sheet_title"] = vi.get("sheetTitle")
            info["listed_on"].add("Tableau Public workbook sheet list")

    summary = []
    for i, ((wb, view), info) in enumerate(sorted(views.items())):
        url = f"https://public.tableau.com/views/{wb}/{view}.csv?:showVizHome=no"
        resp = fetcher.get(url)
        ok = resp.status == 200 and "csv" in resp.content_type.lower()
        name = f"{wb}__{view}." + ("csv" if ok else "err")
        path = save(name, resp)
        rec = {
            "workbook": wb,
            "workbook_title": wb_titles.get(wb),
            "view": view,
            "view_title": info.get("sheet_title"),
            "labels_on_ftc_page": info["labels"],
            "sections_on_ftc_page": info["sections"],
            "listed_on": sorted(info["listed_on"]),
            "csv_url": url,
            "view_url": f"https://public.tableau.com/app/profile/{PROFILE}/viz/{wb}/{view}",
            "status": resp.status,
            "content_type": resp.content_type,
            "bytes": len(resp.body),
            "sha256": fh.sha256(resp.body),
            "retrieved_at": fh.now_utc(),
            "download_offered": ok,
            "path": fh.rel(path),
        }
        summary.append(rec)
        fh.append_manifest({k: rec[k] for k in ("sha256", "bytes", "retrieved_at", "status", "content_type", "path")} | {"url": url, "method": METHOD})
        print(i, wb, view, resp.status, resp.content_type, len(resp.body), flush=True)
        with open(os.path.join(DIR, "_views.json"), "w", encoding="utf-8") as handle:
            json.dump(summary, handle, indent=1)


if __name__ == "__main__":
    main()
