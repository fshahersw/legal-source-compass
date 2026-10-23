"""Build ftc_publications_index (Data Spotlight posts and FTC policy reports), ftc_sentinel_contributors and ftc_open_data_catalog.

Reads only private/acq/ftc_data/ (stored ftc.gov pages, the Tableau probe results, the manifest). Text is as the FTC pages show it.
"""
import gzip
import json
import os
import re
import sys

from bs4 import BeautifulSoup

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import bcommon as B  # noqa: E402
import index_parse as IP  # noqa: E402

BASE = "https://www.ftc.gov"
PAGES = os.path.join(B.ACQ, "pages")

# series id -> (label, listing url, number of stored listing pages)
LISTINGS = {
    "spotlight": ("Data Spotlight", BASE + "/news-events/data-visualizations/data-spotlight", "data_spotlight", 2),
    "commission-staff": ("Commission and staff reports", BASE + "/policy/reports/commission-staff-reports", "rep_commission_staff", 28),
    "economic-reports": ("Economic reports", BASE + "/policy/reports/economic-reports", "rep_economic_reports", 7),
    "economic-issue-papers": ("Economic issue papers", BASE + "/policy/reports/economic-issue-papers", "rep_economic_issue_papers", 1),
}
FILE_PAGES = {
    "annual-competition": ("Annual competition reports", BASE + "/policy/reports/annual-competition-reports", "rep_annual_competition_p0.html"),
    "ftc-annual": ("FTC annual reports", BASE + "/policy/reports/ftc-annual-reports", "rep_ftc_annual_p0.html"),
}
SERIES_LABEL = {k: v[0] for k, v in LISTINGS.items()} | {k: v[0] for k, v in FILE_PAGES.items()}
PUBLICATION_COLUMNS = [("title", "Title"), ("series", "Series"), ("published", "Published"), ("files", "Files")]


def read_page(name):
    with gzip.open(os.path.join(PAGES, name + ".gz"), "rb") as handle:
        return handle.read().decode("utf-8", "replace")


def listing_url(base, n):
    return base if n == 0 else f"{base}?page={n}"


def unique(base_id, taken):
    rid, i = base_id, 2
    while rid in taken:
        rid = f"{base_id}-{i}"
        i += 1
    taken.add(rid)
    return rid


def build_publications(entries=None):
    entries = entries if entries is not None else B.current_entries()
    rows, inputs, taken = [], [], set()
    counts, shown = {}, {}
    for series, (label, base, stem, npages) in LISTINGS.items():
        n_items = 0
        for n in range(npages):
            url = listing_url(base, n)
            entry = entries.get(url)
            if entry is None:
                raise SystemExit(f"listing page not fetched: {url}")
            inputs.append(B.input_ref(entry))
            html = read_page(f"{stem}_p{n}.html")
            if n == 0:
                displayed, last, total = IP.parse_pager(html)
                shown[series] = {"displayed": displayed, "last_page_index": last, "total_stated": total}
            for it in IP.parse_views_listing(html):
                n_items += 1
                key = IP.page_slug(it["url"]) if it["url"] else IP.slug(os.path.basename(it["files"][0]["url"]) if it["files"] else it["title"])
                rid = unique(f"{series}-{key}", taken)
                year = it["date_iso"][:4] if it["date_iso"] else None
                files = it["files"]
                facts = [
                    ("Series", label),
                    ("Published (as the FTC page shows it)", it["date_display"]),
                    ("Summary (as published)", it["summary"]),
                    ("Files", "; ".join(f"{f['title']} ({f['size']})" if f["size"] else f["title"] for f in files) if files else None),
                    ("Related press releases", "; ".join(p["title"] for p in it["press_releases"]) if it["press_releases"] else None),
                    ("Listed on", url),
                ]
                links = []
                if it["url"]:
                    links.append({"url": it["url"], "label": "Page on ftc.gov"})
                for f in files[:3]:
                    links.append({"url": f["url"], "label": f["title"]})
                for p in it["press_releases"][:2]:
                    links.append({"url": p["url"], "label": p["title"]})
                rows.append(
                    B.record(
                        "ftc_publications_index", rid, it["title"], source_url=url, subtitle=f"{label}" + (f", {it['date_display']}" if it["date_display"] else ""),
                        cells={"title": it["title"], "series": label, "published": it["date_display"] or B.NOT_RECORDED, "files": f"{len(files)}" if files else B.NOT_RECORDED},
                        facts=facts, links=links, text=" ".join([it["summary"] or "", label]),
                        filters={"series": [series], "year": [year] if year else []},
                        extra={"series": series, "published_display": it["date_display"], "published_iso": it["date_iso"], "summary": it["summary"], "page_url": it["url"], "files": files, "press_releases": it["press_releases"]},
                    )
                )
        counts[series] = n_items
    for series, (label, base, name) in FILE_PAGES.items():
        entry = entries.get(base)
        if entry is None:
            raise SystemExit(f"page not fetched: {base}")
        inputs.append(B.input_ref(entry))
        n_items = 0
        for f in IP.parse_file_sections(read_page(name)):
            n_items += 1
            rid = unique(f"{series}-{IP.slug(f['title'], 60)}", taken)
            section = f["section"] or label
            rows.append(
                B.record(
                    "ftc_publications_index", rid, f["title"], source_url=base, subtitle=section,
                    cells={"title": f["title"], "series": section, "published": B.NOT_RECORDED, "files": "1"},
                    facts=[("Series", section), ("Published", None), ("Summary (as published)", None), ("File", f"{f['title']} ({f['size']})" if f["size"] else f["title"]), ("Listed on", base)],
                    links=[{"url": f["url"], "label": f["title"]}], text=" ".join([f["title"], section]),
                    filters={"series": [series], "year": []},
                    extra={"series": series, "published_display": None, "published_iso": None, "summary": None, "page_url": None, "files": [{"title": f["title"], "url": f["url"], "size": f["size"]}], "press_releases": [], "section": section},
                )
            )
        counts[series] = n_items
    summary = {
        "label": "FTC Data Spotlight posts and policy reports", "rows": len(rows), "counts_by_series": counts, "pages_as_stated": shown, "terms": B.GOV_TERMS,
        "method": "The FTC's own listing pages (https://www.ftc.gov/news-events/data-visualizations/data-spotlight and https://www.ftc.gov/policy/reports and its listings), read directly and stored unchanged; one request every 5 seconds as the FTC's robots.txt asks",
        "coverage": "Every item on the listed pages on the retrieval date. Not every FTC report type is indexed: litigation status reports, FOIA, MD-715, warranty audit, cigarette warning, Webb-Pomerene and OECD submission listings are left out.",
        "notes": ["Titles, dates and summaries are exactly as the FTC pages show them; a summary the page itself cuts off with an ellipsis stays cut off.", "A date is shown as the page shows it (month and year for most reports); report types that list files only carry no date."],
        "built_at": B.now_utc(),
    }
    return rows, summary, inputs


def publications_listing():
    return B.writer.listing(PUBLICATION_COLUMNS, [("series", "Series", {k: v for k, v in SERIES_LABEL.items()})])


# ---------------------------------------------------------------------------------------------------------------------
# Consumer Sentinel data contributors

def build_contributors(entries=None):
    entries = entries if entries is not None else B.current_entries()
    url = BASE + "/enforcement/consumer-sentinel-network/data-contributors"
    entry = entries[url]
    parsed = IP.parse_contributors(read_page("csn_data_contributors.html"))
    rows, taken = [], set()
    for role, key, names in (("Data contributor", "contributor", parsed["contributors"]), ("Refers complaints to the FTC", "referrer", parsed["referrers"])):
        for name in names:
            rid = unique(f"{key}-{IP.slug(name, 70)}", taken)
            rows.append(
                B.record(
                    "ftc_sentinel_contributors", rid, name, source_url=url, subtitle=role,
                    cells={"name": name, "role": role},
                    facts=[("Name (as listed)", name), ("Role", role), ("What the FTC says", parsed["intro"] if key == "contributor" else parsed["referrers_intro"]), ("Source", url)],
                    links=[{"url": url, "label": "Consumer Sentinel data contributors (FTC)"}], text=f"{name} Consumer Sentinel Network {role}",
                    filters={"role": [key]}, extra={"role": key, "name": name},
                )
            )
    summary = {
        "label": "Consumer Sentinel Network data contributors", "rows": len(rows), "contributors": len(parsed["contributors"]), "referrers": len(parsed["referrers"]), "terms": B.GOV_TERMS,
        "method": "The FTC's Data Contributors page, read directly and stored unchanged", "intro": parsed["intro"], "referrers_intro": parsed["referrers_intro"],
        "notes": ["Names are exactly as the FTC lists them. An organisation is not linked to any other record: matching names across sources is never done here."],
        "built_at": B.now_utc(),
    }
    return rows, summary, [B.input_ref(entry)]


def contributors_listing():
    return B.writer.listing([("name", "Name"), ("role", "Role")], [("role", "Role", {"contributor": "Data contributor", "referrer": "Refers complaints to the FTC"})])


# ---------------------------------------------------------------------------------------------------------------------
# Catalog of the FTC's open data: downloadable files, API endpoints and the Tableau dashboards

OPEN_GOV = BASE + "/policy-notices/open-government/data-sets"
EXPLORE = BASE + "/news-events/data-visualizations/explore-data"
# FTC download -> the dataset on this platform that holds its figures (None = not loaded)
LOADED_AS = {
    "FTC-Nonmerger-Enforcement-Actions.csv": "ftc_enforcement_actions", "FTC-Merger-Enforcement-Actions.csv": "ftc_enforcement_actions",
    "FTC-BC-Civil-Penalty-Actions.csv": "ftc_enforcement_actions", "civil_penalty_cases_fy2000-2026.xlsx": "ftc_enforcement_actions",
    "HSR-Merger-Transactions-by-Month.csv": "ftc_hsr_filings", "HSR-Transactions-Filings-Second-Requests-by-FY.csv": "ftc_hsr_filings",
}
CATALOG_COLUMNS = [("name", "Name"), ("kind", "Kind"), ("period", "Period or scope"), ("download", "Download offered"), ("loaded", "On this platform")]


def parse_open_gov(html):
    soup = BeautifulSoup(html, "lxml")
    main = soup.find("main") or soup
    tables = main.find_all("table")
    out = []
    # table 0: data sets with a dictionary and a description
    for tr in tables[0].find_all("tr")[1:]:
        cells = tr.find_all(["td", "th"])
        if len(cells) < 3:
            continue
        a = cells[0].find("a", href=True)
        d = cells[1].find("a", href=True)
        if not a:
            continue
        size = re.search(r"\(([^)]*)\)\s*$", IP.text_of(cells[0]))
        out.append({"group": "dataset", "name": re.sub(r"\s*\([^)]*\)\s*$", "", IP.text_of(a)).strip(), "url": IP.absolute(a["href"]), "dictionary_url": IP.absolute(d["href"]) if d else None, "description": IP.text_of(cells[2]), "size": re.sub(r"^[A-Za-z]+,\s*", "", size.group(1)).replace("\xa0", " ").strip() if size else None})
    for ti, (group, label) in ((1, ("csn_databook", "Consumer Sentinel Network Data Book")), (2, ("dnc_databook", "Do Not Call Data Book"))):
        for a in tables[ti].find_all("a", href=True):
            out.append({"group": group, "name": f"{label} {IP.text_of(a).replace('Data Book', '').strip()}".strip(), "url": IP.absolute(a["href"]), "dictionary_url": None, "description": None, "size": None})
    return out


def short(text, limit=160):
    """Text for a list cell: whole as published when it fits, else cut at a word boundary and marked with an ellipsis (the full text is in the facts)."""
    if len(text) <= limit:
        return text
    cut = text[: limit - 1].rsplit(" ", 1)[0].rstrip(" ,;:")
    return cut + "\u2026"


def file_format(url):
    m = re.search(r"\.([A-Za-z0-9]+)(?:$|\?)", url)
    return (m.group(1).upper() if m else "page")


def build_catalog(entries=None):
    entries = entries if entries is not None else B.current_entries()
    rows, taken, inputs = [], set(), []
    tab_dir = os.path.join(B.ACQ, "tableau")
    views = json.load(open(os.path.join(tab_dir, "_views.json"), encoding="utf-8"))
    page_entry = entries[OPEN_GOV]
    explore_entry = entries[EXPLORE]
    inputs += [B.input_ref(page_entry), B.input_ref(explore_entry)]
    # 1. downloadable files
    files = parse_open_gov(read_page("open_gov_data_sets.html"))
    for f in files:
        base = os.path.basename(f["url"])
        loaded = LOADED_AS.get(base)
        loaded_how = None
        edition = re.search(r"(\d{4})$", f["name"])
        year = int(edition.group(1)) if edition else None
        # Data Book editions whose figures are on the platform were read from the Data Book PDFs, not from these downloads
        if f["group"] == "csn_databook" and year and 2017 <= year <= 2024:
            loaded, loaded_how = "ftc_sentinel_states", "the edition's figures were read from the Data Book PDF (also ftc_sentinel_national), not from this download"
        elif f["group"] == "dnc_databook" and year and 2021 <= year <= 2025:
            loaded, loaded_how = "ftc_dnc_states", "the edition's figures were read from the Data Book PDF, not from this download"
        got = entries.get(f["url"])
        if got:
            inputs.append(B.input_ref(got))
        period = f["description"] or (f["name"].split(" ")[-1] if f["group"] != "dataset" else None)
        rid = unique(f"file-{IP.slug(f['name'], 60)}", taken)
        rows.append(
            B.record(
                "ftc_open_data_catalog", rid, f["name"], source_url=OPEN_GOV, subtitle=f"FTC download, {file_format(f['url'])}",
                cells={"name": f["name"], "kind": "Download", "period": short(f["description"] or f"Edition {f['name'].split(' ')[-1]}"), "download": f"Yes ({file_format(f['url'])}" + (f", {f['size']})" if f["size"] else ")"), "loaded": (loaded + " (from the PDF edition)" if loaded_how else loaded) or "Not loaded"},
                facts=[("Name", f["name"]), ("Format and size as listed", f"{file_format(f['url'])}" + (f", {f['size']}" if f["size"] else "")), ("File", f["url"]), ("Dictionary", f["dictionary_url"]), ("What the FTC says", f["description"]),
                       ("On this platform", (f"{loaded}: {loaded_how}" if loaded_how else loaded) or "Not loaded here (the file is listed, not read)"), ("Read by this build", f"Yes, sha256 {got['sha256']}" if got else "No"), ("Listed on", OPEN_GOV)],
                links=[{"url": f["url"], "label": "Download from ftc.gov"}] + ([{"url": f"/data/{loaded}", "label": "Dataset on this platform"}] if loaded else []),
                text=" ".join([f["name"], f["description"] or "", "FTC open government data set download"]),
                filters={"kind": [f["group"]]}, extra={"kind": "download", "group": f["group"], "url": f["url"], "loaded_as": loaded, "retrieved": bool(got)},
            )
        )
    # 2. API endpoints
    for rid, name, path, desc, loaded in (
        ("api-dnc-complaints", "Do Not Call reported calls API", "/v0/dnc-complaints", "Reported unwanted calls: created and violation date, consumer city, state and area code, subject, recorded-message flag and the calling number, updated each weekday.", "ftc_dnc_reported_calls"),
        ("api-hsr-early-termination-notices", "HSR early termination notices API", "/v0/hsr-early-termination-notices", "Every early termination granted under the Hart-Scott-Rodino Act: transaction number, acquiring and acquired parties, date granted.", "ftc_hsr_early_terminations"),
    ):
        docs = BASE + "/developer/api/v0/endpoints/" + ("do-not-call-dnc-reported-calls-data-api" if "dnc" in rid else "hsr-early-termination-notices")
        rows.append(
            B.record(
                "ftc_open_data_catalog", rid, name, source_url=BASE + "/developer", subtitle="FTC API (api.data.gov key)",
                cells={"name": name, "kind": "API", "period": short(desc), "download": "Yes (JSON API, key required)", "loaded": loaded},
                facts=[("Endpoint", "https://api.ftc.gov" + path), ("What it serves", desc), ("Documentation", docs), ("Access", "Free api.data.gov key; the FTC states 20,000 requests an hour per key is the header limit and throttling is set by api.data.gov"), ("On this platform", loaded)],
                links=[{"url": docs, "label": "API documentation (FTC)"}, {"url": f"/data/{loaded}", "label": "Dataset on this platform"}], text=f"{name} FTC API {path}",
                filters={"kind": ["api"]}, extra={"kind": "api", "loaded_as": loaded},
            )
        )
    # 3. dashboards (Tableau Public views the FTC links from Explore Data, plus the other sheets of its workbooks)
    n_down = n_empty = n_none = 0
    for v in views:
        name = (v["labels_on_ftc_page"] or [v.get("view_title") or v["view"]])[0]
        if v["status"] == 200 and v["bytes"] > 2:
            state, n_down = "Yes, data returned", n_down + 1
        elif v["status"] == 200:
            state, n_empty = "Offered, but the download is empty", n_empty + 1
        else:
            state, n_none = f"No (the download request answered HTTP {v['status']})", n_none + 1
        rid = unique(f"viz-{IP.slug(v['workbook'], 40)}-{IP.slug(v['view'], 40)}", taken)
        rows.append(
            B.record(
                "ftc_open_data_catalog", rid, f"{name} ({v['workbook_title'] or v['workbook']})", source_url=v["view_url"], subtitle="FTC dashboard on Tableau Public",
                cells={"name": f"{name} ({v['workbook_title'] or v['workbook']})", "kind": "Dashboard view", "period": "; ".join(v["sections_on_ftc_page"]) or "Not linked from the FTC Explore Data page", "download": state, "loaded": "ftc_dnc_reported_calls (April to June months)" if (v["workbook"], v["view"]) == ("DoNotCallComplaints", "MonthlyComparison") else "Not loaded"},
                facts=[("View", f"{v['workbook']} / {v['view']}"), ("Label on the FTC page", "; ".join(v["labels_on_ftc_page"]) or None), ("Section on the FTC page", "; ".join(v["sections_on_ftc_page"]) or None),
                       ("Data download offered", state), ("Download request", v["csv_url"]), ("Answer", f"HTTP {v['status']}, {v['content_type'].split(';')[0]}, {v['bytes']} bytes"), ("Checked", v["retrieved_at"]), ("Listed on", EXPLORE)],
                links=[{"url": v["view_url"], "label": "Open the dashboard view"}], text=f"{name} {v['workbook_title'] or ''} FTC dashboard Tableau Public",
                filters={"kind": ["dashboard"], "download": ["yes" if v["bytes"] > 2 and v["status"] == 200 else "empty" if v["status"] == 200 else "no"]},
                extra={"kind": "dashboard", "workbook": v["workbook"], "view": v["view"], "status": v["status"], "bytes": v["bytes"], "sha256": v["sha256"]},
            )
        )
    summary = {
        "label": "FTC open data: downloads, APIs and dashboards", "rows": len(rows), "terms": B.GOV_TERMS,
        "dashboards": {"views_checked": len(views), "data_returned": n_down, "download_empty": n_empty, "no_download": n_none},
        "method": "Downloads and APIs are those the FTC lists on https://www.ftc.gov/policy-notices/open-government/data-sets and https://www.ftc.gov/developer. Dashboard views are the Tableau Public views the FTC links from https://www.ftc.gov/news-events/data-visualizations/explore-data plus the other sheets Tableau Public lists for the FTC's workbooks; for each, the data download Tableau Public offers when an author allows it was requested (one request every 10 seconds, as public.tableau.com's robots.txt asks).",
        "notes": ["'No' means the download request was refused with HTTP 404 (the view offers no data download); nothing is read from images or by other means.", "A dashboard whose download is empty returned a file with no rows."],
        "built_at": B.now_utc(),
    }
    # de-duplicate input refs
    seen, uniq = set(), []
    for i in inputs:
        if i["sha256"] not in seen:
            seen.add(i["sha256"])
            uniq.append(i)
    return rows, summary, uniq


def catalog_listing():
    return B.writer.listing(CATALOG_COLUMNS, [("kind", "Kind", {"dataset": "FTC data set", "csn_databook": "Consumer Sentinel Data Book", "dnc_databook": "Do Not Call Data Book", "api": "API", "dashboard": "Dashboard view"})])
